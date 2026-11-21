// The run panel, docked beside a behavior diagram: run, step, reset and check, the question a
// decision or fragment asks, events to send to a state machine, values for guards, and the
// trace of what happened. The diagram lights up as it runs (see the marks each adapter gives).
import { h, icon } from './dom.js';

/** @typedef {import('../sim/activity.js').Finding} Finding */
/** @typedef {import('../sim/activity.js').LogEntry} LogEntry */
/**
 * @typedef {{ nodes: Map<string, 'on' | 'done' | 'wait' | 'bad'>, edges: Map<string, 'token' | 'hot' | 'bad' | 'done'>, tokens: Map<string, number> }} Marks
 * @typedef {{
 *   title: string,
 *   help: string,
 *   reset: () => void,
 *   step: () => boolean,
 *   state: () => string,
 *   status: () => string,
 *   question: () => null | { text: string, options: { label: string, run: () => void }[] },
 *   events?: () => { label: string, run: () => void }[],
 *   values: () => { name: string, value: string, set: (v: string) => void }[],
 *   switches?: () => { name: string, on: boolean, set: (on: boolean) => void }[],
 *   log: () => LogEntry[],
 *   check: () => Finding[],
 *   marks: () => Marks,
 * }} RunAdapter
 */

export const emptyMarks = () => /** @type {Marks} */ ({ nodes: new Map(), edges: new Map(), tokens: new Map() });
const SPEEDS = [{ label: 'Slow', ms: 1100 }, { label: 'Normal', ms: 600 }, { label: 'Fast', ms: 220 }];

/**
 * @param {{ adapter: () => RunAdapter, onMarks: (m: Marks) => void, onSelect: (ids: string[]) => void, onClose: () => void }} o
 */
