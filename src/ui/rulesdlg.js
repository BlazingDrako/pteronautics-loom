// The validation rules dialog: choose a rule set, turn rules on or off or change how severe
// they are, write your own rules, and bring back problems you ignored. Changes are made to a
// copy and saved, as one undoable edit, when you press Save.
import { h, icon } from './dom.js';
import { modal } from './dialog.js';
import { ELEMENTS, kindName, isDiagram } from '../model/metamodel.js';
import { RULES, RULE_SETS, CATEGORIES, inSet } from '../validate/rules.js';
import { configOf, parseConfig, configText, effective, SEVERITIES, TESTS, customText, customError } from '../validate/engine.js';

/** @typedef {import('../validate/engine.js').Config} Config */
/** @typedef {import('../validate/engine.js').CustomRule} CustomRule */

const SEV_LABEL = /** @type {Record<string, string>} */ ({ off: 'Off', error: 'Error', warning: 'Warning', info: 'Note' });

/**
 * Open the dialog. Resolves to the new settings when saved, or null.
 * @param {import('../model/model.js').Model} m @param {import('../model/metamodel.js').Notation} n
 * @returns {Promise<Config | null>}
 */
export function openRulesDialog(m, n) {
  /** @type {Config} */
  const c = parseConfig(configOf(m));
  let query = '';
  return modal({
    title: 'Validation rules', ok: 'Save', wide: true,
    build: () => {
      const body = h('div', { class: 'rules-dlg' });
      function paint() {
        const eff = effective(c);
        const q = query.toLowerCase();
        const shown = RULES.filter((r) => !q || `${r.title} ${r.help} ${r.category}`.toLowerCase().includes(q));
        const on = RULES.filter((r) => eff.get(r.id) !== 'off').length;
        const scroll = body.querySelector('.rules-scroll')?.scrollTop || 0;
        const search = h('input', { class: 'field', type: 'search', placeholder: 'Find a rule', value: query, 'aria-label': 'Find a rule' });
        search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        search.addEventListener('input', () => { query = search.value; paint(); const s = /** @type {HTMLInputElement | null} */ (body.querySelector('input[type=search]')); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); });
        body.replaceChildren(
          h('div', { class: 'field-label' }, 'Rule set',
            h('div', { class: 'seg seg-full', role: 'group', 'aria-label': 'Rule set' }, RULE_SETS.map((s) => h('button', { type: 'button', 'aria-pressed': String(c.set === s.id), onclick: () => { c.set = s.id; paint(); } }, s.name))),
            h('small', {}, `${RULE_SETS.find((s) => s.id === c.set)?.note} ${on} of ${RULES.length} rules on${Object.keys(c.rules).length ? `, ${Object.keys(c.rules).length} changed from the set` : ''}.`)),
          h('div', { class: 'rules-tools' }, search,
            Object.keys(c.rules).length ? h('button', { class: 'btn sm', type: 'button', onclick: () => { c.rules = {}; paint(); } }, 'Undo my changes to the set') : null),
          h('div', { class: 'rules-scroll' },
            CATEGORIES.map((cat) => {
              const rs = shown.filter((r) => r.category === cat);
              if (!rs.length) return null;
              return h('section', { class: 'rules-cat' }, h('div', { class: 'sec' }, cat),
                rs.map((r) => {
                  const cur = eff.get(r.id) || 'off';
                  const changed = r.id in c.rules;
                  const sel = h('select', { class: 'field sm', 'aria-label': `${r.title}: severity` }, ['off', ...SEVERITIES].map((v) => h('option', { value: v, selected: v === cur ? true : undefined }, SEV_LABEL[v])));
                  sel.addEventListener('change', () => {
                    const v = sel.value;
                    const base = inSet(r, c.set) ? r.severity : 'off';
                    if (v === base) delete c.rules[r.id];
                    else c.rules[r.id] = v === r.severity && !inSet(r, c.set) ? 'on' : /** @type {any} */ (v);
                    paint();
                  });
                  return h('div', { class: 'rule-row' + (cur === 'off' ? ' off' : '') },
                    h('div', { class: 'rule-text' }, h('b', {}, r.title, changed ? h('span', { class: 'changed-dot', title: 'Changed from the rule set' }) : null), h('small', {}, r.help)),
                    sel);
                }));
            }),
            customSection(),
            c.ignored.length ? h('section', { class: 'rules-cat' }, h('div', { class: 'sec' }, 'Ignored problems'),
              h('div', { class: 'rule-row' }, h('div', { class: 'rule-text' }, h('b', {}, `${c.ignored.length} problem${c.ignored.length === 1 ? '' : 's'} ignored`), h('small', {}, 'Ignored problems are hidden from the problems panel and from badges.')),
                h('button', { class: 'btn sm', type: 'button', onclick: () => { c.ignored = []; paint(); } }, 'Show them again'))) : null));
        const sc = body.querySelector('.rules-scroll');
        if (sc) sc.scrollTop = scroll;
      }

      /** Your own rules, and the form to add one. */
      function customSection() {
        const kinds = Object.keys(ELEMENTS).filter((k) => !isDiagram(k) && !ELEMENTS[k].noMenu);
        const kindSel = h('select', { class: 'field sm', 'aria-label': 'Kind of element' }, kinds.map((k) => h('option', { value: k, selected: k === 'requirement' ? true : undefined }, kindName(k, n))));
        const propSel = h('select', { class: 'field sm', 'aria-label': 'Property' });
        const testSel = h('select', { class: 'field sm', 'aria-label': 'Test' }, TESTS.map(([id, label]) => h('option', { value: id }, label)));
        const value = h('input', { class: 'field sm mono', type: 'text', placeholder: 'value or pattern', 'aria-label': 'Value or pattern' });
        const sevSel = h('select', { class: 'field sm', 'aria-label': 'Severity' }, SEVERITIES.map((v) => h('option', { value: v, selected: v === 'warning' ? true : undefined }, SEV_LABEL[v])));
        const err = h('div', { class: 'field-error', role: 'alert' });
        const fillProps = () => {
          const spec = ELEMENTS[kindSel.value].props;
          const props = [['name', 'Name'], ...Object.entries(spec).filter(([k, p]) => !p.hidden && p.type !== 'end' && p.type !== 'stereo' && k !== 'validation').map(([k, p]) => [k, p.label]), ...(spec.applied ? [['stereotypes', 'Stereotypes']] : [])];
          propSel.replaceChildren(...props.map(([k, l]) => h('option', { value: k }, l)));
        };
        const sync = () => { value.disabled = testSel.value === 'set'; value.placeholder = testSel.value === 'match' || testSel.value === 'noMatch' ? 'a pattern, such as ^[A-Z]' : 'value'; };
        kindSel.addEventListener('change', fillProps); testSel.addEventListener('change', sync);
        // Enter adds the rule (instead of saving the dialog)
        value.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        fillProps(); sync();
        const add = () => {
          /** @type {CustomRule} */
          const r = { id: `c${Date.now().toString(36)}`, name: '', kind: kindSel.value, prop: propSel.value, test: /** @type {any} */ (testSel.value), value: testSel.value === 'set' ? '' : value.value, severity: /** @type {any} */ (sevSel.value) };
          if (r.test !== 'set' && !r.value) { err.textContent = 'Give a value or a pattern.'; value.focus(); return; }
          const bad = customError(r);
          if (bad) { err.textContent = `That pattern does not work: ${bad}`; value.focus(); return; }
          c.custom.push(r);
          paint();
        };
        return h('section', { class: 'rules-cat' }, h('div', { class: 'sec' }, 'Your own rules'),
          c.custom.length ? c.custom.map((r, i) => h('div', { class: 'rule-row' },
            h('div', { class: 'rule-text' }, h('b', {}, customText(r)), customError(r) ? h('small', { class: 'bad' }, `This pattern does not work: ${customError(r)}`) : null),
            h('span', { class: `sev-chip sev-${r.severity}` }, SEV_LABEL[r.severity]),
            h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Delete the rule: ${customText(r)}`, title: 'Delete this rule', onclick: () => { c.custom.splice(i, 1); paint(); } }, icon('x'))))
            : h('p', { class: 'muted small' }, 'Add rules of your own, such as every requirement\'s priority must be set, or every block\'s name must match ^[A-Z].'),
          h('div', { class: 'custom-form' },
            h('span', { class: 'small' }, 'Every'), kindSel, propSel, testSel, value, sevSel,
            h('button', { class: 'btn sm', type: 'button', onclick: add }, icon('plus'), 'Add rule')),
          err);
      }

      paint();
      return { body, value: () => parseConfig(configText(c)) };
    },
  });
}
