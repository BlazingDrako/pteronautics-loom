// Running a state machine. The machine starts at its initial state and follows completion
// transitions (those without a trigger) by itself; you send events (the triggers) and it
// moves: exit actions run from the inside out, then the transition's effect, then entry
// actions from the outside in. Composite states enter their own initial state; regions run
// side by side; a history state brings back the last active state; a choice takes the way
// whose guard holds.
//
// Guards that are not expressions Loom can evaluate ("preflight ok") are shown in the run
// panel as switches, on by default, so you can try both ways.
import { guardValue, guardNames } from './activity.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('./activity.js').Finding} Finding */
/** @typedef {import('./activity.js').LogEntry} LogEntry */
/** @typedef {{ id: string, from: string, to: string, trigger: string, guard: string, effect: string }} Tr */

const MAX_CHAIN = 50;
/** Pseudo-state kinds (not states you can be in). */
const PSEUDO = /** @type {Record<string, true>} */ ({ initial: true, final: true, choice: true, history: true });

/** States, regions and transitions of a block's machine. @param {Model} m @param {string} blockId */
export function machineOf(m, blockId) {
  /** @type {Map<string, Element>} */
  const states = new Map();
  const walk = (/** @type {string} */ id) => { for (const c of m.children(id)) if (c.kind === 'state' || c.kind === 'region') { states.set(c.id, c); walk(c.id); } };
  walk(blockId);
  /** @type {Tr[]} */
  const trs = m.byKind('transition').filter((t) => states.has(t.props.from) && states.has(t.props.to))
    .map((t) => ({ id: t.id, from: t.props.from, to: t.props.to, trigger: String(t.props.trigger || '').trim(), guard: String(t.props.guard || '').trim(), effect: String(t.props.effect || '').trim() }));
  const kindOf = (/** @type {string} */ id) => { const e = states.get(id); return e?.kind === 'region' ? 'region' : e?.props.stateKind || 'state'; };
  /** Children states (and regions) of a container. @param {string} id */
  const inside = (id) => m.children(id).filter((c) => states.has(c.id));
  /** The container a state lives in (a state, region or the block). @param {string} id */
  const parent = (id) => /** @type {string} */ (states.get(id)?.owner);
  return { blockId, states, trs, kindOf, inside, parent };
}

/**
 * A run of a block's state machine.
 * @param {Model} m @param {string} blockId
 */
