// Playing a scenario. Messages play top to bottom; at a fragment the run asks (or works out
// from the values) which case happens: one operand of an alt, an opt or not, a loop again or
// not, every operand of a par. Check looks for replies with no call, calls that never get a
// reply, fragments with missing guards, silent lifelines, and messages that the receiver's
// state machine never accepts.
import { guardValue, guardNames } from './activity.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('./activity.js').Finding} Finding */
/** @typedef {import('./activity.js').LogEntry} LogEntry */
/** @typedef {{ label: string, value: string }} Option */

const MAX_LOOPS = 20;

/** "capture()" → "capture"; "imageStored" stays. @param {string} name */
export const signal = (name) => name.replace(/\(.*$/, '').trim();

/**
 * A run of an interaction.
 * @param {Model} m @param {string} interactionId
 */
export function createSequenceRun(m, interactionId) {
  /** Frames being played: the container, the index of the next item, and for loops how often. @type {{ owner: string, i: number, frag?: string, loops?: number }[]} */
  let stack = [];
  /** @type {LogEntry[]} */
  const log = [];
  /** @type {Map<string, any>} */
  const vars = new Map();
  /** @type {string | null} */
  let current = null;
  /** Lifelines activated by calls not yet replied to. @type {string[]} */
  let calls = [];
  /** @type {Set<string>} */
  const played = new Set();
  /** @type {null | { frag: string, kind: string, text: string, options: Option[] }} */
  let pending = null;
  let step = 0;
  let state = /** @type {'ready' | 'running' | 'done'} */ ('ready');
  const nm = (/** @type {string | null | undefined} */ id) => (id ? m.get(id)?.name || '?' : '?');
  const items = (/** @type {string} */ owner) => m.children(owner).filter((c) => c.kind === 'message' || c.kind === 'fragment');
  const operands = (/** @type {string} */ frag) => m.children(frag).filter((c) => c.kind === 'operand');

  /** Enter a fragment: decide what plays, or ask. @param {Element} f */
  function enterFragment(f) {
    const ops = operands(f.id);
    const op = f.props.operator;
    if (!ops.length) { log.push({ step, text: `${f.name} (${op}) has no cases`, ids: [f.id], level: 'warn' }); return; }
    if (op === 'par' || op === 'critical' || op === 'seq' || op === 'strict') {
      // play every operand, in order (a par's messages may interleave; Loom plays them one case at a time)
      for (let i = ops.length - 1; i >= 0; i--) stack.push({ owner: ops[i].id, i: 0 });
      log.push({ step, text: `${f.name}: ${op}${op === 'par' ? ', every case' : ''}`, ids: [f.id] });
      return;
    }
    if (op === 'alt') {
      const known = ops.map((o) => ({ o, v: o.props.guard ? guardValue(o.props.guard, vars) : null }));
      const yes = known.find((x) => x.v === true);
      if (yes) { choose(f.id, yes.o.id, true); return; }
      const open = known.filter((x) => x.v !== false);
      if (open.length === 1) { choose(f.id, open[0].o.id, true); return; }
      pending = { frag: f.id, kind: 'alt', text: `${f.name}: which case?`, options: open.map((x) => ({ label: x.o.props.guard ? `[${x.o.props.guard}]` : x.o.name, value: x.o.id })) };
      return;
    }
    // opt, loop, break: once (or again), or not
    const g = ops[0].props.guard;
    const v = g ? guardValue(g, vars) : null;
    if (v !== null) { choose(f.id, v ? ops[0].id : '', true); return; }
    pending = { frag: f.id, kind: op, text: `${f.name}${g ? ` [${g}]` : ''}: ${op === 'loop' ? 'go round the loop?' : op === 'break' ? 'break out here?' : 'does it happen?'}`, options: [{ label: op === 'loop' ? 'Once more' : 'Yes', value: ops[0].id }, { label: op === 'loop' ? 'Done looping' : 'No', value: '' }] };
  }

  /** Answer the question a fragment asked. @param {string} fragId @param {string} operandId @param {boolean} [auto] */
  function choose(fragId, operandId, auto = false) {
    const f = m.get(fragId);
    if (!f) return;
    pending = null;
    if (!operandId) { log.push({ step, text: `${f.name}: ${f.props.operator === 'loop' ? 'loop ends' : 'skipped'}`, ids: [f.id] }); return; }
    const op = m.get(operandId);
    if (f.props.operator === 'loop') {
      const top = stack[stack.length - 1];
      const n = top && top.frag === fragId ? (top.loops || 0) + 1 : 1;
      if (top && top.frag === fragId) stack.pop();
      if (n > MAX_LOOPS) { log.push({ step, text: `${f.name}: stopped after ${MAX_LOOPS} rounds`, ids: [f.id], level: 'warn' }); return; }
      // the loop frame comes back to the fragment after its body
      stack.push({ owner: operandId, i: 0, frag: fragId, loops: n });
      log.push({ step, text: `${f.name}: round ${n}${auto ? ' (guard holds)' : ''}`, ids: [f.id] });
      return;
    }
    stack.push({ owner: operandId, i: 0, frag: f.props.operator === 'break' ? fragId : undefined });
    log.push({ step, text: `${f.name}: ${op?.props.guard ? `[${op.props.guard}]` : op?.name}${auto ? ' (guard holds)' : ''}`, ids: [f.id, operandId] });
  }

  /** Play up to the next message. @returns {boolean} */
  function next() {
    if (state === 'done' || pending) return false;
    if (state === 'ready') { state = 'running'; stack = [{ owner: interactionId, i: 0 }]; }
    step++;
    current = null;
    for (let guard = 0; guard < 500; guard++) {
      const top = stack[stack.length - 1];
      if (!top) { state = 'done'; log.push({ step, text: 'The scenario is over', ids: [] }); return false; }
      const list = items(top.owner);
      if (top.i >= list.length) {
        stack.pop();
        if (top.frag && m.get(top.frag)?.props.operator === 'loop') {
          // ask again whether to go round
          stack.push({ owner: top.owner, i: list.length, frag: top.frag, loops: top.loops });
          const f = /** @type {Element} */ (m.get(top.frag));
          const g = operands(f.id)[0]?.props.guard;
          const v = g ? guardValue(g, vars) : null;
          if (v !== null) { choose(f.id, v ? top.owner : '', true); if (!v) stack.pop(); continue; }
          pending = { frag: f.id, kind: 'loop', text: `${f.name}${g ? ` [${g}]` : ''}: go round again?`, options: [{ label: 'Once more', value: top.owner }, { label: 'Done looping', value: '' }] };
          return true;
        }
        if (top.frag && m.get(top.frag)?.props.operator === 'break') { stack = []; state = 'done'; log.push({ step, text: `${nm(top.frag)}: the scenario breaks off here`, ids: [top.frag] }); return true; }
        continue;
      }
      const it = list[top.i++];
      if (it.kind === 'fragment') { enterFragment(it); if (pending) return true; continue; }
      // a message
      current = it.id;
      played.add(it.id);
      const kind = it.props.msgKind;
      const from = it.props.from, to = it.props.to;
      if (kind === 'sync' && from !== to) calls.push(to);
      if (kind === 'reply') { const k = calls.lastIndexOf(from); if (k >= 0) calls.splice(k, 1); }
      const arrow = kind === 'reply' ? '⇠' : kind === 'async' ? '→' : '⟶';
      log.push({ step, text: `${nm(from)} ${arrow} ${nm(to)}: ${it.name}${kind === 'reply' ? ' (reply)' : kind === 'async' ? ' (signal)' : ''}`, ids: [it.id] });
      return true;
    }
    return false;
  }

  /** Answer the pending question and leave the loop frame tidy. @param {string} value */
  function answer(value) {
    if (!pending) return;
    const p = pending;
    if (p.kind === 'loop') {
      const top = stack[stack.length - 1];
      if (!value) { pending = null; if (top && top.frag === p.frag) stack.pop(); log.push({ step, text: `${nm(p.frag)}: loop ends`, ids: [p.frag] }); return; }
    }
    choose(p.frag, value);
  }

  return {
    log, vars,
    step: next, answer,
    reset() { stack = []; log.length = 0; current = null; calls = []; played.clear(); pending = null; step = 0; state = 'ready'; },
    get state() { return pending ? 'choose' : state; },
    get pending() { return pending; },
    get stepNo() { return step; },
    current: () => current,
    played: () => played,
    /** Lifelines busy with a call (an activation). */
    activeLifelines: () => new Set(calls),
    guardVars: () => {
      /** @type {Set<string>} */
      const out = new Set();
      const walk = (/** @type {string} */ id) => { for (const c of m.children(id)) { if (c.kind === 'operand') guardNames(c.props.guard || '').forEach((n) => out.add(n)); walk(c.id); } };
      walk(interactionId);
      return [...out];
    },
  };
}

/**
 * Check a scenario.
 * @param {Model} m @param {string} interactionId @returns {Finding[]}
 */
export function checkSequence(m, interactionId) {
  /** @type {Finding[]} */
  const out = [];
  const lifelines = m.children(interactionId).filter((c) => c.kind === 'lifeline');
  /** @type {Element[]} */
  const msgs = [];
  /** @type {Element[]} */
  const frags = [];
  const walk = (/** @type {string} */ id) => { for (const c of m.children(id)) { if (c.kind === 'message') msgs.push(c); if (c.kind === 'fragment') frags.push(c); if (c.kind === 'fragment' || c.kind === 'operand') walk(c.id); } };
  walk(interactionId);
  if (!msgs.length) return [{ level: 'info', message: 'The scenario has no messages yet', ids: [] }];
  // replies need a call before them, from the replier
  /** @type {string[]} */
  const open = [];
  for (const msg of msgs) {
    const { from, to, msgKind } = msg.props;
    if (msgKind === 'sync' && from !== to) open.push(`${from}>${to}`);
    if (msgKind === 'reply') {
      const k = open.lastIndexOf(`${to}>${from}`);
      if (k < 0) out.push({ level: 'warn', message: `${msg.name} is a reply, but ${m.get(to)?.name} never called ${m.get(from)?.name} before it`, ids: [msg.id] });
      else open.splice(k, 1);
    }
  }
  for (const f of frags) {
    const ops = m.children(f.id).filter((c) => c.kind === 'operand');
    const op = f.props.operator;
    if (!ops.length) out.push({ level: 'warn', message: `${f.name} has no cases`, ids: [f.id] });
    for (const o of ops) if (!m.children(o.id).some((c) => c.kind === 'message' || c.kind === 'fragment')) out.push({ level: 'warn', message: `${f.name}: case ${o.name} is empty`, ids: [o.id] });
    if (op === 'alt') {
      const unguarded = ops.filter((o, i) => !o.props.guard && i < ops.length - 1);
      if (unguarded.length) out.push({ level: 'warn', message: `${f.name}: every case but the last needs a guard`, ids: unguarded.map((o) => o.id) });
      if (ops.length < 2) out.push({ level: 'info', message: `${f.name} is an alt with one case: an opt says the same`, ids: [f.id] });
    }
    if ((op === 'opt' || op === 'loop' || op === 'break') && ops[0] && !ops[0].props.guard) out.push({ level: 'info', message: `${f.name} (${op}) has no guard saying when it happens`, ids: [f.id] });
    if ((op === 'opt' || op === 'loop' || op === 'break') && ops.length > 1) out.push({ level: 'warn', message: `${f.name} (${op}) should have one case; only the first is used`, ids: [f.id] });
  }
  for (const l of lifelines) {
    if (!msgs.some((x) => x.props.from === l.id || x.props.to === l.id)) out.push({ level: 'info', message: `${l.name} sends and receives nothing`, ids: [l.id] });
    if (!l.props.represents) out.push({ level: 'info', message: `${l.name} does not say which part or actor it is`, ids: [l.id] });
  }
  // messages to a block with a state machine should be events it accepts somewhere
  for (const l of lifelines) {
    const r = l.props.represents ? m.get(l.props.represents) : null;
    const block = r?.kind === 'part' ? r.props.type : r?.kind === 'partDef' ? r.id : null;
    if (!block) continue;
    const inBlock = (/** @type {string} */ id) => { for (let e = m.get(id); e; e = e.owner ? m.get(e.owner) : undefined) if (e.id === block) return true; return false; };
    const triggers = new Set(m.byKind('transition').filter((t) => t.props.trigger && inBlock(t.id)).map((t) => t.props.trigger));
    if (!triggers.size) continue;
    for (const msg of msgs) if (msg.props.to === l.id && msg.props.msgKind !== 'reply' && !triggers.has(signal(msg.name))) {
      out.push({ level: 'info', message: `${msg.name}: ${m.get(block)?.name}'s state machine has no transition triggered by ${signal(msg.name)}`, ids: [msg.id] });
    }
  }
  if (!out.some((f) => f.level === 'error' || f.level === 'warn')) out.unshift({ level: 'ok', message: `The scenario is consistent. ${msgs.length} messages, ${frags.length} fragments checked`, ids: [] });
  return out;
}
