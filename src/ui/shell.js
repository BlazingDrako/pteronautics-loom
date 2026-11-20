// The Loom window: sidebar (project, model browser, views), top bar, stage, inspector, status bar.
// In this first build the model is empty; the model browser and diagram engine arrive next.
import { h, icon, brand, formatKeys, resolvedTheme } from './dom.js';
import { VERSION } from '../version.js';

/** @typedef {import('../settings.js').SettingsStore} SettingsStore */
/** @typedef {import('../commands.js').CommandRegistry} CommandRegistry */

/** The four RFLP layers, in the order the model browser shows them. */
export const LAYERS = [
  { id: 'r', name: 'Requirements', note: 'What is needed', color: 'var(--layer-r)' },
  { id: 'f', name: 'Functional', note: 'What it must do', color: 'var(--layer-f)' },
  { id: 'l', name: 'Logical', note: 'How it is organized', color: 'var(--layer-l)' },
  { id: 'p', name: 'Physical', note: 'What gets built', color: 'var(--layer-p)' },
];

/** Views listed in the sidebar. `ready: false` shows a "soon" tag. */
const VIEWS = [
  { id: 'home', name: 'Systems V', icon: 'home', ready: false },
  { id: 'diagrams', name: 'Diagrams', icon: 'diagram', ready: true },
  { id: 'trace', name: 'RFLP trace', icon: 'trace', ready: false },
  { id: 'tables', name: 'Tables', icon: 'table', ready: false },
  { id: 'matrices', name: 'Matrices', icon: 'matrix', ready: false },
  { id: 'library', name: 'SysML library', icon: 'book', ready: false },
];

/**
 * Build the shell into `root` and keep it in sync with settings.
 * @param {HTMLElement} root
 * @param {{ settings: SettingsStore, commands: CommandRegistry }} ctx
 */
