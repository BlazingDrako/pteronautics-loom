// Running an activity: tokens flow from the initial node along control and object flows.
//
//   an action runs when every flow into it has a token, then puts a token on every flow out
//   a decision sends its token one way: the guard that holds, else "else", else you choose
//   a merge passes on any token; a fork copies it to every flow out; a join waits for all
//   a final node ends the activity; a flow final ends just that token
//
// Each step fires everything that can fire at once (one "wave"). Check explores every way the
// decisions can go and reports deadlocks, steps that never run, endless loops, tokens that
// pile up or are lost, and decisions with missing guards.
import { parseExpr, evaluate, ExprError } from '../analysis/expr.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {{ level: 'error' | 'warn' | 'info' | 'ok', message: string, ids: string[] }} Finding */
/** @typedef {{ id: string, from: string, to: string, guard: string, item: string, name: string }} Flow */
/** @typedef {{ id: string, kind: string, name: string }} Node */
/** @typedef {{ nodes: Map<string, Node>, flows: Flow[], ins: Map<string, Flow[]>, outs: Map<string, Flow[]> }} Net */
/** @typedef {{ step: number, text: string, ids: string[], level?: 'warn' | 'info' }} LogEntry */

/** The activity as a token net: its actions, control nodes and flows. @param {Model} m @param {string} activityId @returns {Net} */
export function activityNet(m, activityId) {
  /** @type {Map<string, Node>} */
  const nodes = new Map();
  for (const c of m.children(activityId)) {
    if (c.kind === 'action') nodes.set(c.id, { id: c.id, kind: 'action', name: c.name });
    else if (c.kind === 'controlNode') nodes.set(c.id, { id: c.id, kind: c.props.nodeKind, name: c.name });
  }
  const flows = m.children(activityId).filter((c) => c.kind === 'flow' && nodes.has(c.props.from) && nodes.has(c.props.to))
    .map((f) => ({ id: f.id, from: f.props.from, to: f.props.to, guard: String(f.props.guard || '').trim(), item: f.props.flowKind === 'object' ? String(f.props.item || '') : '', name: f.name }));
  /** @type {Map<string, Flow[]>} */
  const ins = new Map(), outs = new Map();
  for (const n of nodes.keys()) { ins.set(n, []); outs.set(n, []); }
  for (const f of flows) { /** @type {Flow[]} */ (outs.get(f.from)).push(f); /** @type {Flow[]} */ (ins.get(f.to)).push(f); }
  return { nodes, flows, ins, outs };
}

/** "[battery > 20%]" → true / false, or null when it cannot be decided from the values. @param {string} guard @param {Map<string, any>} vars @returns {boolean | null} */
export function guardValue(guard, vars) {
  if (!guard) return null;
  if (/^else$/i.test(guard)) return null;
  try {
    const v = evaluate(parseExpr(guard), (n) => (vars.has(n) ? vars.get(n) : undefined));
    return typeof v === 'boolean' ? v : null;
  } catch (e) {
    if (!(e instanceof ExprError) && !(e instanceof Error)) throw e;
    return null;
  }
}
/** Names a guard uses that could be given values (so a guard such as "battery > 20%" can be set). @param {string} guard */
export function guardNames(guard) {
  if (!guard || /^else$/i.test(guard)) return [];
  try {
    const ast = parseExpr(guard);
    /** @type {string[]} */
    const out = [];
    const walk = (/** @type {any} */ a) => { if (a.t === 'name') out.push(a.name); for (const k of ['a', 'b']) if (a[k]) walk(a[k]); if (a.args) a.args.forEach(walk); };
    walk(ast);
    return out.filter((n) => !['pi', 'π', 'e'].includes(n));
  } catch { return []; }
}

/**
 * Which way a decision can go now. `free` flows are ones the run cannot decide (no guard, or a
 * guard it cannot evaluate): the user chooses among them.
 * @param {Flow[]} outs @param {Map<string, any>} vars
 * @returns {{ take: Flow | null, free: Flow[] }}
 */
