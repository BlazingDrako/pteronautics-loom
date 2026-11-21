// A client for the OMG Systems Modeling API (the standard REST API of SysML v2 repositories,
// such as the SysML v2 pilot implementation's API server). It lists a server's projects, reads
// a project's elements at its latest commit into a new Loom project, and sends a Loom project to
// a server as a new project with one commit.
//
// Reading understands the KerML/SysML v2 JSON element shapes for what Loom models: packages,
// requirement definitions and usages, part, port, attribute, action, constraint, state,
// verification and use case definitions and usages, typing, subclassification, satisfy and
// dependencies. Anything else is counted and left out. The browser must be allowed to reach the
// server (CORS); a server that does not allow it gives a "Failed to fetch" error.
import { createModel, ModelError } from '../model/model.js';
import { kindName, isRel, LAYERS } from '../model/metamodel.js';
import { InteropError } from './xml.js';
import { VERSION } from '../version.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {{ '@id': string, '@type': string, [k: string]: any }} ApiElement */
/** @typedef {{ '@id': string, name: string, description?: string, defaultBranch?: { '@id': string }, created?: string }} ApiProject */

/**
 * @param {string} baseUrl e.g. "http://localhost:9000"
 * @param {{ fetch?: typeof fetch, token?: string, pageSize?: number }} [o]
 */
export function createApiClient(baseUrl, o = {}) {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(base)) throw new InteropError('Give the server address, starting with http:// or https://');
  const f = o.fetch || globalThis.fetch.bind(globalThis);
  const size = o.pageSize || 500;
  /** @param {string} url @param {RequestInit} [init] */
  async function call(url, init = {}) {
    /** @type {Response} */
    let res;
    try {
      res = await f(url.startsWith('http') ? url : base + url, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...(init.headers || {}) } });
    } catch (e) {
      throw new InteropError(`Loom could not reach ${base}. Check the address, that the server is running, and that it allows requests from this page (CORS). ${e instanceof Error ? e.message : ''}`.trim());
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* no body */ }
      throw new InteropError(`The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${detail ? `: ${detail}` : ''}`);
    }
    return res;
  }
  const json = async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => (await call(url, init)).json();
  /** The next page from a Link header, if any. @param {Response} res */
  const nextLink = (res) => { const l = res.headers.get('Link') || res.headers.get('link') || ''; const mm = l.match(/<([^>]+)>\s*;\s*rel="?next"?/i); return mm ? mm[1] : null; };

  return {
    base,
    /** @returns {Promise<ApiProject[]>} */
    projects: () => json(`/projects?page[size]=${size}`),
    /** The latest commit of a project's default branch (or its last commit). @param {string} projectId @returns {Promise<string>} */
    async headCommit(projectId) {
      const p = await json(`/projects/${encodeURIComponent(projectId)}`);
      const bid = p.defaultBranch?.['@id'];
      if (bid) { const b = await json(`/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(bid)}`); if (b.head?.['@id']) return b.head['@id']; }
      const commits = await json(`/projects/${encodeURIComponent(projectId)}/commits`);
      const last = Array.isArray(commits) ? commits[commits.length - 1] : null;
      if (!last) throw new InteropError('This project has no commits yet');
      return last['@id'];
    },
    /**
     * Every element of a project at a commit, following pages.
     * @param {string} projectId @param {string} commitId @param {(n: number) => void} [progress]
     * @returns {Promise<ApiElement[]>}
     */
    async elements(projectId, commitId, progress) {
      /** @type {ApiElement[]} */
      const out = [];
      let url = /** @type {string | null} */ (`/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(commitId)}/elements?page[size]=${size}`);
      for (let guard = 0; url && guard < 10000; guard++) {
        const res = await call(url);
        const page = await res.json();
        if (!Array.isArray(page)) throw new InteropError('The server sent something that is not a list of elements');
        out.push(...page);
        progress?.(out.length);
        url = nextLink(res);
      }
      return out;
    },
    /** @param {string} name @param {string} [description] @returns {Promise<ApiProject>} */
    createProject: (name, description = '') => json('/projects', { method: 'POST', body: JSON.stringify({ '@type': 'Project', name, description }) }),
    /**
     * Commit elements to a project.
     * @param {string} projectId @param {ApiElement[]} elements @param {string} [branchId]
     */
    commit(projectId, elements, branchId) {
      const change = elements.map((e) => ({ '@type': 'DataVersion', identity: { '@id': e['@id'] }, payload: e }));
      return json(`/projects/${encodeURIComponent(projectId)}/commits${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`, { method: 'POST', body: JSON.stringify({ '@type': 'Commit', description: `From Pteronautics Loom ${VERSION}`, change }) });
    },
  };
}

