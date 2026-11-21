// Diagram tool palettes: a strip down the left of each diagram with a tool for every kind of
// element and relationship that diagram can hold, each drawn as its SysML symbol, with a card
// on hover saying what it is and how to use it (like the palettes in Cameo).
//
//   click a tool        arm it: click on the diagram to place the element there, or (for a
//                       relationship) click the source and then the target, or drag between them
//   double-click        keep it armed for several uses (Esc or the Select tool puts it down)
//   Esc                 back to Select
import { h, icon } from '../ui/dom.js';

/** SysML symbols for the palettes, drawn on a 24 × 24 grid in the current color. */
const T = /** @type {Record<string, string>} */ ({
  block: '<rect x="3.5" y="5" width="17" height="14" rx="1.5" fill="currentColor" fill-opacity=".12"/><path d="M3.5 10 H20.5"/><path d="M8.5 7.6 h7" stroke-width="1.2"/>',
  interface: '<rect x="3.5" y="5" width="17" height="14" rx="1.5" fill="currentColor" fill-opacity=".12"/><path d="M3.5 10 H20.5"/><rect x="15" y="13" width="4" height="4" fill="currentColor" stroke="none"/>',
  valueType: '<rect x="3.5" y="5" width="17" height="14" rx="1.5" fill="currentColor" fill-opacity=".12"/><path d="M8 14.5 h8 M8 11.5 h8" stroke-width="1.4"/>',
  requirement: '<rect x="4" y="3.5" width="16" height="17" rx="1.5" fill="currentColor" fill-opacity=".12"/><path d="M4 8.5 H20 M7.5 12 h9 M7.5 15 h9 M7.5 18 h5" stroke-width="1.3"/>',
  testCase: '<rect x="4" y="3.5" width="16" height="17" rx="1.5" fill="currentColor" fill-opacity=".12"/><path d="M8 12.5 L11 15.5 L16.5 9"/>',
  action: '<rect x="3" y="6.5" width="18" height="11" rx="5" fill="currentColor" fill-opacity=".14"/>',
  initial: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  final: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/>',
  flowFinal: '<circle cx="12" cy="12" r="7.5"/><path d="M7 7 L17 17 M17 7 L7 17"/>',
  decision: '<path d="M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z" fill="currentColor" fill-opacity=".14"/>',
  merge: '<path d="M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z"/><path d="M8 12 h8" stroke-width="1.2"/>',
  fork: '<rect x="3" y="10" width="18" height="4" rx="1" fill="currentColor" stroke="none"/><path d="M8 4 V10 M16 14 V20 M8 14 V20"/>',
  join: '<rect x="3" y="10" width="18" height="4" rx="1" fill="currentColor" stroke="none"/><path d="M8 4 V10 M16 4 V10 M12 14 V20"/>',
  lane: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M3.5 8 H20.5 M12 3.5 V20.5"/>',
  state: '<rect x="3" y="5.5" width="18" height="13" rx="4.5" fill="currentColor" fill-opacity=".12"/><path d="M3 10.5 H21"/>',
  choice: '<path d="M12 4 L20 12 L12 20 L4 12 Z" fill="currentColor" fill-opacity=".14"/>',
  history: '<circle cx="12" cy="12" r="7.5"/><path d="M9.5 8.5 V15.5 M14.5 8.5 V15.5 M9.5 12 H14.5" stroke-width="1.6"/>',
  region: '<rect x="3" y="4.5" width="18" height="15" rx="4"/><path d="M3 12 H21" stroke-dasharray="2.5 2"/>',
  actor: '<circle cx="12" cy="5.5" r="2.6"/><path d="M12 8.2 V14.5 M6.5 10.8 H17.5 M12 14.5 L7.5 20.5 M12 14.5 L16.5 20.5"/>',
  useCase: '<ellipse cx="12" cy="12" rx="9" ry="5.8" fill="currentColor" fill-opacity=".14"/>',
  subject: '<rect x="3" y="3.5" width="18" height="17" rx="1"/><ellipse cx="12" cy="13" rx="5.5" ry="3.2" fill="currentColor" fill-opacity=".16"/>',
  package: '<path d="M3.5 7.5 V19.5 H20.5 V7.5 Z" fill="currentColor" fill-opacity=".12"/><path d="M3.5 7.5 V4.5 H10.5 V7.5"/>',
  constraint: '<rect x="3" y="5.5" width="18" height="13" rx="2" fill="currentColor" fill-opacity=".12"/><path d="M9.5 9 c-1.6 0 -1.6 1 -1.6 2 s-0.8 1 -1.4 1 c0.6 0 1.4 0 1.4 1 s0 2 1.6 2 M14.5 9 c1.6 0 1.6 1 1.6 2 s0.8 1 1.4 1 c-0.6 0 -1.4 0 -1.4 1 s0 2 -1.6 2" stroke-width="1.3"/>',
  value: '<rect x="3" y="7" width="18" height="10" rx="2" fill="currentColor" fill-opacity=".12"/><path d="M7 10 L9 14 L11 10 M13.5 11 h4 M13.5 13.2 h4" stroke-width="1.4"/>',
  part: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><rect x="7" y="8.5" width="10" height="7" rx="1" fill="currentColor" fill-opacity=".18"/>',
  port: '<rect x="3.5" y="5" width="14" height="14" rx="1.5"/><rect x="14.5" y="9.5" width="6" height="5" fill="currentColor" stroke="none"/>',
  lifeline: '<rect x="6" y="3" width="12" height="6" rx="1" fill="currentColor" fill-opacity=".14"/><path d="M12 9 V21" stroke-dasharray="2.2 2"/>',
  fragment: '<rect x="3" y="4.5" width="18" height="15" rx="1"/><path d="M3 9 H9 L10.5 7.4 V4.5"/>',
  operand: '<rect x="3" y="4.5" width="18" height="15" rx="1"/><path d="M3 12 H21" stroke-dasharray="2.5 2"/>',
  comment: '<path d="M4.5 4 H15.5 L19.5 8 V20 H4.5 Z M15.5 4 V8 H19.5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" fill="currentColor" fill-opacity=".12"/><path d="M3.5 9 H20.5 M3.5 14.5 H20.5 M10 4.5 V19.5"/>',
  matrix: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M3.5 9 H20.5 M9 3.5 V20.5"/><circle cx="13" cy="13" r="1.3" fill="currentColor" stroke="none"/><circle cx="17" cy="17" r="1.3" fill="currentColor" stroke="none"/><circle cx="17" cy="13" r="1.3" fill="currentColor" stroke="none"/>',
  // relationships
  generalize: '<path d="M4 20 L14.5 9.5"/><path d="M12 6 L19 5 L18 12 Z" fill="var(--bg-elev, #fff)"/>',
  satisfy: '<path d="M4 20 L18 6" stroke-dasharray="2.6 2.2"/><path d="M12.5 6 H18 V11.5"/>',
  verify: '<path d="M4 20 L18 6" stroke-dasharray="2.6 2.2"/><path d="M12.5 6 H18 V11.5"/><path d="M5 9 L7 11.5 L10.5 6.5" stroke-width="1.4"/>',
  derive: '<path d="M4 20 L18 6" stroke-dasharray="2.6 2.2"/><path d="M12.5 6 H18 V11.5"/><path d="M5 6 V11 M5 6 H8" stroke-width="1.3"/>',
  refine: '<path d="M4 20 L18 6" stroke-dasharray="2.6 2.2"/><path d="M12.5 6 H18 V11.5"/><circle cx="7" cy="8" r="2" stroke-width="1.3"/>',
  copy: '<path d="M4 20 L18 6" stroke-dasharray="2.6 2.2"/><path d="M12.5 6 H18 V11.5"/><rect x="4.5" y="5" width="4.5" height="4.5" stroke-width="1.3"/>',
  trace: '<path d="M4 20 L18 6" stroke-dasharray="1 2.6"/><path d="M12.5 6 H18 V11.5"/>',
  allocate: '<path d="M4 20 L18 6" stroke-dasharray="2.6 2.2"/><path d="M12.5 6 H18 V11.5"/><path d="M5 11 L7 6 L9 11 M5.6 9.4 H8.4" stroke-width="1.2"/>',
  control: '<path d="M4 12 H19"/><path d="M14 7 L19.5 12 L14 17"/>',
  object: '<rect x="2.5" y="9" width="6" height="6" rx="1" fill="currentColor" fill-opacity=".2"/><path d="M8.5 12 H19"/><path d="M14 7 L19.5 12 L14 17"/>',
  transition: '<path d="M4 17 C7 7 15 7 19 13"/><path d="M14 13.5 L19.5 13.5 L18.5 8"/>',
  participate: '<path d="M4 18 L20 6"/>',
  include: '<path d="M4 18 L19 7" stroke-dasharray="2.6 2.2"/><path d="M13.5 7 H19 V12.5"/><path d="M5 6 V11" stroke-width="1.5"/>',
  extend: '<path d="M4 18 L19 7" stroke-dasharray="2.6 2.2"/><path d="M13.5 7 H19 V12.5"/><path d="M5 6 H8 M5 8.5 H7.5 M5 11 H8 M5 6 V11" stroke-width="1.2"/>',
  import: '<path d="M4 18 L19 7" stroke-dasharray="2.6 2.2"/><path d="M13.5 7 H19 V12.5"/><path d="M4.5 5.5 h3 v5 h-3 z" stroke-width="1.2"/>',
  bind: '<path d="M4 12 H20" /><path d="M9.5 9.5 h5 M9.5 14.5 h5" stroke-width="1.4"/>',
  connector: '<rect x="2.5" y="9" width="5" height="6" fill="currentColor" stroke="none"/><rect x="16.5" y="9" width="5" height="6" fill="currentColor" stroke="none"/><path d="M7.5 12 H16.5"/>',
  sync: '<path d="M3 12 H20"/><path d="M15 8 L20.5 12 L15 16 Z" fill="currentColor"/>',
  async: '<path d="M3 12 H20"/><path d="M15 7.5 L20.5 12 L15 16.5"/>',
  reply: '<path d="M21 12 H4" stroke-dasharray="2.6 2.2"/><path d="M9 7.5 L3.5 12 L9 16.5"/>',
  create: '<path d="M3 12 H15" stroke-dasharray="2.6 2.2"/><path d="M11 8 L15.5 12 L11 16"/><rect x="16" y="8" width="5.5" height="8" rx="1" fill="currentColor" fill-opacity=".2"/>',
});