export function decide(outs, vars) {
  const known = outs.map((f) => ({ f, v: guardValue(f.guard, vars) }));
  const yes = known.filter((x) => x.v === true);
  if (yes.length) return { take: yes[0].f, free: [] };
  const free = known.filter((x) => x.v === null && !/^else$/i.test(x.f.guard)).map((x) => x.f);
  if (free.length) return { take: null, free: [...free, ...outs.filter((f) => /^else$/i.test(f.guard))] };
  const other = outs.find((f) => /^else$/i.test(f.guard));
  return { take: other || null, free: [] };
}

/**
 * A run of an activity, step by step.
 * @param {Model} m @param {string} activityId
 */
export function createActivityRun(m, activityId) {
  const net = activityNet(m, activityId);
  /** Tokens on each flow. @type {Map<string, number>} */
  let tokens = new Map();
  /** Steps that fired in the last step (shown as running). @type {Set<string>} */
  let firing = new Set();
  /** Flows that carried a token in the last step. @type {Set<string>} */
  let moved = new Set();
  /** How often each node has fired. @type {Map<string, number>} */
  const fired = new Map();
  /** @type {LogEntry[]} */
  const log = [];
  /** Values the guards use, set in the run panel. @type {Map<string, any>} */
  const vars = new Map();
  /** A decision waiting for the user. @type {null | { node: string, options: Flow[] }} */
  let pending = null;
  let step = 0;
  let state = /** @type {'ready' | 'running' | 'done' | 'stuck'} */ ('ready');
  let started = false;
  const name = (/** @type {string} */ id) => net.nodes.get(id)?.name || '?';
  const add = (/** @type {string} */ f, n = 1) => tokens.set(f, (tokens.get(f) || 0) + n);
  const take = (/** @type {string} */ f) => { const n = (tokens.get(f) || 0) - 1; if (n > 0) tokens.set(f, n); else tokens.delete(f); };
  const has = (/** @type {string} */ f) => (tokens.get(f) || 0) > 0;

  /** Can a node fire with the current tokens? @param {Node} n */
  function canFire(n) {
    const ins = /** @type {Flow[]} */ (net.ins.get(n.id));
    if (n.kind === 'initial') return false;
    if (n.kind === 'action' || n.kind === 'join') return ins.length > 0 && ins.every((f) => has(f.id));
    return ins.some((f) => has(f.id));
  }

  function start() {
    started = true;
    state = 'running';
    const inits = [...net.nodes.values()].filter((n) => n.kind === 'initial');
    if (!inits.length) { log.push({ step, text: 'There is no initial node, so nothing can start', ids: [], level: 'warn' }); state = 'stuck'; return; }
    for (const n of inits) {
      fired.set(n.id, 1);
      for (const f of /** @type {Flow[]} */ (net.outs.get(n.id))) { add(f.id); moved.add(f.id); }
    }
    firing = new Set(inits.map((n) => n.id));
    log.push({ step, text: 'Start', ids: inits.map((n) => n.id) });
  }

  /** Fire every node that can fire. @returns {boolean} whether anything happened */
  function doStep() {
    if (state === 'done' || state === 'stuck') return false;
    if (pending) return false;
    if (!started) { start(); return true; }
    step++;
    const ready = [...net.nodes.values()].filter(canFire);
    firing = new Set(); moved = new Set();
    if (!ready.length) {
      if (tokens.size) {
        const waiting = [...net.nodes.values()].filter((n) => (net.ins.get(n.id) || []).some((f) => has(f.id)));
        state = 'stuck';
        log.push({ step, text: `Stuck: ${waiting.map((n) => `${name(n.id)} waits for ${(/** @type {Flow[]} */ (net.ins.get(n.id))).filter((f) => !has(f.id)).map((f) => name(f.from)).join(' and ') || 'nothing'}`).join('; ')}`, ids: waiting.map((n) => n.id), level: 'warn' });
      } else {
        state = 'done';
        log.push({ step, text: 'Every token has ended (no final node was reached)', ids: [], level: 'info' });
      }
      return false;
    }
    /** @type {string[]} */
    const texts = [];
    for (const n of ready) {
      if (!canFire(n)) continue; // an earlier node in this wave took the token
      const ins = /** @type {Flow[]} */ (net.ins.get(n.id)), outs = /** @type {Flow[]} */ (net.outs.get(n.id));
      if (n.kind === 'decision') {
        const { take: way, free } = decide(outs, vars);
        if (!way && free.length > 1) { pending = { node: n.id, options: free }; continue; }
        const go = way || free[0];
        take(/** @type {Flow} */ (ins.find((f) => has(f.id))).id);
        fire(n);
        if (go) { add(go.id); moved.add(go.id); texts.push(`${name(n.id)} → ${go.guard ? `[${go.guard}]` : name(go.to)}`); }
        else { texts.push(`${name(n.id)}: no guard holds and there is no else, so the token stops here`); log.push({ step, text: `${name(n.id)}: no way out`, ids: [n.id], level: 'warn' }); }
        continue;
      }
      if (n.kind === 'action' || n.kind === 'join') for (const f of ins) take(f.id);
      else take(/** @type {Flow} */ (ins.find((f) => has(f.id))).id);
      fire(n);
      if (n.kind === 'final') {
        tokens = new Map();
        state = 'done';
        texts.push(`${name(n.id)}: the activity ends`);
        break;
      }
      if (n.kind === 'flowFinal') { texts.push(`${name(n.id)}: a flow ends`); continue; }
      if (n.kind === 'action') texts.push(name(n.id));
      if (!outs.length && n.kind === 'action') log.push({ step, text: `${name(n.id)} has no flow out, so its token is lost (add a flow, or a final node)`, ids: [n.id], level: 'warn' });
      for (const f of outs) { add(f.id); moved.add(f.id); }
    }
    if (texts.length) log.push({ step, text: texts.join(' · '), ids: [...firing] });
    if (pending) log.push({ step, text: `${name(pending.node)}: choose which way`, ids: [pending.node], level: 'info' });
    if ([...tokens.values()].some((x) => x > 20)) { state = 'stuck'; log.push({ step, text: 'Tokens are piling up on a flow: a loop that forks without joining?', ids: [...tokens.entries()].filter(([, x]) => x > 20).map(([f]) => f), level: 'warn' }); }
    return true;
  }
  /** @param {Node} n */
  function fire(n) { firing.add(n.id); fired.set(n.id, (fired.get(n.id) || 0) + 1); }

  /** Resolve the waiting decision. @param {string} flowId */
  function choose(flowId) {
    if (!pending) return;
    const f = pending.options.find((x) => x.id === flowId);
    if (!f) return;
    const n = /** @type {Node} */ (net.nodes.get(pending.node));
    const ins = /** @type {Flow[]} */ (net.ins.get(n.id));
    const inF = ins.find((x) => has(x.id));
    if (inF) take(inF.id);
    fire(n);
    add(f.id); moved = new Set([f.id]);
    log.push({ step, text: `You chose ${f.guard ? `[${f.guard}]` : name(f.to)} at ${name(n.id)}`, ids: [n.id, f.id] });
    pending = null;
  }

  return {
    net, vars, log,
    step: doStep, choose,
    reset() { tokens = new Map(); firing = new Set(); moved = new Set(); fired.clear(); log.length = 0; pending = null; step = 0; state = 'ready'; started = false; },
    get state() { return pending ? 'choose' : state; },
    get pending() { return pending; },
    get stepNo() { return step; },
    tokens: () => tokens,
    firing: () => firing,
    moved: () => moved,
    fired: () => fired,
    /** Names the guards use, so the panel can offer them as values. */
    guardVars: () => [...new Set(net.flows.flatMap((f) => (net.nodes.get(f.from)?.kind === 'decision' ? guardNames(f.guard) : [])))],
  };
}

