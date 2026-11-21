// The problems panel: everything the validation rules found, under the open view. Filter by
// severity, by text, or to the selected element; click a problem to go to its element, fix it
// in one click where Loom can, or ignore it. Drag the top edge to resize.
import { h, icon, formatKeys } from './dom.js';
import { ELEMENTS, kindName } from '../model/metamodel.js';
import { ruleTitle, configOf, SEVERITIES } from '../validate/engine.js';
import { RULE_BY_ID, RULE_SETS } from '../validate/rules.js';

/** @typedef {import('../validate/engine.js').Problem} Problem */
/** @typedef {import('../validate/engine.js').Severity} Severity */
/**
 * @typedef {{
 *   model: import('../model/model.js').Model,
 *   validator: import('../validate/engine.js').Validator,
 *   settings: import('../settings.js').SettingsStore,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   reveal: (id: string) => void,
 *   fix: (p: Problem) => void,
 *   ignore: (p: Problem) => void,
 *   openRules: () => void,
 * }} ProblemsCtx
 */

const MAX_ROWS = 400;
export const SEV_ICON = /** @type {Record<Severity, string>} */ ({ error: 'error', warning: 'alert', info: 'info' });
export const SEV_WORD = /** @type {Record<Severity, [string, string]>} */ ({ error: ['error', 'errors'], warning: ['warning', 'warnings'], info: ['note', 'notes'] });