/** A palette symbol (or a UI icon when there is no symbol of that name). @param {string} name */
export function toolIcon(name) {
  if (!(name in T)) return icon(name);
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '1.6');
  el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round'); el.setAttribute('aria-hidden', 'true');
  el.innerHTML = T[name];
  return el;
}

/** The symbol for an element kind (with its variant: a control node's or pseudo-state's kind). @param {string} kind @param {Record<string, any>} [props] */
export function symbolFor(kind, props) {
  if (kind === 'controlNode') return props?.nodeKind || 'decision';
  if (kind === 'state') return props?.stateKind ? ({ initial: 'initial', final: 'final', choice: 'choice', history: 'history' })[/** @type {string} */ (props.stateKind)] || 'state' : 'state';
  if (kind === 'message') return props?.msgKind || 'sync';
  return /** @type {Record<string, string>} */ ({
    partDef: 'block', interfaceDef: 'interface', valueType: 'valueType', requirement: 'requirement', testCase: 'testCase', action: 'action',
    region: 'region', actor: 'actor', useCase: 'useCase', package: 'package', constraint: 'constraint', constraintDef: 'constraint',
    attribute: 'value', part: 'part', port: 'port', lifeline: 'lifeline', fragment: 'fragment', operand: 'operand', comment: 'comment',
  })[kind] || 'block';
}

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   symbol: string,
 *   help: string,
 *   group: 'select' | 'element' | 'relationship',
 *   type: 'select' | 'place' | 'link' | 'menu' | 'run',
 *   hint?: string,           // how to use it, shown in the card
 * }} ToolItem
 */