export function createMachineRun(m, blockId) {
  const mc = machineOf(m, blockId);
  const { states, trs, kindOf, inside, parent } = mc;
  /** Active states (and regions). @type {Set<string>} */
  let active = new Set();
  /** Last active child of each container, for history states. @type {Map<string, string>} */
  const history = new Map();
  /** @type {LogEntry[]} */
  const log = [];
  /** Values for guards; guards Loom cannot evaluate are switches (true by default). @type {Map<string, any>} */
  const vars = new Map();
  /** @type {Map<string, boolean>} */
  const switches = new Map();
  /** States entered or exited in the last step, and the transitions taken. */
  let lastTaken = new Set(), lastEntered = new Set();
  /** @type {Set<string>} */
  const visited = new Set();
  let step = 0;
  let state = /** @type {'ready' | 'running' | 'done'} */ ('ready');
  const name = (/** @type {string} */ id) => states.get(id)?.name || '?';

  /** Does a guard hold? @param {string} g */
  const holds = (g) => {
    if (!g) return true;
    if (/^else$/i.test(g)) return false;
    const v = guardValue(g, vars);
    if (v !== null) return v;
    if (!switches.has(g)) switches.set(g, true);
    return /** @type {boolean} */ (switches.get(g));
  };
  /** The containers from a state up to the block, nearest first. @param {string} id */
  const ancestors = (id) => { const out = []; for (let p = parent(id); p && p !== blockId; p = parent(p)) out.push(p); return out; };

  /** @param {string[]} texts @param {string} id */
  function enter(texts, id, deep = 0) {
    if (deep > MAX_CHAIN) return;
    const k = kindOf(id);
    if (k === 'history') {
      const box = parent(id);
      const back = history.get(box);
      if (back) { texts.push(`back to ${name(back)} (history)`); enter(texts, back, deep + 1); return; }
      const out = trs.find((t) => t.from === id);
      if (out) { enter(texts, out.to, deep + 1); return; }
      enterDefault(texts, box, deep + 1);
      return;
    }
    if (k === 'choice') {
      const outs = trs.filter((t) => t.from === id);
      const go = outs.find((t) => t.guard && !/^else$/i.test(t.guard) && holds(t.guard)) || outs.find((t) => /^else$/i.test(t.guard)) || outs.find((t) => !t.guard);
      if (!go) { log.push({ step, text: `${name(id)}: no guard holds and there is no else`, ids: [id], level: 'warn' }); return; }
      take(texts, go, deep + 1);
      return;
    }
    active.add(id); lastEntered.add(id); visited.add(id);
    const box = parent(id);
    if (box !== blockId) history.set(box, id);
    const e = states.get(id);
    if (k === 'region') { enterDefault(texts, id, deep + 1); return; }
    if (k === 'final') {
      texts.push(`${name(id)}`);
      if (box === blockId) { state = 'done'; texts.push('the machine has finished'); return; }
      return;
    }
    if (k === 'initial') return;
    texts.push(e?.props.entry ? `enter ${name(id)} (entry / ${e.props.entry})` : `enter ${name(id)}`);
    const kids = inside(id);
    if (kids.some((c) => c.kind === 'region')) for (const r of kids.filter((c) => c.kind === 'region')) enter(texts, r.id, deep + 1);
    else if (kids.length) enterDefault(texts, id, deep + 1);
  }
  /** Enter a container's initial state. @param {string[]} texts @param {string} box @param {number} deep */
  function enterDefault(texts, box, deep) {
    const init = inside(box).find((c) => c.props.stateKind === 'initial');
    if (!init) return;
    visited.add(init.id);
    const out = trs.find((t) => t.from === init.id);
    if (out) take(texts, out, deep + 1);
  }
  /** Leave a state and everything active inside it. @param {string[]} texts @param {string} id */
  function exit(texts, id) {
    for (const c of inside(id)) if (active.has(c.id)) exit(texts, c.id);
    if (!active.has(id)) return;
    active.delete(id);
    const e = states.get(id);
    if (e?.kind === 'state' && e.props.exit) texts.push(`exit ${name(id)} (exit / ${e.props.exit})`);
  }
  /** Take a transition. @param {string[]} texts @param {Tr} t @param {number} deep */
  function take(texts, t, deep = 0) {
    lastTaken.add(t.id);
    // leave everything up to (not including) the innermost container holding both ends
    const up = [t.from, ...ancestors(t.from)];
    const down = new Set([t.to, ...ancestors(t.to)]);
    const lca = up.find((x) => down.has(x) && x !== t.from && x !== t.to) || [...ancestors(t.from)].find((x) => down.has(x)) || blockId;
    // the outermost active state below the common container, on the source's side
    let top = t.from;
    for (const a of ancestors(t.from)) { if (a === lca) break; top = a; }
    if (t.from === t.to) top = t.from;
    if (active.has(top) || kindOf(top) === 'initial') exit(texts, top);
    if (t.effect) texts.push(`do ${t.effect}`);
    // enter from below the common container down to the target
    const path = [t.to, ...ancestors(t.to)];
    const cut = path.indexOf(lca);
    const chain = (cut >= 0 ? path.slice(0, cut) : path).reverse();
    for (const id of chain.slice(0, -1)) {
      if (active.has(id)) continue;
      active.add(id); lastEntered.add(id); visited.add(id);
      const e = states.get(id);
      const box = parent(id);
      if (box !== blockId) history.set(box, id);
      if (e?.kind === 'state') texts.push(e.props.entry ? `enter ${name(id)} (entry / ${e.props.entry})` : `enter ${name(id)}`);
      // sibling regions of the path start at their own initial states
      if (e?.kind === 'state') for (const r of inside(id).filter((c) => c.kind === 'region' && !chain.includes(c.id))) enter(texts, r.id, deep + 1);
    }
    enter(texts, t.to, deep + 1);
  }

  /** Transitions without a trigger that can fire now (completion). */
  function completions() {
    /** @type {Tr[]} */
    const out = [];
    for (const id of active) {
      const k = kindOf(id);
      if (k !== 'state') continue;
      const kids = inside(id);
      // a composite completes when all its regions (or itself) reached a final state
      const done = !kids.length || (kids.some((c) => c.kind === 'region')
        ? kids.filter((c) => c.kind === 'region').every((r) => inside(r.id).some((s) => s.props.stateKind === 'final' && active.has(s.id)))
        : kids.some((s) => s.props.stateKind === 'final' && active.has(s.id)));
      if (!done) continue;
      const t = trs.find((x) => x.from === id && !x.trigger && holds(x.guard));
      if (t) out.push(t);
    }
    return out;
  }
  /** Follow completion transitions until none are left. @param {string[]} texts */
  function settle(texts) {
    for (let i = 0; i < MAX_CHAIN; i++) {
      const c = completions();
      if (!c.length) return;
      for (const t of c) if (active.has(t.from)) take(texts, t);
    }
    log.push({ step, text: 'Completion transitions keep firing: a loop without a trigger?', ids: [], level: 'warn' });
  }

  function start() {
    state = 'running';
    /** @type {string[]} */
    const texts = [];
    const init = inside(blockId).find((c) => c.props.stateKind === 'initial');
    if (!init) { log.push({ step, text: 'There is no initial state at the top, so the machine cannot start', ids: [], level: 'warn' }); state = 'done'; return; }
    visited.add(init.id);
    const t = trs.find((x) => x.from === init.id);
    if (!t) { log.push({ step, text: `${init.name} has no transition out`, ids: [init.id], level: 'warn' }); state = 'done'; return; }
    take(texts, t);
    settle(texts);
    log.push({ step, text: `Start: ${texts.join(' · ')}`, ids: [...lastTaken, ...lastEntered] });
  }

  /** Events the machine can take now: triggers of transitions out of active states. */
  function events() {
    const out = new Set();
    for (const t of trs) if (t.trigger && active.has(t.from)) out.add(t.trigger);
    return [...out];
  }
  /** Send an event. @param {string} ev */
  function send(ev) {
    if (state !== 'running') return false;
    step++;
    lastTaken = new Set(); lastEntered = new Set();
    // innermost active states first; one transition per state that is still active
    const depth = (/** @type {string} */ id) => ancestors(id).length;
    const cand = trs.filter((t) => t.trigger === ev && active.has(t.from)).sort((a, b) => depth(b.from) - depth(a.from));
    /** @type {string[]} */
    const texts = [];
    const firedFrom = new Set();
    let any = false;
    for (const t of cand) {
      if (!active.has(t.from)) continue;
      // an inner transition on the same event wins over an outer one
      if ([...firedFrom].some((f) => mc.states.has(f) && [f, ...ancestors(f)].includes(t.from))) continue;
      if (!holds(t.guard)) { texts.push(`${ev} ignored by ${name(t.from)}: [${t.guard}] does not hold`); continue; }
      take(texts, t);
      firedFrom.add(t.from);
      any = true;
    }
    if (any) settle(texts);
    log.push({ step, text: `${ev}: ${texts.length ? texts.join(' · ') : 'no state takes it now'}`, ids: [...lastTaken, ...lastEntered], level: any ? undefined : 'info' });
    return any;
  }

  return {
    machine: mc, log, vars, switches,
    start() { if (state === 'ready') { lastTaken = new Set(); lastEntered = new Set(); start(); } },
    send, events,
    reset() { active = new Set(); history.clear(); log.length = 0; lastTaken = new Set(); lastEntered = new Set(); visited.clear(); step = 0; state = 'ready'; },
    get state() { return state; },
    get stepNo() { return step; },
    active: () => active,
    taken: () => lastTaken,
    entered: () => lastEntered,
    visited: () => visited,
    /** Guards the run cannot evaluate, which the panel offers as switches. */
    guardSwitches: () => { for (const t of trs) if (t.guard && !/^else$/i.test(t.guard) && guardValue(t.guard, vars) === null && !guardNames(t.guard).length) holds(t.guard); return switches; },
    guardVars: () => [...new Set(trs.flatMap((t) => guardNames(t.guard)))],
  };
}

