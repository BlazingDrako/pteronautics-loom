// The text pane: one RFLP layer as SysML v2 text, beside the open view, editable.
//
// The model and the text stay in step both ways. Edits elsewhere reprint the text (unless you
// are mid-edit); your text is checked as you type, and applied as one undoable change when you
// pause (or press ⌘Enter, or leave the pane), as long as it has no errors. Errors show their
// line. Clicking in the text selects that element; selecting an element scrolls to its text.
import { h, icon, formatKeys } from './dom.js';
import { LAYERS } from '../model/metamodel.js';
import { printPackage } from '../text/printer.js';
import { parseLayer, buildSnapshot, applySnapshot } from '../text/build.js';
import { TextError } from '../text/lexer.js';
import { ModelError } from '../model/model.js';

/** @typedef {import('../model/model.js').Model} Model */

const APPLY_AFTER = 1200; // ms of quiet before valid text is applied
const HL_LIMIT = 400_000; // characters: beyond this the text is shown without colors

/** Syntax colors as HTML. @param {string} text */
export function highlight(text) {
  const esc = (/** @type {string} */ t) => t.replace(/[&<>]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?)|('(?:[^'\\\n]|\\.)*'?)|(<'(?:[^'\\\n]|\\.)*'>|<[A-Za-z0-9_.-]+>)|(@Loom\b)|(\b(?:package|part|def|port|requirement|verification|action|attribute|connection|connect|view|doc|comment|in|out|inout)\b)|(\b(?:satisfy|verify|refine|derive|copy|allocate|dependency|to|true|false)\b)|(-?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)|(:>|::|~)/g;
  let out = '', last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out += esc(text.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 'c' : m[3] ? 's' : m[4] ? 'n' : m[5] ? 'id' : m[6] ? 'm' : m[7] ? 'k' : m[8] ? 'r' : m[9] ? 'v' : 'o';
    out += `<span class="tk-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last)) + '\n';
}

/**
 * @param {{
 *   model: Model,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   close: () => void,
 *   width: () => number,
 *   setWidth: (w: number) => void,
 *   toast: (msg: string, err?: boolean) => void,
 * }} ctx
 */
export function createTextPane(ctx) {
  const { model } = ctx;
  let layerId = model.layers()[0]?.id || '';
  /** What the text was when it last matched the model. */
  let baseText = '';
  /** @type {Map<string, [number, number]>} */
  let ranges = new Map();
  /** @type {{ message: string, line: number, col: number } | null} */
  let error = null;
  let stale = false;       // the model changed while you had unapplied edits
  let applying = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let checkTimer, applyTimer;
  let lastStatus = '';

  // ---------- DOM ----------
  const seg = h('div', { class: 'seg tp-layers', role: 'group', 'aria-label': 'Layer' });
  const status = h('span', { class: 'tp-status small' });
  const applyBtn = h('button', { class: 'btn sm primary', type: 'button', title: `Apply the text to the model (${formatKeys('Mod+Enter')})`, onclick: () => apply(true) }, 'Apply');
  const revertBtn = h('button', { class: 'btn sm', type: 'button', title: 'Throw away text edits and show the model again', onclick: () => revert() }, 'Revert');
  const head = h('div', { class: 'tp-head' }, h('b', { class: 'tp-title' }, 'SysML v2'), seg, h('span', { style: { flex: '1' } }), status, revertBtn, applyBtn,
    h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Close the text pane', title: `Close (${formatKeys('Mod+E')})`, onclick: () => ctx.close() }, icon('x')));
  const gutter = h('div', { class: 'tp-gutter', 'aria-hidden': 'true' });
  const pre = h('pre', { class: 'tp-hl', 'aria-hidden': 'true' });
  const input = h('textarea', { class: 'tp-input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', 'aria-label': 'Model as SysML v2 text' });
  const band = h('div', { class: 'tp-band', hidden: true });
  const errBand = h('div', { class: 'tp-band err', hidden: true });
  const edit = h('div', { class: 'tp-edit' }, band, errBand, pre, input);
  const scroller = h('div', { class: 'tp-scroll' }, gutter, edit);
  const errors = h('button', { class: 'tp-error', type: 'button', hidden: true, onclick: () => { if (error) goToLine(error.line, error.col); } });
  const grip = h('div', { class: 'tp-grip', 'aria-hidden': 'true', title: 'Drag to resize' });
  const el = h('aside', { class: 'textpane', 'aria-label': 'SysML v2 text' }, grip, head, scroller, errors);
  el.style.width = `${ctx.width()}px`;

  const lineH = () => parseFloat(getComputedStyle(input).lineHeight) || 19;

  // ---------- painting ----------
  function paintLayers() {
    seg.replaceChildren(...model.layers().map((l) => {
      const info = LAYERS.find((x) => x.id === l.layer);
      return h('button', { type: 'button', 'aria-pressed': String(l.id === layerId), title: l.name, style: { '--lc': info?.color }, onclick: () => switchLayer(l.id) }, info?.id.toUpperCase());
    }));
  }
  function paintText() {
    const v = input.value;
    pre.innerHTML = v.length <= HL_LIMIT ? highlight(v) : v.replace(/[&<>]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '\n';
    const n = v.split('\n').length;
    if (gutter.childElementCount !== n) gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    // the textarea grows with its text; the pane scrolls
    input.style.height = '0px';
    input.style.height = `${Math.max(scroller.clientHeight - 4, input.scrollHeight)}px`;
    input.style.width = '0px';
    input.style.width = `${Math.max(edit.clientWidth, input.scrollWidth)}px`;
    paintError();
  }
  function paintStatus() {
    const dirty = input.value !== baseText;
    let s = '', cls = '';
    if (error) { s = `✕ Line ${error.line}: ${error.message}`; cls = 'bad'; }
    else if (stale) { s = 'The model changed elsewhere'; cls = 'warn'; }
    else if (applying) { s = 'Applying…'; }
    else if (dirty) { s = 'Edited · applies when you pause'; cls = 'accent'; }
    else { s = '✓ In sync with the model'; cls = 'good'; }
    if (s + cls !== lastStatus) { status.textContent = error ? `✕ Error on line ${error.line}` : s; status.className = `tp-status small ${cls}`; lastStatus = s + cls; }
    status.title = s;
    applyBtn.disabled = !dirty || !!error;
    revertBtn.disabled = !dirty && !stale;
    errors.hidden = !error;
    if (error) errors.textContent = `Line ${error.line}, column ${error.col}: ${error.message}`;
  }
  function paintError() {
    if (!error) { errBand.hidden = true; return; }
    errBand.hidden = false;
    errBand.style.top = `${8 + (error.line - 1) * lineH()}px`;
    errBand.style.height = `${lineH()}px`;
  }

  /** Print the layer and show it (keeping the scroll position). */
  function reprint() {
    const out = printPackage(model, layerId);
    baseText = out.text; ranges = out.ranges;
    const top = scroller.scrollTop;
    if (input.value !== out.text) { input.value = out.text; paintText(); }
    error = null; stale = false;
    paintText(); paintStatus();
    scroller.scrollTop = top;
  }

  /** @param {string} id */
  function switchLayer(id) {
    if (id === layerId) return;
    if (input.value !== baseText && !apply(true)) return; // keep edits that cannot be applied yet
    layerId = id;
    paintLayers(); reprint();
    scroller.scrollTop = 0;
  }

  // ---------- checking and applying ----------
  /** Parse and build without applying: show the first error, if any. */
  function check() {
    try {
      const node = parseLayer(input.value);
      buildSnapshot(model, [{ layerId, node }]);
      error = null;
    } catch (e) {
      if (e instanceof TextError) error = { message: e.message, line: e.line, col: e.col };
      else if (e instanceof ModelError) error = { message: e.message, line: 1, col: 1 };
      else throw e;
    }
    paintError(); paintStatus();
    return !error;
  }
  /** Apply the text to the model. Returns false when there are errors. @param {boolean} [now] */
  function apply(now) {
    clearTimeout(applyTimer); clearTimeout(checkTimer);
    if (input.value === baseText && !stale) return true;
    try {
      const node = parseLayer(input.value);
      const snap = buildSnapshot(model, [{ layerId, node }]);
      applying = true;
      const s = applySnapshot(model, snap, `Edit ${model.get(layerId)?.name || 'layer'} as text`);
      applying = false;
      baseText = input.value; stale = false; error = null;
      // ranges follow the model's own printing; keep the user's layout until they leave the pane
      ranges = printPackage(model, layerId).ranges;
      if (now !== undefined || s.created || s.removed) { const parts = [s.created && `${s.created} added`, s.removed && `${s.removed} removed`, s.changed && `${s.changed} changed`].filter(Boolean); if (parts.length) ctx.toast(`Text applied: ${parts.join(', ')}`); }
      paintStatus(); paintError();
      return true;
    } catch (e) {
      applying = false;
      if (e instanceof TextError) error = { message: e.message, line: e.line, col: e.col };
      else if (e instanceof ModelError) error = { message: e.message, line: 1, col: 1 };
      else throw e;
      paintStatus(); paintError();
      if (now) ctx.toast(`Not applied: line ${error.line}: ${error.message}`, true);
      return false;
    }
  }
  function revert() { clearTimeout(applyTimer); clearTimeout(checkTimer); reprint(); }

  // ---------- selection, both ways ----------
  /** The innermost element whose text holds a line. @param {number} line */
  function elementAt(line) {
    let best = null, size = Infinity;
    for (const [id, [a, b]] of ranges) if (line >= a && line <= b && b - a < size && model.get(id)) { best = id; size = b - a; }
    return best;
  }
  /** @param {number} line @param {number} [col] */
  function goToLine(line, col = 1) {
    const lines = input.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    pos += Math.max(0, col - 1);
    input.focus();
    input.setSelectionRange(pos, pos);
    revealLine(line);
  }
  /** @param {number} line */
  function revealLine(line) {
    const y = 8 + (line - 1) * lineH();
    if (y < scroller.scrollTop + 20 || y > scroller.scrollTop + scroller.clientHeight - 40) scroller.scrollTop = Math.max(0, y - scroller.clientHeight / 3);
  }
  /** Show where an element is. @param {string | null} id */
  function showElement(id) {
    const r = id ? ranges.get(id) : undefined;
    if (!r) { band.hidden = true; return; }
    band.hidden = false;
    band.style.top = `${8 + (r[0] - 1) * lineH()}px`;
    band.style.height = `${(r[1] - r[0] + 1) * lineH()}px`;
    if (document.activeElement !== input) revealLine(r[0]);
  }
  const caretLine = () => input.value.slice(0, input.selectionStart).split('\n').length;
  function caretSelect() {
    if (input.value !== baseText) return; // line numbers only match the model when the text is in step
    const id = elementAt(caretLine());
    if (id && id !== ctx.selected()) ctx.select(id);
  }

  // ---------- editing keys ----------
  input.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'Enter' || e.key.toLowerCase() === 's')) { e.preventDefault(); e.stopPropagation(); apply(true); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value: v } = input;
      if (e.shiftKey) {
        const ls = v.lastIndexOf('\n', a - 1) + 1;
        const n = /^ {1,4}/.exec(v.slice(ls))?.[0].length || 0;
        if (n) { input.setRangeText('', ls, ls + n, 'preserve'); input.setSelectionRange(Math.max(ls, a - n), Math.max(ls, b - n)); }
      } else input.setRangeText('    ', a, b, 'end');
      input.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key === 'Enter' && !mod) {
      e.preventDefault();
      const { selectionStart: a, value: v } = input;
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      const indent = /^ */.exec(v.slice(ls))?.[0] || '';
      const extra = /\{\s*$/.test(v.slice(ls, a)) ? '    ' : '';
      input.setRangeText(`\n${indent}${extra}`, a, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input'));
      return;
    }
    if (e.key === '}') {
      const { selectionStart: a, value: v } = input;
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      if (/^ {4,}$/.test(v.slice(ls, a))) { e.preventDefault(); input.setRangeText('}', a - 4, a, 'end'); input.dispatchEvent(new Event('input')); }
    }
    if (e.key === 'Escape') { e.preventDefault(); input.blur(); }
  });
  input.addEventListener('input', () => {
    paintText(); paintStatus();
    clearTimeout(checkTimer); clearTimeout(applyTimer);
    checkTimer = setTimeout(() => { if (check()) applyTimer = setTimeout(() => apply(), APPLY_AFTER - 300); }, 300);
  });
  input.addEventListener('blur', () => {
    if (input.value !== baseText) { if (!apply()) return; }
    if (!error) { const want = printPackage(model, layerId).text; if (want !== input.value) reprint(); }
  });
  input.addEventListener('click', caretSelect);
  input.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'PageUp' || e.key === 'PageDown') caretSelect(); });
  // the pane's own keys never reach the app's shortcuts (Delete, F2…)
  input.addEventListener('keydown', (e) => { if (!(e.metaKey || e.ctrlKey)) e.stopPropagation(); });

  // resize by dragging the left edge
  grip.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX, w0 = el.offsetWidth;
    const move = (/** @type {PointerEvent} */ e) => { el.style.width = `${Math.min(1200, Math.max(280, w0 - (e.clientX - x0)))}px`; };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); ctx.setWidth(el.offsetWidth); paintText(); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });

  const unsub = model.subscribe(() => {
    if (applying) return;
    if (!model.get(layerId)) layerId = model.layers()[0]?.id || '';
    if (input.value === baseText) reprint();
    else { stale = true; paintStatus(); }
  });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => paintText()) : null;
  ro?.observe(scroller);

  paintLayers();
  reprint();

  return {
    el,
    /** Follow the selection: its layer, scrolled to its text. @param {string | null} id */
    syncSelection(id) {
      const l = id ? model.layerOf(id) : undefined;
      const layer = l ? model.layers().find((x) => x.layer === l) : undefined;
      if (layer && layer.id !== layerId && input.value === baseText) { layerId = layer.id; paintLayers(); reprint(); }
      showElement(id);
    },
    focus: () => input.focus(),
    /** For tests. */
    text: () => input.value,
    /** For tests: type text as if by hand and apply it. @param {string} t */
    setText(t) { input.value = t; paintText(); return apply(true); },
    error: () => error,
    dispose() { clearTimeout(checkTimer); clearTimeout(applyTimer); unsub(); ro?.disconnect(); },
  };
}