/**
 * The palette strip. `pick` is told when a tool is clicked (sticky when double-clicked).
 * @param {{
 *   items: () => ToolItem[],
 *   pick: (item: ToolItem, sticky: boolean, button: HTMLElement) => void,
 *   labels: () => boolean,
 *   setLabels: (on: boolean) => void,
 * }} o
 */
export function createToolPalette(o) {
  const el = h('div', { class: 'tpal', role: 'toolbar', 'aria-orientation': 'vertical', 'aria-label': 'Tools' });
  const card = h('div', { class: 'tooltip-card', role: 'tooltip', hidden: true });
  /** @type {string} */
  let active = 'select';
  let sticky = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let cardTimer;

  /** @param {HTMLElement} b @param {ToolItem} it */
  function showCard(b, it) {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => {
      if (!card.isConnected) document.body.append(card);
      card.replaceChildren(h('b', {}, it.label), h('span', {}, it.help), it.hint ? h('small', {}, it.hint) : null);
      card.hidden = false;
      const r = b.getBoundingClientRect();
      const cw = card.offsetWidth, ch = card.offsetHeight;
      card.style.left = `${Math.min(r.right + 10, innerWidth - cw - 8)}px`;
      card.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - ch / 2, innerHeight - ch - 8))}px`;
    }, 280);
  }
  const hideCard = () => { clearTimeout(cardTimer); card.hidden = true; };

  function render() {
    const wide = o.labels();
    el.classList.toggle('wide', wide);
    const items = o.items();
    /** @type {HTMLElement[]} */
    const out = [];
    let last = '';
    for (const it of items) {
      if (last && it.group !== last) out.push(h('div', { class: 'tpal-sep', role: 'separator' }, wide ? h('span', {}, it.group === 'relationship' ? 'Relationships' : 'Elements') : null));
      else if (!last && wide && it.group !== 'select') out.push(h('div', { class: 'tpal-sep', role: 'separator' }, h('span', {}, 'Elements')));
      last = it.group;
      const on = active === it.id;
      const b = h('button', {
        class: 'tbtn' + (on ? ' on' : '') + (on && sticky ? ' sticky' : ''), type: 'button', 'data-tool': it.id,
        'aria-label': it.label, 'aria-pressed': it.type === 'menu' || it.type === 'run' ? undefined : String(on), 'aria-haspopup': it.type === 'menu' ? 'menu' : undefined,
      }, toolIcon(it.symbol), wide ? h('span', { class: 'tbtn-label' }, it.label) : null, it.type === 'menu' ? h('span', { class: 'tbtn-more', 'aria-hidden': 'true' }) : null);
      b.addEventListener('click', () => { hideCard(); o.pick(it, false, b); });
      b.addEventListener('dblclick', () => { hideCard(); if (it.type === 'place' || it.type === 'link') o.pick(it, true, b); });
      b.addEventListener('mouseenter', () => showCard(b, it));
      b.addEventListener('mouseleave', hideCard);
      b.addEventListener('focus', () => showCard(b, it));
      b.addEventListener('blur', hideCard);
      out.push(b);
    }
    out.push(h('span', { class: 'tpal-grow' }));
    out.push(h('button', { class: 'tbtn tpal-toggle', type: 'button', 'aria-label': wide ? 'Show icons only' : 'Show tool names', title: wide ? 'Icons only' : 'Show names', onclick: () => { o.setLabels(!wide); } }, icon(wide ? 'chevLeft' : 'chevRight'), wide ? h('span', { class: 'tbtn-label' }, 'Icons only') : null));
    el.replaceChildren(...out);
  }
  render();
  let key = `${o.labels()}`;
  return {
    el, render,
    /** Redraw if the names setting changed. @param {string} [extra] anything else the items depend on (the notation) */
    sync(extra = '') { const k = `${o.labels()}|${extra}`; if (k !== key) { key = k; render(); } },
    /** Show which tool is armed. @param {string} id @param {boolean} [isSticky] */
    setActive(id, isSticky = false) { active = id; sticky = isSticky; render(); },
    active: () => active,
    dispose() { hideCard(); card.remove(); },
  };
}