/** @typedef {ReturnType<typeof createApiClient>} ApiClient */

// ---------- elements → Loom ----------

/** SysML v2 element types Loom reads, and what they become. */
const KINDS = /** @type {Record<string, string>} */ ({
  Package: 'package', LibraryPackage: 'package', Namespace: 'package',
  RequirementDefinition: 'requirement', RequirementUsage: 'requirement', ConcernDefinition: 'requirement', ConcernUsage: 'requirement',
  PartDefinition: 'partDef', ItemDefinition: 'partDef', OccurrenceDefinition: 'partDef',
  PortDefinition: 'interfaceDef', InterfaceDefinition: 'interfaceDef',
  PartUsage: 'part', ItemUsage: 'part',
  PortUsage: 'port',
  AttributeDefinition: 'valueType', EnumerationDefinition: 'valueType',
  AttributeUsage: 'attribute', EnumerationUsage: 'attribute',
  ActionDefinition: 'action', ActionUsage: 'action', PerformActionUsage: 'action',
  ConstraintDefinition: 'constraintDef', ConstraintUsage: 'constraint',
  VerificationCaseDefinition: 'testCase', VerificationCaseUsage: 'testCase',
  UseCaseDefinition: 'useCase', UseCaseUsage: 'useCase',
  StateDefinition: 'partDef', StateUsage: 'state',
});
const LAYER_OF = /** @type {Record<string, string>} */ ({ requirement: 'r', testCase: 'r', useCase: 'r', action: 'f' });
const idOf = (/** @type {any} */ v) => (v && typeof v === 'object' ? v['@id'] : typeof v === 'string' ? v : undefined);
const ids = (/** @type {any} */ v) => (Array.isArray(v) ? v.map(idOf).filter(Boolean) : idOf(v) ? [idOf(v)] : []);

/**
 * Build a Loom model from SysML v2 API elements.
 * @param {ApiElement[]} elements @param {string} name
 * @returns {{ model: Model, counts: Record<string, number>, skipped: Record<string, number> }}
 */