export function createRunPanel(o) {
  let ad = o.adapter();
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  let speed = 1;
  /** @type {Finding[] | null} */
  let findings = null;
  /** Ids a clicked finding points at. @type {string[]} */
  let flagged = [];

  const runBtn = h('button', { class: 'btn sm primary', type: 'button', onclick: () => (timer ? pause() : play()) });
  const stepBtn = h('button', { class: 'btn sm', type: 'button', title: 'One step (.)', onclick: () => { pause(); doStep(); } }, icon('step'), 'Step');
  const resetBtn = h('button', { class: 'btn sm', type: 'button', title: 'Back to the start', onclick: () => { pause(); ad.reset(); findings = null; flagged = []; paint(); } }, icon('reset'), 'Reset');
  const checkBtn = h('button', { class: 'btn sm', type: 'button', title: 'Explore every way it can run and report problems', onclick: () => { findings = ad.check(); flagged = []; paint(); } }, icon('shield'), 'Check');
  const speedSel = h('select', { class: 'field sm run-speed', 'aria-label': 'Speed', onchange: (/** @type {Event} */ e) => { speed = Number(/** @type {HTMLSelectElement} */ (e.target).value); if (timer) { pause(); play(); } } },
    ...SPEEDS.map((sp, i) => h('option', { value: String(i), selected: i === speed }, sp.label)));
  const status = h('div', { class: 'run-status', role: 'status', 'aria-live': 'polite' });
  const body = h('div', { class: 'run-body' });
  const el = h('aside', { class: 'runpanel', 'aria-label': 'Run' },
    h('div', { class: 'run-head' },
      h('b', {}, ad.title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close the run panel', title: 'Close', onclick: () => o.onClose() }, icon('x'))),
    h('p', { class: 'run-help' }, ad.help),
    h('div', { class: 'run-ctl' }, runBtn, stepBtn, resetBtn, checkBtn, speedSel),
    status, body);

  function play() {
    if (ad.state() === 'done' || ad.state() === 'stuck') ad.reset();
    if (!doStep()) { paint(); return; }
    timer = setInterval(() => { if (!doStep()) pause(); }, SPEEDS[speed].ms);
    paint();
  }
  function pause() { clearInterval(timer); timer = undefined; paint(); }
  function doStep() {
    const ok = ad.step();
    paint();
    return ok && ad.state() !== 'choose' && ad.state() !== 'done' && ad.state() !== 'stuck';
  }

  /** @param {string} title @param  {...any} kids */
  const section = (title, ...kids) => h('section', { class: 'run-sec' }, h('h4', {}, title), ...kids);

  function paint() {
    runBtn.replaceChildren(icon(timer ? 'pause' : 'play'), timer ? 'Pause' : ad.state() === 'done' || ad.state() === 'stuck' ? 'Run again' : 'Run');
    status.textContent = ad.status();
    status.className = 'run-status ' + ad.state();
    /** @type {HTMLElement[]} */
    const secs = [];
    const q = ad.question();
    if (q) {
      if (timer) { clearInterval(timer); timer = undefined; runBtn.replaceChildren(icon('play'), 'Run'); }
      secs.push(h('section', { class: 'run-sec run-q' }, h('h4', {}, 'Your choice'), h('p', {}, q.text),
        h('div', { class: 'run-opts' }, ...q.options.map((op) => h('button', { class: 'btn sm', type: 'button', onclick: () => { op.run(); paint(); } }, h('span', { class: 'ellip' }, op.label))))));
    }
    const evs = ad.events?.();
    if (evs) secs.push(section('Send an event', evs.length
      ? h('div', { class: 'run-opts' }, ...evs.map((ev) => h('button', { class: 'btn sm', type: 'button', title: `Send ${ev.label}`, onclick: () => { ev.run(); paint(); } }, h('span', { class: 'ellip mono' }, ev.label))))
      : h('p', { class: 'run-muted' }, ad.state() === 'ready' ? 'Press Run or Step to start the machine.' : 'No active state takes an event now.')));
    const vals = ad.values();
    const sws = ad.switches?.() || [];
    if (vals.length || sws.length) {
      secs.push(section('Values for guards',
        ...vals.map((v) => h('label', { class: 'run-val' }, h('span', { class: 'mono ellip', title: v.name }, v.name),
          h('input', { class: 'field sm mono', type: 'text', value: v.value, placeholder: 'e.g. 25% or 3 [h]', spellcheck: 'false', onchange: (/** @type {Event} */ e) => { v.set(/** @type {HTMLInputElement} */ (e.target).value); paint(); } }))),
        ...sws.map((sw) => h('label', { class: 'run-sw' }, h('input', { type: 'checkbox', checked: sw.on, onchange: (/** @type {Event} */ e) => { sw.set(/** @type {HTMLInputElement} */ (e.target).checked); paint(); } }), h('span', { class: 'ellip' }, `[${sw.name}] holds`)))));
    }
    if (findings) {
      secs.push(section('Check', h('ul', { class: 'run-findings' }, ...findings.map((f) => h('li', { class: `run-f ${f.level}` },
        h('button', { class: 'linkish', type: 'button', disabled: !f.ids.length, onclick: () => { flagged = f.ids; o.onSelect(f.ids); paint(); } },
          h('span', { class: 'run-dot', 'aria-hidden': 'true' }), h('span', {}, f.message)))))));
    }
    const log = ad.log();
    const list = h('ol', { class: 'run-log' }, ...log.slice(-200).map((e) => h('li', { class: e.level || '' },
      h('span', { class: 'run-n mono' }, String(e.step)),
      h('button', { class: 'linkish', type: 'button', disabled: !e.ids.length, onclick: () => o.onSelect(e.ids) }, e.text))));
    secs.push(section('Trace', log.length ? list : h('p', { class: 'run-muted' }, 'Nothing has happened yet.')));
    body.replaceChildren(...secs);
    list.scrollTop = list.scrollHeight;
    const mk = ad.marks();
    for (const id of flagged) { mk.nodes.set(id, 'bad'); mk.edges.set(id, 'bad'); }
    o.onMarks(mk);
  }

  /** The model changed: start over with the new diagram. */
  function refresh() { pause(); ad = o.adapter(); findings = null; flagged = []; paint(); }
  paint();
  return {
    el, refresh, paint,
    /** Keyboard: "." steps. @param {KeyboardEvent} ev */
    key(ev) { if (ev.key === '.') { pause(); doStep(); return true; } return false; },
    dispose() { clearInterval(timer); },
  };
}
