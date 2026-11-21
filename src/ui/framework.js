// The framework dialog (Project menu → Framework): pick how the top of the model is organized.
// RFLP is the default; the others rename the four core sets in their own words and add sets
// of their own. Your own sets stay as they are.
import { h } from './dom.js';
import { modal } from './dialog.js';
import { FRAMEWORKS } from '../model/metamodel.js';
import { frameworkOf, applyFramework } from '../model/framework.js';

const ROLE = /** @type {const} */ ([['r', 'needs'], ['f', 'functions'], ['l', 'logical'], ['p', 'physical']]);

/** @param {import('../model/model.js').Model} m @returns {Promise<boolean>} whether it changed */
export async function openFrameworkDialog(m) {
  const cur = frameworkOf(m).id;
  /** @type {string | null} */
  const pick = await modal({
    title: 'Framework', ok: 'Use this framework', wide: true,
    build: () => {
      let chosen = cur;
      const cards = h('div', { class: 'fw-cards', role: 'radiogroup', 'aria-label': 'Framework' }, FRAMEWORKS.map((f) => h('button', {
        class: 'fw-card', type: 'button', role: 'radio', 'aria-checked': String(f.id === cur), 'data-f': f.id,
        onclick: () => { chosen = f.id; for (const b of cards.querySelectorAll('.fw-card')) b.setAttribute('aria-checked', String(/** @type {HTMLElement} */ (b).dataset.f === f.id)); },
      },
      h('span', { class: 'fw-head' }, h('b', {}, f.name), f.id === cur ? h('span', { class: 'pill' }, 'in use') : null, f.id === 'rflp' ? h('span', { class: 'pill' }, 'default') : null),
      h('span', { class: 'fw-blurb' }, f.blurb),
      h('span', { class: 'fw-sets' },
        ROLE.map(([r]) => h('span', { class: `fw-set role-${r}` }, h('i', { 'aria-hidden': 'true' }), f.sets[r].name)),
        (f.extra || []).map((x) => h('span', { class: 'fw-set own' }, h('i', { 'aria-hidden': 'true' }), x.name))))));
      return {
        body: h('div', {},
          h('p', { class: 'dialog-text' }, 'How the top of the model is organized. Every framework has the same four core sets underneath (what is needed, what it must do, how it is organized, what gets built), so traces, the Systems V and coverage work the same; it names them in its own words and may add sets of its own.'),
          cards,
          h('p', { class: 'dialog-text muted small' }, 'Switching renames the four core sets and adds the framework\'s own sets; nothing in the model moves, and it is one step you can undo. Add sets of your own with + in the model browser, and rename any set there.')),
        value: () => chosen,
      };
    },
  });
  if (!pick || pick === cur) return false;
  applyFramework(m, pick);
  return true;
}