export function modelFromApi(elements, name) {
  /** @type {Map<string, ApiElement>} */
  const byId = new Map(elements.filter((e) => e && e['@id']).map((e) => [e['@id'], e]));
  /** member → namespace, from memberships (for servers that do not send owningNamespace) */
  const memberOf = new Map();
  for (const e of byId.values()) {
    if (!/Membership$/.test(e['@type'])) continue;
    const ns = idOf(e.membershipOwningNamespace) || idOf(e.owningRelatedElement) || idOf(e.source?.[0]);
    for (const mem of [...ids(e.ownedRelatedElement), ...ids(e.ownedMemberElement), ...ids(e.memberElement)]) if (ns && !memberOf.has(mem)) memberOf.set(mem, ns);
  }
  const ownerOf = (/** @type {ApiElement} */ e) => idOf(e.owningNamespace) || idOf(e.owner) || memberOf.get(e['@id']) || (e.owningRelationship ? memberOf.get(idOf(e.owningRelationship)) || idOf(byId.get(idOf(e.owningRelationship) || '')?.owningRelatedElement) : undefined);
  const nameOf = (/** @type {ApiElement} */ e) => String(e.declaredName ?? e.name ?? '').trim();
  /** documentation bodies, by the element they document */
  const docs = new Map();
  for (const e of byId.values()) if (e['@type'] === 'Documentation' || e['@type'] === 'Comment') {
    const target = ids(e.annotatedElement)[0] || ownerOf(e);
    if (target && typeof e.body === 'string') docs.set(target, [docs.get(target), e.body.replace(/^\s*\/\*|\*\/\s*$/g, '').trim()].filter(Boolean).join('\n\n'));
  }
  const m = createModel({ name });
  const layerId = Object.fromEntries(m.layers().map((l) => [/** @type {string} */ (l.layer), l.id]));
  /** @type {Map<string, string>} */
  const made = new Map();
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {Record<string, number>} */
  const skipped = {};
  const skip = (/** @type {string} */ what) => { skipped[what] = (skipped[what] || 0) + 1; };
  const pkgCopy = new Map();
  const depth = (/** @type {ApiElement} */ e) => { let d = 0; for (let o = ownerOf(e); o && d < 200; o = ownerOf(/** @type {ApiElement} */ (byId.get(o) || {}))) d++; return d; };

  m.transact('Import from a SysML v2 API server', (tx) => {
    /** @param {string} kind @param {string} owner @param {Record<string, any>} o @param {string} [aid] */
    const make = (kind, owner, o, aid) => {
      try { const id = tx.create(kind, { owner, ...o }); counts[kind] = (counts[kind] || 0) + 1; if (aid) made.set(aid, id); return id; }
      catch (err) { if (!(err instanceof ModelError)) throw err; skip(`${kindName(kind, 'sysml').toLowerCase()} Loom cannot place there`); return null; }
    };
    /** A top-level package named like an RFLP layer (as Loom sends them) is that layer. @param {string | undefined} aid */
    const layerPkg = (aid) => {
      const e = aid ? byId.get(aid) : undefined;
      if (!e || KINDS[e['@type']] !== 'package') return null;
      const up = ownerOf(e);
      if (up && byId.get(up) && ownerOf(/** @type {ApiElement} */ (byId.get(up)))) return null;
      return LAYERS.find((l) => l.name.toLowerCase() === nameOf(e).toLowerCase())?.id || null;
    };
    /** The layer an element goes to: the layer package it is in, else its kind's. @param {ApiElement} e @param {string} kind */
    const layerFor = (e, kind) => { for (let a = ownerOf(e), d = 0; a && d < 200; a = ownerOf(/** @type {ApiElement} */ (byId.get(a) || {})), d++) { const l = layerPkg(a); if (l) return l; } return LAYER_OF[kind] || 'l'; };
    /** The Loom package for a v2 package, in a layer. @param {string | undefined} aid @param {string} layer @returns {string} */
    const pkgIn = (aid, layer) => {
      const e = aid ? byId.get(aid) : undefined;
      if (!e) return layerId[layer];
      if (KINDS[e['@type']] !== 'package') return pkgIn(ownerOf(e), layer);
      if (!ownerOf(e) || layerPkg(aid)) return layerId[layer]; // the root namespace, or a layer
      const key = `${layer}|${aid}`;
      let id = pkgCopy.get(key);
      if (!id) { id = make('package', pkgIn(ownerOf(e), layer), { name: nameOf(e) || 'Package' }); pkgCopy.set(key, id); }
      return /** @type {string} */ (id);
    };
    const list = [...byId.values()].filter((e) => KINDS[e['@type']] && KINDS[e['@type']] !== 'package').sort((a, b) => depth(a) - depth(b));
    for (const e of list) {
      const kind = KINDS[e['@type']];
      const own = ownerOf(e), ownMade = own ? made.get(own) : undefined, ownKind = ownMade ? m.get(ownMade)?.kind : undefined;
      let owner;
      if (ownMade && m.canCreate(ownMade, kind)) owner = ownMade;
      else if (['part', 'port', 'attribute', 'constraint', 'state'].includes(kind)) { skip(`${e['@type']}s outside a definition`); continue; }
      else owner = pkgIn(own, layerFor(e, kind));
      if (kind === 'action' && ownKind && ownKind !== 'action' && e['@type'] !== 'ActionDefinition') { skip('actions owned by something other than an action'); continue; }
      /** @type {Record<string, any>} */
      const props = {};
      const doc = docs.get(e['@id']);
      if (kind === 'requirement') { props.reqId = String(e.declaredShortName || e.shortName || '').trim(); if (doc) props.text = doc; }
      else if (doc) props.doc = doc;
      if (kind === 'port' && e.direction) props.direction = ['in', 'out', 'inout'].includes(e.direction) ? e.direction : 'inout';
      make(kind, owner, { name: nameOf(e) || kindName(kind, 'sysml'), props }, e['@id']);
    }
    // typing
    /** @type {Map<string, string>} feature → type */
    const typeOf = new Map();
    for (const e of byId.values()) {
      if (e['@type'] === 'FeatureTyping') { const f = idOf(e.typedFeature), t = idOf(e.type); if (f && t) typeOf.set(f, t); }
      if (made.has(e['@id'])) { const t = ids(e.definition)[0] || ids(e.type)[0]; if (t && !typeOf.has(e['@id'])) typeOf.set(e['@id'], t); }
    }
    const want = /** @type {Record<string, string>} */ ({ part: 'partDef', port: 'interfaceDef', attribute: 'valueType', constraint: 'constraintDef' });
    for (const [f, t] of typeOf) {
      const fe = made.get(f), te = made.get(t);
      const fk = fe ? m.get(fe)?.kind : undefined;
      if (!fe || !fk || !want[fk]) continue;
      if (!te || m.get(te)?.kind !== want[fk]) { if (byId.has(t)) skip('types Loom did not import'); continue; }
      tx.setProps(fe, { type: te });
    }
    // relationships
    let rels = 0;
    const link = (/** @type {string} */ k, /** @type {string | undefined} */ a, /** @type {string | undefined} */ b) => {
      const x = a ? made.get(a) : undefined, y = b ? made.get(b) : undefined;
      if (!x || !y) { skip(`${k} relationships to elements not imported`); return; }
      if (m.canLink(k, x, y)) { tx.link(k, x, y); rels++; } else if (!m.relsFrom(x).some((r) => r.kind === k && r.target === y)) skip(`${k} relationships Loom does not allow between those kinds`);
    };
    for (const e of byId.values()) {
      const t = e['@type'];
      if (t === 'Subclassification') link('generalize', idOf(e.subclassifier) || idOf(e.specific), idOf(e.superclassifier) || idOf(e.general));
      else if (t === 'SatisfyRequirementUsage') {
        const sat = idOf(e.satisfyingFeature) || ownerOf(e), req = idOf(e.satisfiedRequirement) || ids(e.definition)[0];
        // a satisfying part usage stands for its definition when the part itself was left out
        link('satisfy', made.has(sat || '') ? sat : typeOf.get(sat || ''), req);
      } else if (t === 'Dependency' || t === 'Allocation' || t === 'AllocationUsage') {
        const k = t === 'Dependency' ? String(e.declaredName || '').match(/^(satisfy|verify|derive|refine|copy|allocate|trace)$/)?.[1] || 'trace' : 'allocate';
        for (const c of ids(e.client).length ? ids(e.client) : ids(e.source)) for (const s of ids(e.supplier).length ? ids(e.supplier) : ids(e.target)) link(k, c, s);
      } else if (!KINDS[t] && !/Membership$|^(FeatureTyping|Documentation|Comment|Subsetting|Redefinition|ReferenceSubsetting|LiteralString|LiteralInteger|LiteralRational|LiteralBoolean|FeatureValue|Multiplicity|MultiplicityRange)$/.test(t)) skip(`${t} elements`);
    }
    counts.relationships = rels;
  });
  m.clear();
  return { model: m, counts, skipped };
}

