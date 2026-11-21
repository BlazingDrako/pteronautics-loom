// The Systems V: the project's home. The left arm goes down from stakeholder needs to the
// physical design, the bottom is implementation, and the right arm climbs back up through
// verification to validation. Each stage shows how far along it is, measured from the model,
// and is paired across the V with the stage that checks it. Click a stage for its evidence:
// what is done and what is missing, each one click from the element itself.
import { h, s, icon } from '../ui/dom.js';
import { ELEMENTS, LAYERS, kindName } from '../model/metamodel.js';
import { coverage, pct, subRequirements, inLayer } from '../model/trace.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/trace.js').Coverage} Coverage */
/**
 * @typedef {{
 *   id: string, side: 'left' | 'right' | 'bottom', level: number,
 *   title: string, what: string, measure: string, short: string,
 *   total: number, done: number, passed?: number, failed?: number,
 *   items: { el: Element, ok: boolean, note: string }[],
 *   layer: string, add?: { kind: string, layer: string, label: string, props?: Record<string, any> },
 *   pair?: string,
 * }} Stage
 */

/**
 * The stages of the V, measured from the model.
 * @param {Model} m @param {Coverage} [cov] @returns {Stage[]}
 */
export function vStages(m, cov = coverage(m)) {
  const st = (/** @type {Element} */ r) => cov.status.get(r.id);
  /** Right-arm stage: verification of the requirements at one level. @param {string} id @param {number} level @param {string} title @param {string} what @param {Element[]} reqs @param {string} pair @returns {Stage} */
  const verify = (id, level, title, what, reqs, pair) => {
    const items = reqs.map((r) => { const x = st(r); return { el: r, ok: !!x?.passed, note: x?.failed ? 'Failed' : x?.passed ? 'Passed' : x?.verified ? 'Planned, not run' : 'Not verified' }; });
    return {
      id, side: 'right', level, title, what, measure: 'requirements verified', short: 'verified', layer: 'r', pair,
      total: reqs.length, done: reqs.filter((r) => st(r)?.verified).length,
      passed: reqs.filter((r) => st(r)?.passed).length, failed: reqs.filter((r) => st(r)?.failed).length,
      items, add: { kind: 'testCase', layer: 'r', label: 'Add a test case' },
    };
  };
  const needs = cov.byLevel.Need, sys = cov.byLevel.System, sub = cov.byLevel.Subsystem, comp = cov.byLevel.Component;
  const fns = inLayer(m, 'action', 'f');
  const physical = inLayer(m, 'partDef', 'p');
  return [
    {
      id: 'needs', side: 'left', level: 0, title: 'Stakeholder needs', what: 'What the users and owners need', measure: 'broken down into requirements', short: 'broken down', layer: 'r', pair: 'validation',
      total: needs.length, done: needs.filter((r) => subRequirements(m, r.id).length > 0).length,
      items: needs.map((r) => { const k = subRequirements(m, r.id).length; return { el: r, ok: k > 0, note: k ? `${k} requirement${k > 1 ? 's' : ''} come from it` : 'Nothing derived from it yet' }; }),
      add: { kind: 'requirement', layer: 'r', label: 'Add a stakeholder need', props: { level: 'Need' } },
    },
    {
      id: 'system', side: 'left', level: 1, title: 'System requirements', what: 'What the system shall do and be', measure: 'satisfied by the design', short: 'satisfied', layer: 'r', pair: 'sysver',
      total: sys.length, done: sys.filter((r) => st(r)?.satisfied).length,
      items: sys.map((r) => { const x = st(r); return { el: r, ok: !!x?.satisfied, note: x?.direct.satisfy.length ? `Satisfied by ${x.direct.satisfy.map((e) => e.name).join(', ')}` : x?.satisfied ? 'Satisfied through sub-requirements' : 'Nothing satisfies it yet' }; }),
      add: { kind: 'requirement', layer: 'r', label: 'Add a requirement', props: { level: 'System' } },
    },
    {
      id: 'arch', side: 'left', level: 2, title: 'Architecture', what: 'Functions and logical blocks', measure: 'functions allocated', short: 'functions allocated', layer: 'f', pair: 'integration',
      total: cov.functions.total, done: cov.functions.done,
      items: fns.map((f) => ({ el: f, ok: !cov.functions.gaps.includes(f), note: cov.functions.gaps.includes(f) ? 'Not allocated to anything yet' : 'Allocated' })),
      add: { kind: 'action', layer: 'f', label: 'Add a function' },
    },
    {
      id: 'design', side: 'left', level: 3, title: 'Physical design', what: 'The parts that get built or bought', measure: 'logical blocks realized', short: 'logical realized', layer: 'l', pair: 'compver',
      total: cov.logical.total, done: cov.logical.done,
      items: inLayer(m, 'partDef', 'l').map((b) => ({ el: b, ok: !cov.logical.gaps.includes(b), note: cov.logical.gaps.includes(b) ? 'No physical part realizes it yet' : 'Realized physically' })),
      add: { kind: 'partDef', layer: 'p', label: 'Add a physical block' },
    },
    {
      id: 'build', side: 'bottom', level: 4, title: 'Implementation', what: 'Build, buy and code the parts', measure: 'physical parts traced to the design', short: 'traced', layer: 'p',
      total: cov.physical.total, done: cov.physical.done,
      items: physical.map((b) => ({ el: b, ok: !cov.physical.gaps.includes(b), note: cov.physical.gaps.includes(b) ? 'Nothing logical is allocated to it' : 'Traced to the logical design' })),
      add: { kind: 'partDef', layer: 'p', label: 'Add a physical block' },
    },
    verify('compver', 3, 'Component verification', 'Each part does its job', comp, 'design'),
    verify('integration', 2, 'Integration verification', 'The parts work together', sub, 'arch'),
    verify('sysver', 1, 'System verification', 'Meets the system requirements', sys, 'system'),
    verify('validation', 0, 'Validation', 'It meets the stakeholders\' needs', needs, 'needs'),
  ];
}