/** @param {ProblemsCtx} ctx */
export function createProblemsPanel(ctx) {
  /** Severities shown. */
  const show = new Set(SEVERITIES);
  let query = '';
  /** Only the selected element and what is inside it. */
  let scoped = false;
  /** The problem last gone to with next/previous. */
  let cursor = -1;

  const counts = h('div', { class: 'prob-counts', role: 'group', 'aria-label': 'Show severities' });
  const search = h('input', { class: 'field prob-search', type: 'search', placeholder: 'Filter', 'aria-label': 'Filter problems' });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); cursor = -1; render(); });
  const scopeBtn = h('button', { class: 'btn sm', type: 'button', 'aria-pressed': 'false', title: 'Only problems in the selected element (and what it contains)', onclick: () => { scoped = !scoped; render(); } }, 'Selection only');
  const setBtn = h('button', { class: 'btn sm', type: 'button', title: 'Choose the rule set and change rules', onclick: () => ctx.openRules() }, icon('sliders'), h('span', { class: 'prob-set' }));
  const list = h('div', { class: 'prob-list', role: 'list', 'aria-label': 'Problems' });
  const grip = h('div', { class: 'prob-grip', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the problems panel', tabindex: '0' });
  const el = h('section', { class: 'problems', 'aria-label': 'Problems' },
    grip,
    h('div', { class: 'prob-head' },
      h('h3', {}, 'Problems'), counts, h('div', { class: 'grow' }), search, scopeBtn, setBtn,
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Close the problems panel', title: `Close (${formatKeys('Mod+Shift+M')})`, onclick: () => ctx.settings.update((s) => { s.problems = false; }) }, icon('x'))),
    list);
  el.style.height = `${ctx.settings.get().problemsH}px`;

  // resize by dragging the top edge (or with the arrow keys on it)
  grip.addEventListener('pointerdown', (ev) => {
    const y0 = ev.clientY, h0 = el.offsetHeight;
    grip.setPointerCapture(ev.pointerId);
    const move = (/** @type {PointerEvent} */ e) => { el.style.height = `${Math.min(800, Math.max(120, h0 + y0 - e.clientY))}px`; };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); ctx.settings.update((s) => { s.problemsH = el.offsetHeight; }); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    ctx.settings.update((s) => { s.problemsH = Math.min(800, Math.max(120, s.problemsH + (ev.key === 'ArrowUp' ? 24 : -24))); });
    el.style.height = `${ctx.settings.get().problemsH}px`;
  });

  /** The problems the filters let through. @returns {Problem[]} */
  function filtered() {
    const m = ctx.model, sel = ctx.selected();
    const cfg = configOf(m);
    return ctx.validator.report().problems.filter((p) => {
      if (!show.has(p.severity)) return false;
      if (scoped && sel && !m.isWithin(p.id, sel) && !(p.ids || []).includes(sel)) return false;
      if (query && !`${p.message} ${ruleTitle(cfg, p.rule)} ${m.get(p.id)?.name || ''}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }

  /** Where an element sits: "Logical › Propulsion System". @param {string} id */
  function where(id) {
    const m = ctx.model;
    const path = m.path(id).filter((p) => p.owner).map((p) => p.name);
    return path.slice(-2).join(' › ');
  }

  function render() {
    const m = ctx.model, r = ctx.validator.report(), n = ctx.notation();
    const cfg = configOf(m);
    counts.replaceChildren(...SEVERITIES.map((sv) => h('button', {
      class: `prob-count sev-${sv}${show.has(sv) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(show.has(sv)),
      title: `${show.has(sv) ? 'Hide' : 'Show'} ${SEV_WORD[sv][1]}`,
      onclick: () => { if (show.has(sv)) show.delete(sv); else show.add(sv); cursor = -1; render(); },
    }, icon(SEV_ICON[sv]), h('span', { class: 'mono' }, String(r.counts[sv])), h('span', { class: 'prob-word' }, r.counts[sv] === 1 ? SEV_WORD[sv][0] : SEV_WORD[sv][1]))));
    scopeBtn.setAttribute('aria-pressed', String(scoped));
    scopeBtn.classList.toggle('on', scoped);
    /** @type {HTMLElement} */ (setBtn.querySelector('.prob-set')).textContent = RULE_SETS.find((s) => s.id === cfg.set)?.name || 'Rules';
    const items = filtered();
    const sel = ctx.selected();
    if (!r.problems.length) {
      list.replaceChildren(h('div', { class: 'prob-empty' }, icon('check'), h('span', {}, r.ignored ? `No problems (${r.ignored} ignored).` : 'No problems. Every rule that is on passes.')));
      return;
    }
    if (!items.length) { list.replaceChildren(h('div', { class: 'prob-empty muted' }, scoped && !sel ? 'Select an element to see its problems.' : 'No problems match the filters.')); return; }
    list.replaceChildren(
      ...items.slice(0, MAX_ROWS).map((p, i) => {
        const e = m.get(p.id);
        const row = h('div', { class: `prob sev-${p.severity}${sel === p.id ? ' sel' : ''}${i === cursor ? ' cur' : ''}`, role: 'listitem' },
          h('button', { class: 'prob-main', type: 'button', title: `${p.message}\n${ruleTitle(cfg, p.rule)}${RULE_BY_ID.get(p.rule) ? ` · ${RULE_BY_ID.get(p.rule)?.help}` : ''}`,
            onclick: () => { cursor = i; ctx.select(p.id); render(); },
            ondblclick: () => ctx.reveal(p.id) },
          h('span', { class: 'prob-ic', 'aria-label': p.severity }, icon(SEV_ICON[p.severity])),
          h('span', { class: 'prob-msg' }, p.message),
          e ? h('span', { class: 'prob-el' }, h('span', { class: 'kbadge' }, ELEMENTS[e.kind]?.abbr || ''), h('span', { class: 'prob-where' }, where(p.id) || kindName(e.kind, n))) : null,
          h('span', { class: 'prob-rule' }, ruleTitle(cfg, p.rule))),
          p.fix ? h('button', { class: 'btn sm prob-fix', type: 'button', title: p.fix.label, onclick: () => ctx.fix(p) }, icon('wand'), h('span', {}, p.fix.label)) : null,
          h('button', { class: 'icon-btn sm prob-ignore', type: 'button', 'aria-label': `Ignore: ${p.message}`, title: 'Ignore this problem (you can show ignored problems again from Rules)', onclick: () => ctx.ignore(p) }, icon('eyeOff')));
        return row;
      }),
      ...(items.length > MAX_ROWS ? [h('div', { class: 'prob-more muted' }, `and ${items.length - MAX_ROWS} more: filter to narrow the list`)] : []));
  }

  /** Go to the next (or previous) problem the filters show. @param {1 | -1} dir */
  function step(dir) {
    const items = filtered();
    if (!items.length) return null;
    cursor = (cursor + dir + items.length) % items.length;
    const p = items[cursor];
    ctx.select(p.id);
    render();
    list.querySelector('.prob.cur')?.scrollIntoView({ block: 'nearest' });
    return p;
  }

  /** Show the problems of one element (from a badge). @param {string} id */
  function focusOn(id) { scoped = true; if (ctx.selected() !== id) ctx.select(id); render(); }

  render();
  return { el, render, step, focusOn };
}
