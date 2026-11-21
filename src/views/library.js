// The SysML library: the reference, one keystroke away (?). Search every entry, browse by
// category, follow "see also" links, and jump from an entry to the elements of that kind in
// this model. Pressing ? with an element selected opens the entry for its kind.
import { h, icon } from '../ui/dom.js';
import { entries, CATEGORIES, entryForKind } from '../library/entries.js';
import { kindName, ELEMENTS, RELATIONSHIPS } from '../model/metamodel.js';
import { fuzzy } from '../ui/fuzzy.js';
import { figureFor } from '../library/figures.js';
import { toolIcon, symbolFor } from '../canvas/tools.js';
import { DIAGRAM_ICON } from '../ui/tree.js';

/** @param {string} q @param {string} t */
const fuzzyScore = (q, t) => fuzzy(q, t)?.score ?? null;

/** @typedef {import('../library/entries.js').Entry} Entry */

/** Palette symbols for kinds drawn as lines. */
const LINE_SYMBOL = /** @type {Record<string, string>} */ ({ flow: 'control', transition: 'transition', message: 'sync', connector: 'connector', binding: 'bind', participate: 'participate' });
/** The symbol shown beside an entry in the list: its SysML symbol, or a book for articles. @param {Entry} e */
function entryIcon(e) {
  const k = e.kind;
  if (!k) return icon('book');
  if (k in DIAGRAM_ICON) return toolIcon(DIAGRAM_ICON[k]);
  if (k in LINE_SYMBOL) return toolIcon(LINE_SYMBOL[k]);
  if (k in RELATIONSHIPS) return toolIcon(k);
  if (k === 'stereotype' || k === 'profile') return toolIcon(k === 'profile' ? 'package' : 'block');
  return toolIcon(symbolFor(k));
}

const ALL = entries();
const BY_ID = new Map(ALL.map((e) => [e.id, e]));

/**
 * @param {{
 *   model: import('../model/model.js').Model,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 * }} ctx
 */
