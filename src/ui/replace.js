// The find and replace dialog: type what to find and what to put instead, see every place it
// changes (each can be left out), then replace them all as one undoable step.
import { h, toast } from './dom.js';
import { modal } from './dialog.js';
import { findMatches, applyReplace, searchRegex, keepCase, SCOPES } from '../model/replace.js';
import { ELEMENTS, kindName } from '../model/metamodel.js';

/** @typedef {import('../model/model.js').Model} Model */

const KEY = 'loom-replace-options';
/** Most rows drawn in the preview (all of them are still replaced). */
const SHOW = 300;

/** A short piece of text around the first hit, for the preview. @param {string} text @param {RegExp} re */
export function snippet(text, re) {
  re.lastIndex = 0;
  const m = re.exec(text);
  const at = m ? m.index : 0, len = m ? m[0].length : 0;
  const from = Math.max(0, at - 30), to = Math.min(text.length, at + len + 50);
  return { pre: (from ? '…' : '') + text.slice(from, at), hit: text.slice(at, at + len), post: text.slice(at + len, to) + (to < text.length ? '…' : '') };
}

/**
 * @param {Model} m @param {(label: string, fn: (tx: any) => void) => boolean} edit
 * @param {{ notation: import('../model/metamodel.js').Notation, find?: string, within?: string | null, select?: (id: string) => void }} o
 */