export function mountShell(root, ctx) {
  const { settings, commands } = ctx;
  const shell = h('div', { class: 'shell' });
  root.replaceChildren(shell);

  const render = () => {
    const st = settings.get();
    shell.classList.toggle('no-insp', !st.inspector);
    shell.replaceChildren(sidebar(), topbar(), main(), inspector(), statusbar());
  };

  function sidebar() {
    return h('aside', { class: 'sidebar', 'aria-label': 'Model' },
      brand(),
      h('div', { class: 'project' }, h('div', { class: 'avatar' }, 'U'), h('div', {}, h('b', {}, 'Untitled project'), h('span', {}, 'local · 0 elements'))),
      LAYERS.map((l) => [
        h('div', { class: 'nav-group' }, h('span', { class: 'dot', style: { background: l.color } }), l.name),
        h('div', { class: 'tree-empty' }, `Nothing here yet · ${l.note.toLowerCase()}`),
      ]),
      h('div', { class: 'nav-group' }, 'Views'),
      VIEWS.map((v) => h('button', { class: 'nav-item' + (v.id === 'diagrams' ? ' active' : '') + (v.ready ? '' : ' planned'), type: 'button', 'aria-disabled': v.ready ? undefined : 'true', 'aria-current': v.id === 'diagrams' ? 'page' : undefined },
        icon(v.icon), v.name, v.ready ? null : h('span', { class: 'soon' }, 'soon'))),
      h('div', { class: 'sidebar-foot' },
        navButton(resolvedTheme() === 'dark' ? 'sun' : 'moon', resolvedTheme() === 'dark' ? 'Light theme' : 'Dark theme', 'theme.toggle'),
        navButton('keyboard', 'Shortcuts', 'help.shortcuts')));
  }

  /** @param {string} ic @param {string} label @param {string} cmd */
  function navButton(ic, label, cmd) {
    return h('button', { class: 'nav-item', type: 'button', onclick: () => commands.run(cmd) }, icon(ic), label);
  }

  function topbar() {
    return h('header', { class: 'topbar' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('span', {}, 'Untitled project'), h('span', { class: 'sep' }, '›'), h('b', {}, 'Diagrams')),
      h('div', { style: { flex: '1' } }),
      h('button', { class: 'palette-trigger', type: 'button', onclick: () => commands.run('palette.open'), 'aria-label': 'Open the command palette' },
        icon('search'), h('span', {}, 'Search or run a command'), h('span', { class: 'kbd' }, formatKeys('Mod+K'))),
      h('button', { class: 'icon-btn' + (settings.get().inspector ? ' on' : ''), type: 'button', 'aria-label': 'Show or hide the inspector', 'aria-pressed': String(settings.get().inspector), title: `Inspector (${formatKeys('Mod+.')})`, onclick: () => commands.run('view.inspector') }, icon('panel')));
  }

  function main() {
    const guided = settings.get().notation === 'guided';
    return h('main', { class: 'main' },
      h('div', { class: 'tabbar' }, h('span', { class: 'hint' }, 'No diagrams open')),
      h('div', { class: 'stage', role: 'region', 'aria-label': 'Diagram canvas' },
        h('div', { class: 'empty' },
          h('div', { class: 'empty-card' },
            h('div', { class: 'eyebrow' }, 'New project'),
            h('h2', {}, 'Start your model'),
            h('p', {}, guided
              ? 'A Loom model has four layers. Start with what the system must do, then describe the parts that do it.'
              : 'Loom organizes a model in four RFLP layers, traced end to end from requirements to physical parts.'),
            h('div', { class: 'layers' }, LAYERS.map((l) => h('div', { class: 'layer' }, h('i', { style: { background: l.color } }), h('b', {}, l.name), h('span', {}, l.note)))),
            h('div', { class: 'row' },
              h('button', { class: 'btn primary', type: 'button', onclick: () => commands.run('palette.open') }, icon('command'), 'Open the command palette'),
              h('button', { class: 'btn', type: 'button', onclick: () => commands.run('help.shortcuts') }, icon('keyboard'), 'Shortcuts'))))));
  }

  function inspector() {
    const st = settings.get();
    return h('aside', { class: 'inspector', 'aria-label': 'Inspector' },
      h('div', { class: 'insp-title' }, 'Nothing selected'),
      h('div', { class: 'insp-sub' }, 'Select an element to see and edit it here.'),
      h('div', { class: 'sec' }, 'Project'),
      h('div', { class: 'kv' }, h('span', {}, 'Name'), h('span', {}, 'Untitled project')),
      h('div', { class: 'kv' }, h('span', {}, 'Elements'), h('span', { class: 'mono' }, '0')),
      h('div', { class: 'kv' }, h('span', {}, 'Format'), h('span', { class: 'mono' }, 'SysML v2')),
      h('div', { class: 'sec' }, 'Display'),
      h('div', { class: 'opt' },
        h('span', {}, 'Notation', h('small', {}, st.notation === 'guided' ? 'Plain words, for newcomers' : 'Standard SysML vocabulary')),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Notation' },
          h('button', { type: 'button', 'aria-pressed': String(st.notation === 'sysml'), onclick: () => commands.run('notation.sysml') }, 'SysML'),
          h('button', { type: 'button', 'aria-pressed': String(st.notation === 'guided'), onclick: () => commands.run('notation.guided') }, 'Guided'))),
      h('div', { class: 'sec' }, 'Integrations'),
      h('div', { class: 'opt' },
        h('span', {}, 'Pteronautics Works', h('small', {}, st.integrations.works ? 'On · values and analyses from Works' : 'Off · Loom runs on its own')),
        h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(st.integrations.works), 'aria-label': 'Link Pteronautics Works', onclick: () => commands.run('integrations.works') })));
  }

  function statusbar() {
    const st = settings.get();
    return h('footer', { class: 'statusbar' },
      h('span', {}, h('span', { class: 'ok-dot' }), 'No problems'),
      h('span', {}, 'Local project'),
      h('span', { class: 'grow' }),
      h('span', {}, st.notation === 'guided' ? 'Guided notation' : 'SysML notation'),
      st.integrations.works ? h('span', { class: 'pill accent' }, 'Works linked') : null,
      h('span', { class: 'mono' }, `Loom ${VERSION}`));
  }

  render();
  settings.subscribe(render);
  addEventListener('themechange', render);
  return { render };
}