/** Opened stage per project, kept while the app is open. @type {Map<string, string>} */
const openStage = new Map();

/**
 * @param {{
 *   model: Model,
 *   notation: () => import('../model/metamodel.js').Notation,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   create: (kind: string, owner: string, props?: Record<string, any>) => void,
 *   openTrace: () => void,
 *   openTable: () => void,
 *   openMatrix: () => void,
 * }} ctx
 */
export function createVHomeView(ctx) {
  const { model } = ctx;
  let raf = 0;
  const vbox = h('div', { class: 'vbox' });
  const detail = h('section', { class: 'vdetail', 'aria-live': 'polite' });
  const head = h('div', { class: 'vhead' });
  const scroller = h('div', { class: 'vscroll', tabindex: '-1' }, head, vbox, detail);
  const el = h('div', { class: 'dview vview' }, scroller);

  function invalidate() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  function render() {
    const cov = coverage(model);
    const stages = vStages(model, cov);
    const rootId = model.root().id;
    if (!openStage.has(rootId)) openStage.set(rootId, (stages.find((x) => x.total && x.done < x.total) || stages[0]).id);
    const current = openStage.get(rootId);
    const tests = model.byKind('testCase').length;

    head.replaceChildren(
      h('div', {},
        h('div', { class: 'eyebrow' }, 'Systems V'),
        h('h2', {}, model.root().name)),
      h('p', { class: 'vsum' },
        `${cov.requirements.length} requirement${cov.requirements.length === 1 ? '' : 's'} · ${cov.functions.total} function${cov.functions.total === 1 ? '' : 's'} · ${cov.logical.total} logical and ${cov.physical.total} physical block${cov.physical.total === 1 ? '' : 's'} · ${tests} test${tests === 1 ? '' : 's'}`),
      h('div', { class: 'vhead-actions' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.openTrace() }, icon('trace'), 'RFLP trace'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.openTable() }, icon('table'), 'Requirements table'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.openMatrix() }, icon('matrix'), 'Satisfy matrix')));

    // geometry: the V fills the width, cards step inward as they go down
    const W = Math.max(640, scroller.clientWidth - 48), CW = 220, CH = 104, stepY = 116;
    const stepX = Math.min(118, (W - 2 * CW - 24) / 7);
    const pos = (/** @type {Stage} */ st) => {
      if (st.side === 'bottom') return { x: W / 2 - CW / 2, y: 4 * stepY };
      const x = st.level * stepX;
      return { x: st.side === 'left' ? x : W - CW - x, y: st.level * stepY };
    };
    const H = 4 * stepY + CH + 8;
    const centers = new Map(stages.map((st) => { const p = pos(st); return [st.id, { x: p.x + CW / 2, y: p.y + CH / 2 }]; }));
    const order = ['needs', 'system', 'arch', 'design', 'build', 'compver', 'integration', 'sysver', 'validation'];
    const vpath = order.map((id, i) => { const c = /** @type {{ x: number, y: number }} */ (centers.get(id)); return `${i ? 'L' : 'M'}${c.x} ${c.y}`; }).join(' ');
    const pairs = stages.filter((st) => st.side === 'left' && st.pair).map((st) => {
      const a = pos(st), b = pos(/** @type {Stage} */ (stages.find((x) => x.id === st.pair)));
      return `<path class="vpair" d="M${a.x + CW + 6} ${a.y + CH / 2} L${b.x - 6} ${b.y + CH / 2}"/>`;
    }).join('');
    const svg = s('svg', { class: 'vlines', width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
    svg.innerHTML = `<path class="varm" d="${vpath}"/>${pairs}`;
    const labels = [
      h('div', { class: 'varm-label left', style: { left: '0px', top: `${H + 6}px` } }, 'Define and design ↓'),
      h('div', { class: 'varm-label right', style: { right: '0px', top: `${H + 6}px` } }, '↑ Integrate and verify'),
    ];
    vbox.style.width = `${W}px`; vbox.style.height = `${H + 28}px`;
    vbox.replaceChildren(svg, ...labels, ...stages.map((st) => stageCard(st, pos(st), CW, CH, st.id === current)));

    const st = stages.find((x) => x.id === current) || stages[0];
    detail.replaceChildren(...stageDetail(st));
  }

  /** @param {Stage} st @param {{ x: number, y: number }} p @param {number} w @param {number} hh @param {boolean} on */
  function stageCard(st, p, w, hh, on) {
    const color = LAYERS.find((l) => l.id === st.layer)?.color;
    const pc = pct(st);
    const right = st.side === 'right';
    const passed = right ? pct({ total: st.total, done: st.passed || 0 }) : 0;
    return h('button', {
      class: 'vstage' + (on ? ' on' : '') + (st.total === 0 ? ' blank' : st.done === st.total && (!right || st.passed === st.total) ? ' complete' : ''),
      type: 'button', 'aria-pressed': String(on), title: `${st.title}: ${st.what}. ${st.total ? `${st.done} of ${st.total} ${st.measure}.` : 'Nothing here yet.'}`,
      style: { left: `${p.x}px`, top: `${p.y}px`, width: `${w}px`, height: `${hh}px`, '--lc': color },
      onclick: () => { openStage.set(model.root().id, st.id); render(); },
    },
    h('span', { class: 'vs-title' }, st.title),
    h('span', { class: 'vs-what' }, st.what),
    h('span', { class: 'vs-num' }, h('b', {}, st.total ? `${pc}%` : '—'), h('span', { class: 'muted small' }, st.total ? ` ${st.done}/${st.total} ${st.short}` : ' nothing here yet')),
    h('span', { class: 'cov-bar' + (right ? ' two' : '') },
      right ? h('span', { class: 'pass', style: { width: `${passed}%` } }) : null,
      h('span', { style: { width: `${right ? Math.max(0, pc - passed) : pc}%` } })),
    st.failed ? h('span', { class: 'vs-fail small' }, `${st.failed} failed`) : null);
  }

  /** @param {Stage} st */
  function stageDetail(st) {
    const n = ctx.notation();
    const sorted = [...st.items].sort((a, b) => Number(a.ok) - Number(b.ok));
    const gaps = sorted.filter((x) => !x.ok).length;
    const layerPkg = st.add ? model.layers().find((l) => l.layer === st.add?.layer) : null;
    const pairName = st.pair ? vStages(model).find((x) => x.id === st.pair)?.title : null;
    return [
      h('div', { class: 'vd-head' },
        h('div', {},
          h('h3', {}, st.title),
          h('p', { class: 'muted small' }, st.total
            ? `${st.done} of ${st.total} ${st.measure}${st.side === 'right' ? `, ${st.passed} passed${st.failed ? `, ${st.failed} failed` : ''}` : ''}. ${gaps ? `${gaps} to do.` : 'Nothing missing.'}${pairName ? ` Paired with ${pairName}.` : ''}`
            : `Nothing at this stage yet.${pairName ? ` Paired with ${pairName}.` : ''}`)),
        st.add && layerPkg ? h('button', { class: 'btn sm', type: 'button', onclick: () => st.add && ctx.create(st.add.kind, layerPkg.id, st.add.props) }, icon('plus'), st.add.label) : null),
      sorted.length
        ? h('ul', { class: 'vd-list' }, sorted.slice(0, 200).map(({ el: e, ok, note }) => h('li', {},
          h('button', { class: 'vd-item' + (ctx.selected() === e.id ? ' sel' : ''), type: 'button', title: `${e.name} · ${kindName(e.kind, n)}`, onclick: () => ctx.select(e.id) },
            h('span', { class: 'tchk ' + (ok ? 'ok' : note === 'Failed' ? 'bad' : note.startsWith('Planned') ? 'plan' : 'gap') }, ok ? '✓' : note === 'Failed' ? '✕' : '!'),
            h('span', { class: 'kbadge' }, ELEMENTS[e.kind].abbr),
            e.kind === 'requirement' && e.props.reqId ? h('span', { class: 'mono small vd-id' }, e.props.reqId) : null,
            h('span', { class: 'vd-name' }, e.name),
            h('span', { class: 'vd-note muted small' }, note)))),
        sorted.length > 200 ? h('li', { class: 'muted small' }, `and ${sorted.length - 200} more (see the RFLP trace)`) : null)
        : h('p', { class: 'lcard-empty' }, st.side === 'right' ? 'Requirements at this level appear here once they exist. Mark a test case Pass or Fail in the inspector to record a result.' : 'Nothing here yet.'),
    ];
  }

  const unsub = model.subscribe(() => invalidate());
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => invalidate()) : null;
  ro?.observe(scroller);
  invalidate();
  return {
    el, render, invalidate,
    syncSelection: () => invalidate(),
    focus: () => scroller.focus({ preventScroll: true }),
    dispose() { cancelAnimationFrame(raf); unsub(); ro?.disconnect(); },
  };
}