export function createLibraryView(ctx) {
  let current = 'mbse';
  let query = '';
  const search = h('input', { class: 'field lib-search', type: 'search', placeholder: 'Search the library', 'aria-label': 'Search the library' });
  search.addEventListener('input', () => { query = search.value.trim(); renderList(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = list.querySelector('button'); /** @type {HTMLButtonElement | null} */ (first)?.click(); } });
  const list = h('nav', { class: 'lib-list', 'aria-label': 'Library entries' });
  const article = h('article', { class: 'lib-article', tabindex: '-1' });
  const el = h('div', { class: 'lib' }, h('aside', { class: 'lib-side' }, search, list), article);

  /** @param {string} id */
  function open(id) {
    if (!BY_ID.has(id)) return;
    current = id;
    renderList(); renderArticle();
    article.scrollTop = 0;
  }

  function renderList() {
    let shown = ALL;
    if (query) {
      const q = query.toLowerCase();
      shown = ALL.map((e) => {
        const title = fuzzyScore(query, `${e.title} ${Object.values(e.names || {}).join(' ')}`);
        const s = title !== null ? title : `${e.summary}`.toLowerCase().includes(q) ? 0 : e.body.toLowerCase().includes(q) ? -40 : -Infinity;
        return { e, s };
      })
        .filter((x) => x.s > -Infinity).sort((a, b) => b.s - a.s).map((x) => x.e);
      list.replaceChildren(...(shown.length ? shown.slice(0, 60).map(item) : [h('p', { class: 'muted small lib-none' }, 'Nothing matches.')]));
      return;
    }
    list.replaceChildren(...CATEGORIES.map((cat) => {
      const es = ALL.filter((e) => e.category === cat);
      return es.length ? h('div', { class: 'lib-cat' }, h('div', { class: 'sec' }, cat), es.map(item)) : null;
    }).filter((x) => x !== null));
  }
  /** @param {Entry} e */
  function item(e) {
    return h('button', { class: 'lib-item' + (e.id === current ? ' on' : ''), type: 'button', 'aria-current': e.id === current ? 'page' : undefined, onclick: () => open(e.id), title: e.summary }, h('span', { class: 'lib-ico', 'aria-hidden': 'true' }, entryIcon(e)), h('span', { class: 'lib-item-t' }, e.kind && e.names ? e.names[ctx.notation()] : e.title));
  }

  /** Text with paragraphs, bullets and `code`. @param {string} text */
  function prose(text) {
    const inline = (/** @type {string} */ t) => t.split(/(`[^`]+`)/).map((part) => (part.startsWith('`') && part.endsWith('`') ? h('code', {}, part.slice(1, -1)) : part));
    return text.split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => l.startsWith('- '))) return h('ul', {}, lines.map((l) => h('li', {}, inline(l.slice(2)))));
      if (lines[0] && !lines[0].startsWith('- ') && lines.slice(1).every((l) => l.startsWith('- ')) && lines.length > 1) return [h('p', {}, inline(lines[0])), h('ul', {}, lines.slice(1).map((l) => h('li', {}, inline(l.slice(2)))))];
      return h('p', {}, lines.flatMap((l, i) => [i ? h('br') : null, ...inline(l)]));
    });
  }

  function renderArticle() {
    const e = /** @type {Entry} */ (BY_ID.get(current));
    const m = ctx.model, n = ctx.notation();
    const inModel = e.kind && e.kind in ELEMENTS ? m.byKind(e.kind).filter((x) => x.owner && !x.layer) : e.kind && e.kind in RELATIONSHIPS ? m.byKind(e.kind) : [];
    article.replaceChildren(...[
      h('div', { class: 'eyebrow' }, e.category),
      h('h2', {}, e.kind && e.names ? e.names[n] : e.title),
      h('p', { class: 'lib-summary' }, e.summary),
      e.names ? h('div', { class: 'lib-names' }, h('span', {}, h('b', {}, 'SysML '), e.names.sysml), h('span', {}, h('b', {}, 'SysML v2 '), h('code', {}, e.names.v2)), h('span', {}, h('b', {}, 'Guided '), e.names.guided)) : null,
      (() => { const f = figureFor(e); return f ? h('figure', { class: 'lib-fig' }, f.svg, h('figcaption', {}, f.caption)) : null; })(),
      prose(e.body),
      e.syntax ? [h('div', { class: 'sec' }, 'In SysML v2 text'), h('pre', { class: 'lib-code' }, e.syntax)] : null,
      e.kind ? [h('div', { class: 'sec' }, `In this model · ${inModel.length}`),
        inModel.length ? h('div', { class: 'chips' }, inModel.slice(0, 40).map((x) => h('button', { class: 'chip', type: 'button', title: x.name || x.kind, onclick: () => ctx.select(x.source || x.id) }, h('span', { class: 'chip-kind mono' }, ELEMENTS[x.kind]?.abbr || kindName(x.kind, 'sysml').toLowerCase()), h('span', { class: 'chip-name' }, x.name || `${m.get(/** @type {string} */ (x.source))?.name} → ${m.get(/** @type {string} */ (x.target))?.name}`))), inModel.length > 40 ? h('span', { class: 'muted small' }, `and ${inModel.length - 40} more`) : null)
          : h('p', { class: 'muted small' }, 'None yet.')] : null,
      e.see?.length ? [h('div', { class: 'sec' }, 'See also'), h('div', { class: 'lib-see' }, e.see.filter((s) => BY_ID.has(s)).map((s) => h('button', { class: 'linkish', type: 'button', onclick: () => open(s) }, icon('book'), (() => { const t = /** @type {Entry} */ (BY_ID.get(s)); return t.kind && t.names ? t.names[n] : t.title; })())))] : null,
    ].flat(3).filter((x) => x !== null && x !== undefined && x !== false));
  }

  renderList(); renderArticle();
  return {
    el,
    invalidate: () => { renderList(); renderArticle(); },
    syncSelection: () => {},
    focus: () => search.focus({ preventScroll: true }),
    /** Open an entry by id, or the entry for an element kind. @param {string} idOrKind */
    show(idOrKind) { open(BY_ID.has(idOrKind) ? idOrKind : entryForKind(idOrKind)); },
    dispose() {},
  };
}

/** The entry title for a kind, for menus. @param {string} kind */
export const entryTitle = (kind) => BY_ID.get(entryForKind(kind))?.title || kind;
