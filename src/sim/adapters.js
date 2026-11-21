// Run adapters: each engine (activity, state machine, scenario) as the run panel sees it, and
// the marks that light up its diagram.
import { createActivityRun, checkActivity } from './activity.js';
import { createMachineRun, checkMachine } from './statemachine.js';
import { createSequenceRun, checkSequence } from './sequence.js';
import { parseExpr, evaluate } from '../analysis/expr.js';
import { emptyMarks } from '../ui/runpanel.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../ui/runpanel.js').RunAdapter} RunAdapter */

/**
 * A value typed in the panel: "25%", "3 [h]", "true", "12". Unreadable text clears the value.
 * @param {Map<string, any>} vars @param {Map<string, string>} raw @param {string} name @param {string} text
 */
function setVar(vars, raw, name, text) {
  const t = text.trim();
  raw.set(name, t);
  if (!t) { vars.delete(name); return; }
  try {
    const v = evaluate(parseExpr(t), () => undefined);
    vars.set(name, v);
  } catch { vars.delete(name); }
}
/** @param {Map<string, any>} vars @param {Map<string, string>} raw @param {string[]} names */
const valueRows = (vars, raw, names) => names.map((name) => ({ name, value: raw.get(name) || '', set: (/** @type {string} */ v) => setVar(vars, raw, name, v) }));

/** @param {Model} m @param {Element} d @returns {RunAdapter} */
export function activityAdapter(m, d) {
  const run = createActivityRun(m, /** @type {string} */ (d.owner));
  /** @type {Map<string, string>} */
  const raw = new Map();
  const nm = (/** @type {string} */ id) => m.get(id)?.name || '?';
  return {
    title: `Run ${m.get(/** @type {string} */ (d.owner))?.name}`,
    help: 'Tokens flow from the initial node. An action runs when every flow into it has a token; a decision takes the way whose guard holds, or asks you.',
    reset: () => run.reset(),
    step: () => run.step(),
    state: () => run.state,
    status: () => {
      const n = [...run.tokens().values()].reduce((a, b) => a + b, 0);
      switch (run.state) {
        case 'ready': return 'Ready. Press Run, or Step through it.';
        case 'choose': return `Step ${run.stepNo}: waiting for your choice.`;
        case 'done': return `Finished after ${run.stepNo} steps.`;
        case 'stuck': return `Stuck at step ${run.stepNo}.`;
        default: return `Step ${run.stepNo}: ${n} token${n === 1 ? '' : 's'} moving.`;
      }
    },
    question: () => {
      const p = run.pending;
      if (!p) return null;
      return { text: `${nm(p.node)}: which way?`, options: p.options.map((f) => ({ label: f.guard ? `[${f.guard}]` : `to ${nm(f.to)}`, run: () => run.choose(f.id) })) };
    },
    values: () => valueRows(run.vars, raw, run.guardVars()),
    log: () => run.log,
    check: () => checkActivity(m, /** @type {string} */ (d.owner)),
    marks: () => {
      const mk = emptyMarks();
      for (const [id] of run.fired()) mk.nodes.set(id, 'done');
      for (const id of run.firing()) mk.nodes.set(id, 'on');
      // a node holding tokens it cannot use yet (a join, an action waiting for its other flows)
      for (const [f] of run.tokens()) {
        const fl = run.net.flows.find((x) => x.id === f);
        if (!fl) continue;
        const node = run.net.nodes.get(fl.to);
        const ins = run.net.ins.get(fl.to) || [];
        if ((node?.kind === 'action' || node?.kind === 'join') && !ins.every((x) => run.tokens().has(x.id))) mk.nodes.set(fl.to, 'wait');
      }
      if (run.pending) mk.nodes.set(run.pending.node, 'wait');
      for (const id of run.moved()) mk.edges.set(id, 'hot');
      for (const [f, n] of run.tokens()) { mk.edges.set(f, 'token'); mk.tokens.set(f, n); }
      if (run.pending) for (const f of run.pending.options) mk.edges.set(f.id, 'token');
      return mk;
    },
  };
}