// ---------- Loom → elements ----------

/** A stable UUID for a Loom id (so sending the same project twice gives the same ids). @param {string} id @param {string} [salt] */
export function uuidFor(id, salt = '') {
  const s = `${salt}|${id}`;
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => { let h = seed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; } return h >>> 0; });
  const hex = words.map((w) => w.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const TYPES = /** @type {Record<string, string>} */ ({
  package: 'Package', requirement: 'RequirementUsage', testCase: 'VerificationCaseDefinition', action: 'ActionDefinition', partDef: 'PartDefinition', interfaceDef: 'PortDefinition',
  part: 'PartUsage', port: 'PortUsage', attribute: 'AttributeUsage', valueType: 'AttributeDefinition', constraintDef: 'ConstraintDefinition', constraint: 'ConstraintUsage',
  useCase: 'UseCaseDefinition', state: 'StateUsage',
});

/**
 * A Loom model as SysML v2 API elements: every element Loom can express, with owning
 * memberships, documentation, typing, subclassification, satisfy and dependencies.
 * @param {Model} m @returns {{ elements: ApiElement[], left: number }}
 */
export function apiElementsOf(m) {
  /** @type {ApiElement[]} */
  const out = [];
  let left = 0;
  const salt = m.root().id;
  const U = (/** @type {string} */ id, /** @type {string} */ part = '') => uuidFor(id + part, salt);
  const root = m.root();
  out.push({ '@id': U(root.id), '@type': 'Package', declaredName: root.name });
  /** @param {string} ownerId @param {ApiElement} el */
  const own = (ownerId, el) => {
    const mid = U(el['@id'], ':m');
    el.owningRelationship = { '@id': mid };
    el.owningNamespace = { '@id': U(ownerId) };
    out.push(el, { '@id': mid, '@type': 'OwningMembership', membershipOwningNamespace: { '@id': U(ownerId) }, owningRelatedElement: { '@id': U(ownerId) }, ownedRelatedElement: [{ '@id': el['@id'] }], memberName: el.declaredName });
  };
  const walk = (/** @type {string} */ id) => {
    for (const c of m.children(id)) {
      const t = TYPES[c.kind];
      if (!t) { left++; continue; }
      /** @type {ApiElement} */
      const el = { '@id': U(c.id), '@type': t, declaredName: c.name };
      if (c.kind === 'requirement' && c.props.reqId) el.declaredShortName = c.props.reqId;
      if (c.kind === 'port' && c.props.direction !== 'inout') el.direction = c.props.direction;
      own(id, el);
      const text = c.kind === 'requirement' ? c.props.text : c.props.doc;
      if (text) {
        const did = U(c.id, ':doc');
        out.push({ '@id': did, '@type': 'Documentation', body: text, annotatedElement: [{ '@id': U(c.id) }], owningRelatedElement: { '@id': U(c.id) } });
      }
      if (c.props.type && m.get(c.props.type) && ['part', 'port', 'attribute', 'constraint'].includes(c.kind)) {
        out.push({ '@id': U(c.id, ':type'), '@type': 'FeatureTyping', typedFeature: { '@id': U(c.id) }, type: { '@id': U(c.props.type) }, owningRelatedElement: { '@id': U(c.id) } });
        el.definition = [{ '@id': U(c.props.type) }];
      }
      walk(c.id);
    }
  };
  walk(root.id);
  const exported = new Set(out.map((e) => e['@id']));
  for (const r of m.all()) {
    if (!isRel(r.kind) || !r.source || !r.target) continue;
    const s = U(r.source), t = U(r.target);
    if (!exported.has(s) || !exported.has(t)) { left++; continue; }
    if (r.kind === 'generalize') out.push({ '@id': U(r.id), '@type': 'Subclassification', subclassifier: { '@id': s }, superclassifier: { '@id': t }, owningRelatedElement: { '@id': s } });
    else if (r.kind === 'satisfy') out.push({ '@id': U(r.id), '@type': 'SatisfyRequirementUsage', declaredName: 'satisfy', satisfyingFeature: { '@id': s }, satisfiedRequirement: { '@id': t }, owningNamespace: { '@id': s } });
    else out.push({ '@id': U(r.id), '@type': 'Dependency', declaredName: r.kind, client: [{ '@id': s }], supplier: [{ '@id': t }] });
  }
  return { elements: out, left };
}
