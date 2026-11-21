// The inspector: everything about the selected element, editable in place.
// With nothing selected it shows the project, display and integration settings.
import { h, icon } from './dom.js';
import { ELEMENTS, RELATIONSHIPS, LAYERS, kindName, canRelate, isRel, isDiagram } from '../model/metamodel.js';
import { levelOf, requirementStatus, idPrefixFor, DEFAULT_PREFIX } from '../model/trace.js';
import { canUseFolders } from '../storage/folderfs.js';
import { analysisOf, addMissingParams, showVar, hasEquations } from '../analysis/solver.js';
import { isUnit, parseUnit, dimName } from '../analysis/units.js';
import { parseExpr, ExprError } from '../analysis/expr.js';
import { appliedOf, applicableStereotypes, applyStereo, unapplyStereo, setTag, STEREO_TARGETS, stereoKinds, kindsText } from '../custom/stereo.js';
import { canHaveStereo } from '../model/metamodel.js';
import { configOf, ruleTitle, SEVERITIES } from '../validate/engine.js';
import { RULE_SETS } from '../validate/rules.js';
import { SEV_ICON, SEV_WORD } from './problems.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {import('../model/metamodel.js').Notation} Notation */
/**
 * @typedef {{
 *   model: Model,
 *   settings: import('../settings.js').SettingsStore,
 *   commands: import('../commands.js').CommandRegistry,
 *   selected: () => string | null,
 *   select: (id: string | null) => void,
 *   edit: (label: string, fn: (tx: any) => void) => boolean,
 *   meta: () => { created: string, modified: string, folder?: { name: string, sig: string, synced: string } },
 *   open: (id: string) => void,
 *   validator?: import('../validate/engine.js').Validator,
 *   fix?: (p: import('../validate/engine.js').Problem) => void,
 *   ignore?: (p: import('../validate/engine.js').Problem) => void,
 *   openRules?: () => void,
 *   openPrefs?: (tab?: 'look' | 'keys' | 'presets') => void,
 *   create?: (kind: string, owner: string) => void,
 *   newProfile?: () => void,
 * }} InspectorCtx
 */