export async function replaceDialog(m, edit, o) {
  /** @type {{ matchCase: boolean, wholeWord: boolean, regex: boolean, scopes: string[], replace: string }} */
  let saved = { matchCase: false, wholeWord: false, regex: false, scopes: SCOPES.map((s) => s.id), replace: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.scopes)) saved = { ...saved, ...v }; } catch { /* storage blocked */ }
  const st = { ...saved, find: o.find || '', within: o.within || null };
  /** Indices left out by the user. */
  let skip = new Set();
  /** @type {import('../model/replace.js').Match[]} */
  let matches = [];

  const r = await modal({
    title: 'Find and replace', ok: 'Replace', wide: true,
    build: () => {
      const find = h('input', { class: 'field', type: 'text', value: st.find, placeholder: 'UAV', 'aria-label': 'Find', spellcheck: 'false' });
      const rep = h('input', { class: 'field', type: 'text', value: st.replace, placeholder: 'UAS', 'aria-label': 'Replace with', spellcheck: 'false' });
      const toggle = (/** @type {'matchCase' | 'wholeWord' | 'regex'} */ k, /** @type {string} */ label, /** @type {string} */ title) => h('button', { class: 'btn sm', type: 'button', title, 'aria-pressed': String(st[k]), onclick: (/** @type {Event} */ e) => { st[k] = !st[k]; /** @type {HTMLElement} */ (e.currentTarget).setAttribute('aria-pressed', String(st[k])); refresh(); } }, label);
      const scopeBox = h('div', { class: 'kind-picks', role: 'group', 'aria-label': 'Look in' });
      const paintScopes = () => scopeBox.replaceChildren(...SCOPES.map((s) => h('button', { class: 'kind-pick' + (st.scopes.includes(s.id) ? ' on' : ''), type: 'button', 'aria-pressed': String(st.scopes.includes(s.id)), onclick: () => { st.scopes = st.scopes.includes(s.id) ? st.scopes.filter((x) => x !== s.id) : [...st.scopes, s.id]; paintScopes(); refresh(); } }, s.label)));
      paintScopes();
      const within = st.within && m.get(st.within) ? h('label', { class: 'check-row' }, (() => { const c = h('input', { type: 'checkbox', checked: true, onchange: () => { st.within = c.checked ? o.within || null : null; refresh(); } }); return c; })(), h('span', {}, `Only inside ${m.get(/** @type {string} */ (st.within))?.name}`)) : null;
      const summary = h('div', { class: 'rep-summary', role: 'status' });
      const list = h('div', { class: 'rep-list' });
      let timer = 0;
      const refresh = () => { clearTimeout(timer); timer = /** @type {any} */ (setTimeout(paint, 120)); };
      function paint() {
        st.find = find.value; st.replace = rep.value;
        const res = findMatches(m, st.find, st.replace, { matchCase: st.matchCase, wholeWord: st.wholeWord, regex: st.regex, scopes: /** @type {any} */ (st.scopes), within: st.within });
        matches = res.matches; skip = new Set();
        if (res.error) { summary.textContent = st.find ? res.error : ''; summary.classList.toggle('err', !!st.find); list.replaceChildren(); return; }
        summary.classList.remove('err');
        const places = matches.reduce((n, x) => n + x.count, 0);
        summary.textContent = matches.length ? `${places} place${places === 1 ? '' : 's'} in ${new Set(matches.map((x) => x.id)).size} element${new Set(matches.map((x) => x.id)).size === 1 ? '' : 's'}${matches.length > SHOW ? ` (the first ${SHOW} shown; all are replaced)` : ''}` : 'Nothing found';
        const re = /** @type {RegExp} */ (searchRegex(st.find, st));
        list.replaceChildren(...matches.slice(0, SHOW).map((mt, i) => {
          const e = m.get(mt.id);
          const field = mt.field === 'name' ? 'Name' : /** @type {any} */ (ELEMENTS[e?.kind || '']?.props?.[mt.field])?.label || mt.field;
          const sn = snippet(mt.before, re);
          const box = h('input', { type: 'checkbox', checked: true, 'aria-label': `Replace in ${e?.name} (${field})`, onchange: () => { if (box.checked) skip.delete(i); else skip.add(i); } });
          return h('div', { class: 'rep-row' },
            box,
            h('div', { class: 'rep-main' },
              h('div', { class: 'rep-where' }, h('button', { class: 'linkish', type: 'button', title: 'Show it in the model browser', onclick: () => o.select?.(mt.id) }, e?.name || '?'), h('span', { class: 'muted' }, ` · ${kindName(e?.kind || '', o.notation)} · ${field}`)),
              h('div', { class: 'rep-text' }, sn.pre, h('del', {}, sn.hit), h('ins', {}, st.regex ? '…' : st.matchCase ? st.replace : keepCase(sn.hit, st.replace)), sn.post)));
        }));
      }
      find.addEventListener('input', refresh); rep.addEventListener('input', refresh);
      paint();
      return {
        body: h('div', { class: 'rep' },
          h('div', { class: 'doc-row' }, h('label', { class: 'field-label' }, 'Find', find), h('label', { class: 'field-label' }, 'Replace with', rep)),
          h('div', { class: 'rep-opts' },
            toggle('matchCase', 'Match case', 'Only where the capitals match too, and put the replacement exactly as typed (otherwise it takes each match\'s case)'),
            toggle('wholeWord', 'Whole words', 'Not inside longer words (UAV, but not UAVs)'),
            toggle('regex', 'Pattern (.*)', 'A regular expression; use $1, $2… in the replacement for its groups')),
          h('div', { class: 'field-label' }, 'Look in', scopeBox), within, summary, list),
        focus: find,
        value: () => {
          paint();
          if (!matches.length) { toast(st.find ? 'Nothing to replace' : 'Type what to find'); return null; }
          return true;
        },
      };
    },
  });
  if (!r) return;
  try { localStorage.setItem(KEY, JSON.stringify({ matchCase: st.matchCase, wholeWord: st.wholeWord, regex: st.regex, scopes: st.scopes, replace: st.replace })); } catch { /* storage blocked */ }
  const only = new Set(matches.map((_, i) => i).filter((i) => !skip.has(i)));
  if (!only.size) { toast('Nothing was chosen to replace'); return; }
  let n = 0;
  if (edit(`Replace “${st.find}” with “${st.replace}”`, (tx) => { n = applyReplace(tx, matches, only); })) toast(`Replaced ${n} place${n === 1 ? '' : 's'}. Undo puts them all back.`);
}