/** @param {Model} m @param {Element} d @returns {RunAdapter} */
export function machineAdapter(m, d) {
  const block = /** @type {string} */ (d.owner);
  const run = createMachineRun(m, block);
  /** @type {Map<string, string>} */
  const raw = new Map();
  /** Events sent so far, to try new ones first when running by itself. @type {Map<string, number>} */
  const tried = new Map();
  return {
    title: `Run ${m.get(block)?.name}`,
    help: 'Run starts the machine and sends events by itself, trying new ones first. Or send events yourself below. Guards you cannot write as an expression are switches.',
    reset: () => { run.reset(); tried.clear(); },
    step: () => {
      if (run.state === 'ready') { run.start(); return true; }
      if (run.state !== 'running') return false;
      const evs = run.events();
      if (!evs.length) { run.log.push({ step: run.stepNo, text: 'No active state takes an event: the run stops here', ids: [...run.active()], level: 'info' }); return false; }
      // prefer events that lead somewhere new, then the least tried
      const leadsNew = (/** @type {string} */ ev) => run.machine.trs.some((t) => t.trigger === ev && run.active().has(t.from) && !run.visited().has(t.to));
      const ev = [...evs].sort((a, b) => Number(leadsNew(b)) - Number(leadsNew(a)) || (tried.get(a) || 0) - (tried.get(b) || 0))[0];
      tried.set(ev, (tried.get(ev) || 0) + 1);
      run.send(ev);
      return true;
    },
    state: () => run.state,
    status: () => {
      if (run.state === 'ready') return 'Ready. Press Run, or Step to start the machine.';
      const leaves = [...run.active()].filter((id) => m.get(id)?.kind === 'state' && !m.children(id).some((c) => run.active().has(c.id)));
      if (run.state === 'done') return `Finished after ${run.stepNo} events.`;
      return `In ${leaves.map((id) => m.get(id)?.name).join(' and ') || 'nothing'} after ${run.stepNo} event${run.stepNo === 1 ? '' : 's'}.`;
    },
    question: () => null,
    events: () => (run.state === 'running' ? run.events().map((ev) => ({ label: ev, run: () => { tried.set(ev, (tried.get(ev) || 0) + 1); run.send(ev); } })) : []),
    values: () => valueRows(run.vars, raw, run.guardVars()),
    switches: () => [...run.guardSwitches()].map(([name, on]) => ({ name, on, set: (/** @type {boolean} */ v) => { run.switches.set(name, v); } })),
    log: () => run.log,
    check: () => checkMachine(m, block),
    marks: () => {
      const mk = emptyMarks();
      for (const id of run.visited()) mk.nodes.set(id, 'done');
      for (const id of run.active()) mk.nodes.set(id, 'on');
      for (const id of run.taken()) mk.edges.set(id, 'hot');
      return mk;
    },
  };
}

/** @param {Model} m @param {string} interactionId @returns {RunAdapter} */
export function sequenceAdapter(m, interactionId) {
  const run = createSequenceRun(m, interactionId);
  /** @type {Map<string, string>} */
  const raw = new Map();
  return {
    title: `Play ${m.get(interactionId)?.name}`,
    help: 'Messages play from top to bottom. At an alt, opt or loop, the guard decides when it can; otherwise you choose.',
    reset: () => run.reset(),
    step: () => run.step(),
    state: () => run.state,
    status: () => (run.state === 'ready' ? 'Ready. Press Play, or Step through it.' : run.state === 'done' ? `Over after ${run.played().size} messages.` : run.state === 'choose' ? 'Waiting for your choice.' : `Message ${run.played().size}.`),
    question: () => { const p = run.pending; return p ? { text: p.text, options: p.options.map((o) => ({ label: o.label, run: () => run.answer(o.value) })) } : null; },
    values: () => valueRows(run.vars, raw, run.guardVars()),
    log: () => run.log,
    check: () => checkSequence(m, interactionId),
    marks: () => {
      const mk = emptyMarks();
      for (const id of run.played()) mk.edges.set(id, 'done');
      const cur = run.current();
      if (cur) mk.edges.set(cur, 'hot');
      for (const id of run.activeLifelines()) mk.nodes.set(id, 'on');
      if (cur) { const e = m.get(cur); if (e) { mk.nodes.set(e.props.from, 'on'); mk.nodes.set(e.props.to, 'on'); } }
      if (run.pending) mk.nodes.set(run.pending.frag, 'wait');
      return mk;
    },
  };
}