/**
 * Check an activity: structure first, then every way it can run.
 * @param {Model} m @param {string} activityId @returns {Finding[]}
 */
export function checkActivity(m, activityId) {
  const net = activityNet(m, activityId);
  /** @type {Finding[]} */
  const out = [];
  const nodes = [...net.nodes.values()];
  const name = (/** @type {string} */ id) => net.nodes.get(id)?.name || '?';
  if (!nodes.length) return [{ level: 'info', message: 'The activity is empty', ids: [] }];
  const inits = nodes.filter((n) => n.kind === 'initial');
  if (!inits.length) out.push({ level: 'error', message: 'There is no initial node, so the activity cannot start', ids: [] });
  if (!nodes.some((n) => n.kind === 'final')) out.push({ level: 'warn', message: 'There is no final node, so the activity never ends as a whole', ids: [] });
  for (const n of nodes) {
    const ins = /** @type {Flow[]} */ (net.ins.get(n.id)), outs = /** @type {Flow[]} */ (net.outs.get(n.id));
    if (n.kind === 'decision') {
      const unguarded = outs.filter((f) => !f.guard);
      if (outs.length < 2) out.push({ level: 'warn', message: `${n.name} has ${outs.length ? 'one way out' : 'no way out'}: a decision chooses between flows`, ids: [n.id] });
      else if (unguarded.length) out.push({ level: 'warn', message: `${n.name}: ${unguarded.length} of its flows ha${unguarded.length > 1 ? 've' : 's'} no guard, so the choice is not defined`, ids: [n.id, ...unguarded.map((f) => f.id)] });
      if (outs.filter((f) => /^else$/i.test(f.guard)).length > 1) out.push({ level: 'error', message: `${n.name} has more than one else`, ids: [n.id] });
    }
    if (n.kind === 'action' && ins.length > 1) out.push({ level: 'info', message: `${n.name} has ${ins.length} flows in, so it waits for all of them. If they are alternatives, join them with a merge first`, ids: [n.id] });
    if (n.kind === 'action' && !outs.length) out.push({ level: 'warn', message: `${n.name} has no flow out: add one, or a final node`, ids: [n.id] });
    if (n.kind === 'join' && ins.length < 2) out.push({ level: 'info', message: `${n.name} joins only ${ins.length} flow${ins.length === 1 ? '' : 's'}`, ids: [n.id] });
    if (n.kind === 'fork' && outs.length < 2) out.push({ level: 'info', message: `${n.name} splits into only ${outs.length} flow${outs.length === 1 ? '' : 's'}`, ids: [n.id] });
    if (n.kind !== 'initial' && !ins.length) out.push({ level: 'warn', message: `Nothing flows into ${n.name}, so it never runs`, ids: [n.id] });
  }

  // ---- explore every run (each decision both ways) ----
  if (inits.length) {
    const ids = net.flows.map((f) => f.id);
    /** @param {Map<string, number>} t */
    const key = (t) => ids.map((f) => t.get(f) || 0).join(',');
    /** @type {Map<string, { t: Map<string, number>, next: string[], end: boolean }>} */
    const seen = new Map();
    const t0 = new Map();
    for (const n of inits) for (const f of /** @type {Flow[]} */ (net.outs.get(n.id))) t0.set(f.id, (t0.get(f.id) || 0) + 1);
    const ranAt = new Set(inits.map((n) => n.id));
    /** @type {Set<string>} */
    const deadlocks = new Set(), lost = new Set(), piles = new Set();
    let capped = false, finished = false;
    const queue = [key(t0)];
    seen.set(queue[0], { t: t0, next: [], end: false });
    const has = (/** @type {Map<string, number>} */ t, /** @type {string} */ f) => (t.get(f) || 0) > 0;
    while (queue.length) {
      if (seen.size > 5000) { capped = true; break; }
      const k = /** @type {string} */ (queue.shift());
      const s = /** @type {{ t: Map<string, number>, next: string[], end: boolean }} */ (seen.get(k));
      if (s.end) continue;
      const ready = nodes.filter((n) => {
        const ins = /** @type {Flow[]} */ (net.ins.get(n.id));
        if (n.kind === 'initial') return false;
        if (n.kind === 'action' || n.kind === 'join') return ins.length > 0 && ins.every((f) => has(s.t, f.id));
        return ins.some((f) => has(s.t, f.id));
      });
      if (!ready.length) { if (s.t.size) for (const [f] of s.t) deadlocks.add(/** @type {Flow} */ (net.flows.find((x) => x.id === f)).to); continue; }
      // every combination of the decisions that fire in this wave (at most 64)
      /** @type {{ t: Map<string, number>, end: boolean }[]} */
      let branches = [{ t: new Map(s.t), end: false }];
      for (const n of ready) {
        ranAt.add(n.id);
        const ins = /** @type {Flow[]} */ (net.ins.get(n.id)), outs = /** @type {Flow[]} */ (net.outs.get(n.id));
        /** @type {{ t: Map<string, number>, end: boolean }[]} */
        const next = [];
        for (const b of branches) {
          if (b.end) { next.push(b); continue; }
          const ok = n.kind === 'action' || n.kind === 'join' ? ins.every((f) => has(b.t, f.id)) : ins.some((f) => has(b.t, f.id));
          if (!ok) { next.push(b); continue; }
          const t = new Map(b.t);
          const takeF = (/** @type {string} */ f) => { const x = (t.get(f) || 0) - 1; if (x > 0) t.set(f, x); else t.delete(f); };
          if (n.kind === 'action' || n.kind === 'join') ins.forEach((f) => takeF(f.id));
          else takeF(/** @type {Flow} */ (ins.find((f) => has(t, f.id))).id);
          if (n.kind === 'final') { next.push({ t: new Map(), end: true }); continue; }
          if (n.kind === 'flowFinal') { next.push({ t, end: false }); continue; }
          if (n.kind === 'decision') {
            const ways = outs.length ? outs : [];
            if (!ways.length) lost.add(n.id);
            for (const w of ways) { const tt = new Map(t); tt.set(w.id, (tt.get(w.id) || 0) + 1); next.push({ t: tt, end: false }); }
            if (!ways.length) next.push({ t, end: false });
            continue;
          }
          if (!outs.length && n.kind === 'action') lost.add(n.id);
          for (const f of outs) t.set(f.id, (t.get(f.id) || 0) + 1);
          next.push({ t, end: false });
        }
        branches = next.slice(0, 64);
      }
      for (const b of branches) {
        if (b.end) finished = true;
        if ([...b.t.values()].some((x) => x > 6)) { for (const [f, x] of b.t) if (x > 6) piles.add(f); continue; }
        const nk = b.end ? 'END' : key(b.t);
        s.next.push(nk);
        if (!seen.has(nk)) { seen.set(nk, { t: b.t, next: [], end: b.end }); queue.push(nk); }
      }
    }
    for (const id of deadlocks) out.push({ level: 'error', message: `Can get stuck at ${name(id)}: it waits for a token that never comes (a join or an action after a decision?)`, ids: [id] });
    for (const id of lost) if (!out.some((f) => f.ids[0] === id && f.message.includes('no flow out'))) out.push({ level: 'warn', message: `A token is lost at ${name(id)}`, ids: [id] });
    if (piles.size) out.push({ level: 'warn', message: `Tokens can pile up on ${[...piles].map((f) => net.flows.find((x) => x.id === f)?.name).join(', ')}: a loop that forks without joining?`, ids: [...piles] });
    const never = nodes.filter((n) => !ranAt.has(n.id) && (net.ins.get(n.id) || []).length);
    for (const n of never) out.push({ level: 'warn', message: `${n.name} can never run`, ids: [n.id] });
    // can a run go on forever without finishing? (states from which no end is reachable)
    if (finished && !capped) {
      const canEnd = new Set(['END']);
      for (let grew = true; grew;) { grew = false; for (const [k, s] of seen) if (!canEnd.has(k) && (s.end || s.next.some((x) => canEnd.has(x)))) { canEnd.add(k); grew = true; } }
      const trapped = [...seen.keys()].filter((k) => !canEnd.has(k) && !seen.get(k)?.end && (seen.get(k)?.next.length || 0) > 0);
      if (trapped.length) out.push({ level: 'warn', message: 'Some runs can loop forever without reaching a final node', ids: [] });
    } else if (!finished && nodes.some((n) => n.kind === 'final') && !capped) out.push({ level: 'error', message: 'No run ever reaches a final node', ids: nodes.filter((n) => n.kind === 'final').map((n) => n.id) });
    if (capped) out.push({ level: 'info', message: 'The activity has too many possible runs to check them all; the first 5,000 states were checked', ids: [] });
  }
  if (!out.some((f) => f.level === 'error' || f.level === 'warn')) out.unshift({ level: 'ok', message: `Every run reaches the end. ${nodes.filter((n) => n.kind === 'action').length} actions, ${net.flows.length} flows checked`, ids: [] });
  return out;
}