const LAYER = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/** @param {InspectorCtx} ctx */
export function createInspector(ctx) {
  const el = h('aside', { class: 'inspector', 'aria-label': 'Inspector' });

  /** A text or long-text field that commits on blur or Enter. @param {string} label @param {string} value @param {(v: string) => void} commit @param {{ long?: boolean, placeholder?: string, mono?: boolean, hint?: string }} [o] */
  function textField(label, value, commit, o = {}) {
    const input = o.long
      ? h('textarea', { class: 'field', rows: 3, placeholder: o.placeholder || '' }, value)
      : h('input', { class: 'field' + (o.mono ? ' mono' : ''), type: 'text', value, placeholder: o.placeholder || '' });
    const save = () => { if (input.value !== value) commit(input.value); };
    input.addEventListener('change', save);
    input.addEventListener('keydown', (ev) => {
      const e = /** @type {KeyboardEvent} */ (ev);
      if (e.key === 'Enter' && (!o.long || e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); /** @type {HTMLElement} */ (input).blur(); }
      if (e.key === 'Escape') { input.value = value; /** @type {HTMLElement} */ (input).blur(); }
    });
    if (o.long) {
      const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(240, input.scrollHeight + 2)}px`; };
      input.addEventListener('input', grow); requestAnimationFrame(grow);
    }
    return h('label', { class: 'field-label' }, label, input, o.hint ? h('small', {}, o.hint) : null);
  }

  /** Where a requirement stands: satisfied, verified, passed. @param {Element} e */
  function reqStatus(e) {
    const st = requirementStatus(ctx.model).get(e.id);
    if (!st) return null;
    const row = (/** @type {string} */ label, /** @type {boolean} */ ok, /** @type {string} */ yes, /** @type {string} */ no, bad = false) =>
      h('div', { class: 'kv' }, h('span', {}, label), h('span', { class: bad ? 'bad' : ok ? 'good' : 'warn' }, ok ? yes : no));
    return [
      h('div', { class: 'sec' }, 'Traceability'),
      row('Satisfied', st.satisfied, st.direct.satisfy.length ? '✓ Yes' : '✓ Through sub-requirements', 'Not yet'),
      row('Verified', st.verified, st.direct.verify.length ? '✓ Yes' : '✓ Through sub-requirements', 'Not yet'),
      st.verified ? row('Result', st.passed, '✓ Passed', st.failed ? '✕ Failed' : 'Not run yet', st.failed) : null,
      st.check ? h('div', { class: `check-box ${st.check.verdict}` },
        h('b', {}, st.check.verdict === 'pass' ? '✓ Check met' : st.check.verdict === 'fail' ? '✕ Check not met' : '! Check cannot run'),
        h('span', {}, st.check.verdict === 'error' ? st.check.message : st.check.message.replace(/^(Met|Not met):? ?/, '')),
        st.check.subjects.length > 1 ? h('ul', {}, st.check.subjects.map((x) => h('li', { class: x.verdict }, `${x.name}: ${x.verdict === 'pass' ? 'met' : x.verdict === 'fail' ? 'not met' : 'cannot run'}`))) : null) : null,
    ];
  }

  /** What the solver says about a value, an equation or a block. @param {Element} e */
  function analysisInfo(e) {
    const m = ctx.model;
    if (e.kind === 'attribute') {
      /** @type {any[]} */
      const out = [];
      const u = e.props.unit || (e.props.type ? m.get(e.props.type)?.props.unit : '') || '';
      if (u && !isUnit(u)) out.push(h('p', { class: 'warn small' }, `Loom does not know the unit "${u}", so this value cannot be used in equations.`));
      else if (u) out.push(h('div', { class: 'kv' }, h('span', {}, 'Measures'), h('span', {}, dimName(parseUnit(u).d))));
      const owner = e.owner ? m.get(e.owner) : null;
      if (owner?.kind === 'partDef') {
        const v = analysisOf(m, owner.id).vars.get(e.id);
        if (v?.source === 'computed') out.push(h('div', { class: 'kv' }, h('span', {}, 'Computed'), h('span', { class: 'mono good' }, showVar(v))));
        else if (v?.source === 'unknown' && hasEquations(m, owner.id)) out.push(h('div', { class: 'kv' }, h('span', {}, 'Computed'), h('span', { class: 'muted' }, 'not yet: no equation gives it a value')));
      }
      return out;
    }
    if (e.kind === 'constraintDef') {
      if (!e.props.expr) return [h('p', { class: 'muted small' }, 'Write the equation above, such as t = E / P. Loom adds a parameter for each name in it; give each a unit.')];
      try { parseExpr(e.props.expr); }
      catch (err) { return [h('p', { class: 'bad small' }, `The equation has a problem: ${err instanceof ExprError ? err.message : String(err)}`)]; }
      const params = m.children(e.id).filter((c) => c.kind === 'attribute');
      return [h('div', { class: 'kv' }, h('span', {}, 'Parameters'), h('span', { class: 'mono' }, params.map((p) => p.name + (p.props.unit ? ` [${p.props.unit}]` : '')).join(', ') || 'none'))];
    }
    if (e.kind === 'partDef' && hasEquations(m, e.id)) {
      const an = analysisOf(m, e.id);
      const computed = [...an.vars.values()].filter((v) => v.source === 'computed' && !v.local);
      return [
        h('div', { class: 'sec' }, `Analysis · ${an.equations.length} equation${an.equations.length === 1 ? '' : 's'}`),
        ...computed.slice(0, 10).map((v) => h('div', { class: 'kv' }, h('span', { class: 'mono ellip', title: v.name }, v.name), h('span', { class: 'mono good' }, showVar(v)))),
        ...an.problems.slice(0, 6).map((p) => h('button', { class: `linkish small ${p.level === 'error' ? 'bad' : 'warn'}`, type: 'button', onclick: () => p.id && ctx.select(p.id) }, p.message)),
        !computed.length && !an.problems.length ? h('p', { class: 'muted small' }, 'Nothing to compute: every value is given.') : null,
      ];
    }
    return [];
  }

  /** @param {Element} e */
  function propFields(e) {
    const n = ctx.settings.get().notation;
    return Object.entries(ELEMENTS[e.kind].props).filter(([, p]) => !p.hidden).map(([key, p]) => {
      const value = e.props[key];
      const set = (/** @type {any} */ v) => ctx.edit(`Change ${p.label.toLowerCase()}`, (tx) => {
        tx.setProps(e.id, { [key]: v });
        // a new equation brings its parameters with it
        if (e.kind === 'constraintDef' && key === 'expr') addMissingParams(ctx.model, tx, e.id);
      });
      if (key === 'idPrefix' && e.kind === 'package') {
        const inherited = e.owner ? idPrefixFor(ctx.model, e.owner) : DEFAULT_PREFIX;
        return textField(p.label, value ?? '', set, { placeholder: inherited, mono: true, hint: value ? 'New requirements in here are numbered with this prefix' : `Empty: uses ${inherited}` });
      }
      if (p.type === 'text') return textField(p.label, value ?? '', set, { placeholder: p.placeholder, mono: ['reqId', 'value', 'unit', 'multiplicity', 'expr', 'check'].includes(key), hint: key === 'check' ? 'Names are values of what satisfies this requirement; units in brackets. Re-checked on every edit.' : undefined });
      if (p.type === 'longtext') return textField(p.label, value ?? '', set, { long: true, placeholder: p.placeholder });
      if (p.type === 'end') {
        // a connector end: the parts it runs through, then the port
        const ids = value ? [...value.path, ...(value.port ? [value.port] : [])] : [];
        return h('div', { class: 'field-label' }, p.label,
          ids.length ? h('div', { class: 'end-path' }, ids.map((x, i) => [i ? h('span', { class: 'sep' }, '.') : null, h('button', { class: 'linkish mono', type: 'button', onclick: () => ctx.select(x) }, ctx.model.get(x)?.name || '?')]))
            : h('span', { class: 'muted small' }, 'Not set'));
      }
      if (p.type === 'bool') {
        const cb = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!value), 'aria-label': p.label, onclick: () => set(!value) });
        return h('div', { class: 'opt' }, h('span', {}, p.label), cb);
      }
      if (p.type === 'enum') {
        const label = (/** @type {string} */ o) => (key === 'level' && o === 'Auto' && e.kind === 'requirement' ? `Auto (${levelOf(ctx.model, e.id, new Set(), true)})` : o);
        const sel = h('select', { class: 'field' }, p.options.map((o) => h('option', { value: o, selected: o === value ? true : undefined }, label(o))));
        sel.addEventListener('change', () => set(sel.value));
        return h('label', { class: 'field-label' }, p.label, sel);
      }
      // ref: pick an element of an allowed kind
      const options = p.kinds.flatMap((k) => ctx.model.byKind(k)).sort((a, b) => a.name.localeCompare(b.name));
      const sel = h('select', { class: 'field' },
        h('option', { value: '' }, options.length ? '— none —' : `— no ${p.kinds.map((k) => kindName(k, n)).join(' / ')} yet —`),
        options.map((o) => h('option', { value: o.id, selected: o.id === value ? true : undefined }, o.name)));
      sel.addEventListener('change', () => set(sel.value || null));
      const target = value ? ctx.model.get(value) : null;
      return h('div', {}, h('label', { class: 'field-label' }, p.label, sel),
        target ? h('button', { class: 'linkish', type: 'button', onclick: () => ctx.select(target.id) }, `Go to ${target.name}`) : null);
    });
  }

  /** The stereotypes applied to an element, their tagged values, and a way to apply more. @param {Element} e */
  function stereotypes(e) {
    if (!canHaveStereo(e.kind) || e.layer) return null;
    const m = ctx.model, n = ctx.settings.get().notation;
    const info = appliedOf(m, e.id);
    const can = applicableStereotypes(m, e.kind).filter((st) => !info.some((x) => x.st.id === st.id));
    const any = m.byKind('stereotype').length > 0;
    if (!info.length && !any && e.kind !== 'partDef' && e.kind !== 'requirement') return null;
    let adder = null;
    if (can.length) {
      const sel = h('select', { class: 'field', 'aria-label': 'Apply a stereotype' }, h('option', { value: '' }, 'Apply a stereotype…'), can.map((st) => h('option', { value: st.id }, `«${st.name}»`)));
      sel.addEventListener('change', () => { if (sel.value) ctx.edit('Apply stereotype', (tx) => applyStereo(m, tx, e.id, sel.value)); });
      adder = sel;
    } else if (!any) adder = h('p', { class: 'muted small' }, 'Make your own kinds of element (Flight critical, COTS, Software…) with a profile and stereotypes. ',
      ctx.newProfile ? h('button', { class: 'linkish', type: 'button', onclick: () => ctx.newProfile?.() }, 'New profile') : null);
    return [
      h('div', { class: 'sec' }, `Stereotypes · ${info.length}`),
      info.map(({ st, tags }) => h('div', { class: 'stereo-card' },
        h('div', { class: 'stereo-head' },
          st.props.icon ? h('span', { class: 'stereo-icon', 'aria-hidden': 'true' }, st.props.icon) : null,
          h('button', { class: 'linkish stereo-name', type: 'button', title: `Go to the stereotype ${st.name}`, onclick: () => ctx.select(st.id) }, `«${st.name}»`),
          st.props.color && st.props.color !== 'none' ? h('span', { class: `swatch fill-${st.props.color}`, 'aria-hidden': 'true' }) : null,
          h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Remove «${st.name}»`, title: 'Remove this stereotype', onclick: () => ctx.edit(`Remove «${st.name}»`, (tx) => unapplyStereo(m, tx, e.id, st.id)) }, icon('x'))),
        tags.map((t) => textField(t.tag.name + (t.tag.props.unit ? ` [${t.tag.props.unit}]` : ''), t.given ? t.value : '', (v) => ctx.edit(`Set ${t.tag.name}`, (tx) => setTag(m, tx, e.id, st.id, t.tag.id, v.trim())), { placeholder: String(t.tag.props.value || '') || 'no default', mono: true })),
        !tags.length ? h('p', { class: 'muted small' }, `«${st.name}» has no tags.`) : null)),
      adder,
      info.length && n === 'guided' ? h('p', { class: 'muted small' }, 'Stereotypes are your own kinds: they change how this element looks and what you record about it, never what it is.') : null,
    ];
  }

  /** A stereotype's own settings: what it applies to, its tags, where it is used. @param {Element} e */
  function stereotypeEditor(e) {
    const m = ctx.model, n = ctx.settings.get().notation;
    const kinds = stereoKinds(e);
    const toggle = (/** @type {string} */ k) => {
      const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
      ctx.edit('Change what the stereotype applies to', (tx) => tx.setProps(e.id, { extends: STEREO_TARGETS.filter((x) => next.includes(x)).join(',') }));
    };
    const tags = m.children(e.id).filter((c) => c.kind === 'attribute');
    const users = m.appliedTo(e.id);
    return [
      h('div', { class: 'sec' }, 'Applies to'),
      h('div', { class: 'kind-picks', role: 'group', 'aria-label': 'Applies to' }, STEREO_TARGETS.map((k) => h('button', { class: 'kind-pick' + (kinds.includes(k) ? ' on' : ''), type: 'button', 'aria-pressed': String(kinds.includes(k)), onclick: () => toggle(k) }, kindName(k, n)))),
      h('small', { class: 'muted small' }, kinds.length ? `«${e.name}» can be applied to ${kindsText(kinds, n).toLowerCase()}.` : 'Nothing picked: it can be applied to any element.'),
      h('div', { class: 'sec' }, `Tags · ${tags.length}`),
      tags.length ? h('div', { class: 'chips' }, tags.map((t) => h('button', { class: 'chip', type: 'button', title: t.name, onclick: () => ctx.select(t.id) }, h('span', { class: 'chip-kind mono' }, 'tag'), h('span', { class: 'chip-name' }, `${t.name}${t.props.value ? ` = ${t.props.value}` : ''}`))))
        : h('p', { class: 'muted small' }, 'Tags are what you record on each element with this stereotype (an owner, a level). Their values here are the defaults.'),
      ctx.create ? h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.create?.('attribute', e.id) }, icon('plus'), 'Add a tag') : null,
      h('div', { class: 'sec' }, `Applied to · ${users.length}`),
      users.length ? h('div', { class: 'chips' }, users.map((u) => h('button', { class: 'chip', type: 'button', title: u.name, onclick: () => ctx.select(u.id) }, h('span', { class: 'chip-kind mono' }, ELEMENTS[u.kind].abbr), h('span', { class: 'chip-name' }, u.name))))
        : h('p', { class: 'muted small' }, 'Not applied to anything yet. Select an element and apply it in its inspector.'),
    ];
  }

  /** What the validation rules say about this element. @param {Element} e */
  function problems(e) {
    const list = ctx.validator?.problemsFor(e.id) || [];
    if (!list.length) return null;
    const cfg = configOf(ctx.model);
    return [
      h('div', { class: 'sec' }, `Problems · ${list.length}`),
      list.map((p) => h('div', { class: `insp-prob sev-${p.severity}` },
        h('span', { class: 'prob-ic', 'aria-label': p.severity }, icon(SEV_ICON[p.severity])),
        h('div', { class: 'insp-prob-text' }, h('span', {}, p.message), h('small', {}, ruleTitle(cfg, p.rule))),
        h('div', { class: 'insp-prob-acts' },
          p.fix && ctx.fix ? h('button', { class: 'btn sm', type: 'button', title: p.fix.label, onclick: () => ctx.fix?.(p) }, icon('wand'), 'Fix') : null,
          ctx.ignore ? h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Ignore this problem', title: 'Ignore this problem', onclick: () => ctx.ignore?.(p) }, icon('eyeOff')) : null))),
    ];
  }

  /** @param {Element} e */
  function relationships(e) {
    const m = ctx.model, n = ctx.settings.get().notation;
    const out = m.relsFrom(e.id).map((r) => ({ r, other: /** @type {Element} */ (m.get(/** @type {string} */ (r.target))), verb: RELATIONSHIPS[r.kind].verb[n] }));
    const inc = m.relsTo(e.id).map((r) => ({ r, other: /** @type {Element} */ (m.get(/** @type {string} */ (r.source))), verb: RELATIONSHIPS[r.kind].inverse[n] }));
    const rows = [...out, ...inc].map(({ r, other, verb }) => {
      const l = m.layerOf(other.id);
      return h('div', { class: 'rel' },
        h('span', { class: 'rel-dot', style: { background: l ? LAYER[l].color : 'var(--text-3)' } }),
        h('span', { class: 'rel-verb mono' }, verb),
        h('button', { class: 'rel-name', type: 'button', title: other.name, onclick: () => ctx.select(other.id) }, other.name),
        h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Remove ${verb} ${other.name}`, title: 'Remove this relationship', onclick: () => ctx.edit('Remove relationship', (tx) => tx.remove(r.id)) }, icon('x')));
    });

    // add a relationship from this element
    const kinds = Object.keys(RELATIONSHIPS).filter((k) => m.all().some((t) => !isRel(t.kind) && t.id !== e.id && canRelate(k, e.kind, t.kind)));
    let adder = null;
    if (kinds.length) {
      const kindSel = h('select', { class: 'field', 'aria-label': 'Relationship' }, kinds.map((k) => h('option', { value: k }, RELATIONSHIPS[k].verb[n])));
      const targetSel = h('select', { class: 'field', 'aria-label': 'Target element' });
      const fill = () => {
        const cands = m.all().filter((t) => !isRel(t.kind) && m.canLink(kindSel.value, e.id, t.id) && t.owner).sort((a, b) => a.name.localeCompare(b.name));
        targetSel.replaceChildren(h('option', { value: '' }, cands.length ? 'Choose an element…' : 'Nothing to link to'), ...cands.map((t) => h('option', { value: t.id }, `${t.name} · ${kindName(t.kind, n)}`)));
      };
      kindSel.addEventListener('change', fill); fill();
      const add = h('button', { class: 'btn sm', type: 'button', onclick: () => { if (targetSel.value) ctx.edit('Add relationship', (tx) => tx.link(kindSel.value, e.id, targetSel.value)); } }, icon('plus'), 'Add');
      adder = h('div', { class: 'rel-add' }, kindSel, targetSel, add);
    }
    return [
      h('div', { class: 'sec' }, `Relationships · ${rows.length}`),
      rows.length ? h('div', { class: 'rels' }, rows) : h('p', { class: 'muted small' }, 'None yet.'),
      adder,
    ];
  }

  /** @param {Element} e */
  function elementView(e) {
    const m = ctx.model, n = ctx.settings.get().notation;
    const layer = m.layerOf(e.id);
    const kids = m.children(e.id);
    const path = m.path(e.id).filter((p) => p.owner); // skip the project root
    const name = e.layer
      ? h('h2', { class: 'insp-title' }, e.name)
      : textField('Name', e.name, (v) => ctx.edit('Rename', (tx) => tx.rename(e.id, v)));
    return [
      h('div', { class: 'insp-pills' },
        h('span', { class: 'pill', style: layer ? { color: LAYER[layer].color } : {} }, e.layer ? 'RFLP layer' : kindName(e.kind, n)),
        layer ? h('span', { class: 'pill' }, LAYER[layer].name) : null),
      path.length ? h('nav', { class: 'insp-path', 'aria-label': 'Location' }, path.map((p, i) => [i ? h('span', { class: 'sep' }, '›') : null, h('button', { type: 'button', class: 'linkish', onclick: () => ctx.select(p.id) }, p.name)])) : null,
      name,
      e.layer ? h('p', { class: 'muted small' }, `${LAYER[e.layer].note}. Add packages and elements with the + button in the browser.`) : null,
      e.layer ? null : h('p', { class: 'help' }, ELEMENTS[e.kind].help),
      isDiagram(e.kind) ? h('button', { class: 'btn primary sm insp-open', type: 'button', onclick: () => ctx.open(e.id) }, icon('diagram'), 'Open diagram') : null,
      isDiagram(e.kind) ? h('div', { class: 'kv' }, h('span', {}, 'Shows'), h('span', { class: 'mono' }, `${Object.keys(e.layout?.nodes || {}).length} elements`)) : null,
      problems(e),
      e.layer ? null : propFields(e),
      e.kind === 'stereotype' ? stereotypeEditor(e) : null,
      stereotypes(e),
      e.kind === 'requirement' ? reqStatus(e) : null,
      analysisInfo(e),
      kids.length && e.kind !== 'stereotype' ? [h('div', { class: 'sec' }, `Contains · ${kids.length}`), h('div', { class: 'chips' }, kids.map((k) => h('button', { class: 'chip', type: 'button', title: k.name, onclick: () => ctx.select(k.id) }, h('span', { class: 'chip-kind mono' }, ELEMENTS[k.kind].abbr), h('span', { class: 'chip-name' }, k.name))))] : null,
      e.layer || isDiagram(e.kind) ? null : relationships(e),
      (() => {
        const ds = m.diagramsShowing(e.id);
        return ds.length ? [h('div', { class: 'sec' }, `On diagrams · ${ds.length}`), h('div', { class: 'chips' }, ds.map((d) => h('button', { class: 'chip', type: 'button', title: `Open ${d.name}`, onclick: () => ctx.open(d.id) }, h('span', { class: 'chip-kind mono' }, ELEMENTS[d.kind].abbr), h('span', { class: 'chip-name' }, d.name))))] : null;
      })(),
      e.layer ? null : h('div', { class: 'insp-actions' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.commands.run('element.rename') }, 'Rename'),
        h('button', { class: 'btn sm danger-outline', type: 'button', onclick: () => ctx.commands.run('element.delete') }, 'Delete')),
      h('div', { class: 'insp-id mono', title: 'Element id' }, e.id),
    ];
  }

  function projectView() {
    const m = ctx.model, st = ctx.settings.get();
    const meta = ctx.meta();
    /** @param {import('../settings.js').Settings['notation']} v @param {string} label */
    const notBtn = (v, label) => h('button', { type: 'button', 'aria-pressed': String(st.notation === v), onclick: () => ctx.commands.run(`notation.${v}`) }, label);
    const notes = { sysml: 'SysML v1 vocabulary (Block, Part property…)', v2: 'SysML v2 keywords (part def, part…)', guided: 'Plain words, for newcomers' };
    return [
      h('div', { class: 'insp-title' }, 'Nothing selected'),
      h('div', { class: 'insp-sub' }, 'Select an element in the browser to see and edit it here.'),
      h('div', { class: 'sec' }, 'Project'),
      textField('Name', m.root().name, (v) => ctx.edit('Rename project', (tx) => tx.rename(m.root().id, v))),
      h('div', { class: 'kv' }, h('span', {}, 'Elements'), h('span', { class: 'mono' }, String(m.elementCount() - 5))),
      h('div', { class: 'kv' }, h('span', {}, 'Relationships'), h('span', { class: 'mono' }, String(m.count() - m.elementCount()))),
      h('div', { class: 'kv' }, h('span', {}, 'Created'), h('span', {}, new Date(meta.created).toLocaleDateString())),
      h('div', { class: 'sec' }, 'Files'),
      meta.folder
        ? [h('div', { class: 'kv' }, h('span', {}, 'Folder'), h('span', { class: 'mono', title: `Saved as SysML text in ${meta.folder.name}` }, meta.folder.name)),
          h('div', { class: 'kv' }, h('span', {}, 'Last saved there'), h('span', {}, new Date(meta.folder.synced).toLocaleTimeString())),
          h('div', { class: 'insp-actions' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.commands.run('project.folder.sync') }, 'Save now'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.commands.run('project.folder.load') }, 'Load changes'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.commands.run('project.folder.unlink') }, 'Unlink'))]
        : [h('p', { class: 'muted small' }, canUseFolders() ? 'Save the project to a folder as SysML v2 text, ready for git. Loom keeps it up to date as you work.' : 'Export the project as a .zip of SysML v2 text files, ready for git.'),
          h('div', { class: 'insp-actions' },
            canUseFolders() ? h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.commands.run('project.folder.link') }, icon('folder'), 'Save to a folder…') : null,
            h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.commands.run('project.exportZip') }, 'Export .zip'))],
      h('button', { class: 'btn sm insp-text', type: 'button', onclick: () => ctx.commands.run('view.text') }, icon('code'), st.textPane ? 'Hide the SysML v2 text' : 'Show the SysML v2 text'),
      h('div', { class: 'sec' }, 'Display'),
      h('div', { class: 'field-label' }, 'Notation',
        h('div', { class: 'seg seg-full', role: 'group', 'aria-label': 'Notation' }, notBtn('sysml', 'SysML'), notBtn('v2', 'SysML v2'), notBtn('guided', 'Guided')),
        h('small', {}, notes[st.notation])),
      validationInfo(),
      h('div', { class: 'sec' }, 'Customize'),
      h('div', { class: 'insp-actions' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.openPrefs?.('look') }, icon('palette'), 'Appearance'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.openPrefs?.('keys') }, icon('keyboard'), 'Shortcuts'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.openPrefs?.('presets') }, icon('eye'), 'View presets')),
      ctx.newProfile ? h('div', { class: 'insp-actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.newProfile?.() }, icon('tag'), 'New profile (your own stereotypes)')) : null,
      h('div', { class: 'sec' }, 'Integrations'),
      h('div', { class: 'opt' },
        h('span', {}, 'Pteronautics Works', h('small', {}, st.integrations.works ? 'On · values and analyses from Works' : 'Off · Loom runs on its own')),
        h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(st.integrations.works), 'aria-label': 'Link Pteronautics Works', onclick: () => ctx.commands.run('integrations.works') })),
    ];
  }

  /** The project's validation: rule set and counts. */
  function validationInfo() {
    if (!ctx.validator) return null;
    const r = ctx.validator.report(), cfg = configOf(ctx.model);
    return [
      h('div', { class: 'sec' }, 'Validation'),
      h('div', { class: 'kv' }, h('span', {}, 'Rule set'), h('span', {}, RULE_SETS.find((x) => x.id === cfg.set)?.name || cfg.set, Object.keys(cfg.rules).length || cfg.custom.length ? h('span', { class: 'muted' }, ' (changed)') : null)),
      h('div', { class: 'kv' }, h('span', {}, 'Problems'), h('span', { class: 'prob-sum' }, SEVERITIES.map((sv) => h('span', { class: `sev-${sv}` }, icon(SEV_ICON[sv]), `${r.counts[sv]} ${r.counts[sv] === 1 ? SEV_WORD[sv][0] : SEV_WORD[sv][1]}`)))),
      h('div', { class: 'insp-actions' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.commands.run('view.problems') }, icon('list'), ctx.settings.get().problems ? 'Hide problems' : 'Show problems'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.openRules?.() }, icon('sliders'), 'Rules…')),
    ];
  }

  function render() {
    const id = ctx.selected();
    const e = id ? ctx.model.get(id) : undefined;
    const scroll = el.scrollTop;
    const active = document.activeElement;
    const keep = active && el.contains(active) && active instanceof HTMLElement ? active.closest('label')?.textContent : null;
    el.replaceChildren(...[e ? elementView(e) : projectView()].flat(3).filter((x) => x));
    el.scrollTop = scroll;
    if (keep) [...el.querySelectorAll('label')].find((l) => l.textContent === keep)?.querySelector('input,textarea,select')?.focus?.();
  }

  render();
  return { el, render };
}