/**
 * Check a state machine: structure, then every state it can reach.
 * @param {Model} m @param {string} blockId @returns {Finding[]}
 */
export function checkMachine(m, blockId) {
  const mc = machineOf(m, blockId);
  const { states, trs, kindOf, inside } = mc;
  /** @type {Finding[]} */
  const out = [];
  if (!states.size) return [{ level: 'info', message: 'The block has no states', ids: [] }];
  const realStates = [...states.values()].filter((s) => s.kind === 'state' && !PSEUDO[s.props.stateKind]);
  const inits = inside(blockId).filter((c) => c.props.stateKind === 'initial');
  if (!inits.length) out.push({ level: 'error', message: 'There is no initial state at the top level', ids: [] });
  if (inits.length > 1) out.push({ level: 'warn', message: 'There is more than one initial state at the top level', ids: inits.map((s) => s.id) });
  for (const s of states.values()) {
    const outs = trs.filter((t) => t.from === s.id);
    const k = kindOf(s.id);
    if (k === 'initial') {
      if (outs.length !== 1) out.push({ level: 'error', message: `${s.name} must have exactly one transition out (it has ${outs.length})`, ids: [s.id] });
      else if (outs[0].trigger) out.push({ level: 'warn', message: `The transition out of ${s.name} should not have a trigger`, ids: [outs[0].id] });
    }
    if (k === 'choice') {
      if (outs.length < 2) out.push({ level: 'warn', message: `${s.name} has ${outs.length} way${outs.length === 1 ? '' : 's'} out: a choice chooses between transitions`, ids: [s.id] });
      if (outs.some((t) => !t.guard)) out.push({ level: 'warn', message: `${s.name}: give each way out a guard (one can be else)`, ids: [s.id] });
    }
    if (k === 'state') {
      const kids = inside(s.id);
      const states2 = kids.filter((c) => c.kind === 'state');
      if (states2.length && !kids.some((c) => c.kind === 'region') && !states2.some((c) => c.props.stateKind === 'initial')) out.push({ level: 'warn', message: `${s.name} has states inside but no initial state`, ids: [s.id] });
      // the same event twice from one state, with no guards to tell them apart
      /** @type {Map<string, Tr[]>} */
      const byEv = new Map();
      for (const t of outs) { const key = t.trigger || '(completion)'; byEv.set(key, [...(byEv.get(key) || []), t]); }
      for (const [ev, list] of byEv) if (list.length > 1 && list.filter((t) => !t.guard).length > 1) out.push({ level: 'warn', message: `${s.name} has ${list.length} transitions on ${ev} without guards: which one is taken is not defined`, ids: list.map((t) => t.id) });
    }
    if (k === 'region') {
      const kids = inside(s.id);
      if (kids.length && !kids.some((c) => c.props.stateKind === 'initial')) out.push({ level: 'warn', message: `Region ${s.name} has no initial state`, ids: [s.id] });
    }
  }
  // ---- explore: every event from every reachable configuration (guards either way) ----
  const reached = new Set();
  /** @type {Set<string>} */
  const deadEnds = new Set();
  if (inits.length) {
    const seen = new Set();
    let capped = false;
    /** Replay a path of events with guards on, then try each guard both ways. */
    const queue = [/** @type {{ evs: string[], sw: Record<string, boolean> }} */ ({ evs: [], sw: {} })];
    const guards = [...new Set(trs.map((t) => t.guard).filter((g) => g && !/^else$/i.test(g)))];
    while (queue.length) {
      if (seen.size > 1500) { capped = true; break; }
      const q = /** @type {{ evs: string[], sw: Record<string, boolean> }} */ (queue.shift());
      const run = createMachineRun(m, blockId);
      for (const g of guards) run.switches.set(g, q.sw[g] ?? true);
      run.start();
      for (const ev of q.evs) run.send(ev);
      const conf = [...run.active()].sort().join('|') + '#' + run.state;
      run.visited().forEach((x) => reached.add(x));
      if (seen.has(conf)) continue;
      seen.add(conf);
      if (run.state !== 'running') continue;
      const evs = run.events();
      if (!evs.length) for (const a of run.active()) if (kindOf(a) === 'state' && !inside(a).some((c) => run.active().has(c.id))) deadEnds.add(a);
      for (const ev of evs) {
        queue.push({ evs: [...q.evs, ev], sw: q.sw });
        // the same event with each relevant guard switched off
        for (const t of trs.filter((x) => x.trigger === ev && x.guard && run.active().has(x.from))) queue.push({ evs: [...q.evs, ev], sw: { ...q.sw, [t.guard]: false } });
      }
    }
    for (const s of realStates) if (!reached.has(s.id)) out.push({ level: 'warn', message: `${s.name} can never be reached`, ids: [s.id] });
    for (const id of deadEnds) out.push({ level: 'warn', message: `Once in ${states.get(id)?.name}, nothing can happen: no transition out, and it is not a final state`, ids: [id] });
    if (capped) out.push({ level: 'info', message: 'The machine has many configurations; the first 1,500 were checked', ids: [] });
  }
  if (!out.some((f) => f.level === 'error' || f.level === 'warn')) out.unshift({ level: 'ok', message: `Every state can be reached and left. ${realStates.length} states, ${trs.length} transitions checked`, ids: [] });
  return out;
}
