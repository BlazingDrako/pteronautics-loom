// Pteronautics Loom: startup, routing, commands and keyboard shortcuts.
//   #/            Home: your projects
//   #/p/<id>      a project's workspace
import { initTheme, toggleTheme, toast, formatKeys, IS_MAC, h } from './ui/dom.js';
import { createSettings } from './settings.js';
import { createCommands } from './commands.js';
import { openPalette, isPaletteOpen } from './ui/palette.js';
import { mountHome, download } from './ui/home.js';
import { mountWorkspace } from './ui/workspace.js';
import { prompt } from './ui/dialog.js';
import { createProjectStore, defaultBackend } from './storage/projects.js';
import { ELEMENTS, kindName } from './model/metamodel.js';

initTheme();
const settings = createSettings();
const commands = createCommands();
const projects = createProjectStore(await defaultBackend());
const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** @type {import('./ui/workspace.js').Workspace | null} */
let ws = null;
/** @type {Awaited<ReturnType<typeof mountHome>> | null} */
let home = null;

const inProject = () => ws !== null;
const notation = () => settings.get().notation;

// ---------- general ----------
commands.add({ id: 'palette.open', title: 'Open the command palette', group: 'General', keys: 'Mod+K', run: () => openPalette(commands, ws ? elementItems : undefined) });
commands.add({ id: 'go.home', title: 'Go to all projects', group: 'General', keys: 'Mod+Shift+H', keywords: ['home', 'projects', 'back'], enabled: inProject, run: () => { location.hash = '#/'; } });
commands.add({ id: 'theme.toggle', title: 'Switch light / dark theme', group: 'View', keywords: ['dark mode', 'light mode', 'appearance'], run: toggleTheme });
commands.add({ id: 'view.inspector', title: 'Show or hide the inspector', group: 'View', keys: 'Mod+.', keywords: ['properties', 'panel'], enabled: inProject, run: () => settings.update((s) => { s.inspector = !s.inspector; }) });
commands.add({ id: 'notation.sysml', title: 'Notation: SysML (Block, Part property…)', group: 'View', keywords: ['stereotype', 'expert', 'v1'], run: () => settings.update((s) => { s.notation = 'sysml'; }) });
commands.add({ id: 'notation.v2', title: 'Notation: SysML v2 (part def, part…)', group: 'View', keywords: ['v2', 'keywords'], run: () => settings.update((s) => { s.notation = 'v2'; }) });
commands.add({ id: 'notation.guided', title: 'Notation: Guided (plain words)', group: 'View', keywords: ['beginner', 'newcomer', 'simple'], run: () => settings.update((s) => { s.notation = 'guided'; }) });
commands.add({
  id: 'integrations.works', title: 'Turn the Pteronautics Works link on or off', group: 'Integrations', keywords: ['works', 'integration', 'link'],
  run: () => {
    settings.update((s) => { s.integrations.works = !s.integrations.works; });
    toast(settings.get().integrations.works ? 'Pteronautics Works link turned on' : 'Pteronautics Works link turned off');
  },
});
commands.add({ id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', keywords: ['keys', 'hotkeys'], run: showShortcuts });
commands.add({ id: 'help.library', title: 'Open the SysML library', group: 'Help', keys: '?', keywords: ['reference', 'help', 'docs'], enabled: () => false, run: () => {} });

// ---------- projects ----------
commands.add({ id: 'project.new', title: 'New project…', group: 'Project', keywords: ['create'], run: async () => { if (ws) { location.hash = '#/'; await settle(); } home?.newProject(); } });
commands.add({ id: 'project.import', title: 'Import a .loom.json project…', group: 'Project', keywords: ['open', 'load', 'file'], run: async () => { if (ws) { location.hash = '#/'; await settle(); } home?.importFile(); } });
commands.add({
  id: 'project.export', title: 'Export this project (.loom.json)', group: 'Project', keys: 'Mod+Shift+E', keywords: ['save', 'download', 'file'], enabled: inProject,
  run: async () => { if (!ws) return; await ws.flush(); const f = await projects.exportFile(ws.meta().id); download(f.filename, f.text); toast(`Exported ${f.filename}`); },
});
commands.add({
  id: 'project.rename', title: 'Rename this project…', group: 'Project', enabled: inProject,
  run: async () => {
    if (!ws) return;
    const name = await prompt({ title: 'Rename project', label: 'Name', value: ws.model.root().name, ok: 'Rename' });
    if (name && ws) ws.model.transact('Rename project', (tx) => tx.rename(ws?.model.root().id, name));
  },
});

// ---------- editing ----------
commands.add({ id: 'edit.undo', title: 'Undo', group: 'Edit', keys: 'Mod+Z', enabled: () => !!ws?.model.canUndo(), run: () => ws?.model.undo() });
commands.add({ id: 'edit.redo', title: 'Redo', group: 'Edit', keys: 'Mod+Shift+Z', enabled: () => !!ws?.model.canRedo(), run: () => ws?.model.redo() });
commands.add({ id: 'element.rename', title: 'Rename the selected element', group: 'Edit', keys: 'F2', enabled: () => !!ws?.canEditSelection(), run: () => ws?.rename() });
commands.add({ id: 'element.delete', title: 'Delete the selected element', group: 'Edit', keys: 'Delete', keywords: ['remove'], enabled: () => !!ws?.canEditSelection(), run: () => ws?.remove() });
commands.add({ id: 'element.deselect', title: 'Clear the selection', group: 'Edit', keys: 'Escape', enabled: () => !!ws?.selected(), run: () => ws?.select(null) });
for (const kind of Object.keys(ELEMENTS).filter((k) => !ELEMENTS[k].diagram)) {
  commands.add({
    id: `model.new.${kind}`, group: 'Model',
    get title() { return `New ${kindName(kind, notation())}`; },
    keywords: ['create', 'add', kindName(kind, 'sysml'), kindName(kind, 'v2'), kindName(kind, 'guided')],
    enabled: () => !!ws?.canNew(kind),
    run: () => ws?.newElement(kind),
  });
}

// ---------- diagrams ----------
commands.add({ id: 'diagram.new.bdd', group: 'Diagram', get title() { return `New ${kindName('bdd', notation())}`; }, keywords: ['bdd', 'structure', 'block', 'create'], enabled: () => !!ws?.canNew('bdd'), run: () => ws?.newDiagram('bdd') });
commands.add({ id: 'diagram.new.ibd', group: 'Diagram', get title() { return `New ${kindName('ibd', notation())} for the selected block`; }, keywords: ['ibd', 'internal', 'ports', 'connectors', 'create'], enabled: () => !!ws?.canNew('ibd'), run: () => ws?.newDiagram('ibd') });
const inDiagram = () => !!ws?.activeView();
commands.add({ id: 'diagram.fit', title: 'Fit the diagram to the window', group: 'Diagram', keywords: ['zoom', 'all'], enabled: inDiagram, run: () => ws?.activeView()?.fit() });
commands.add({ id: 'diagram.zoomIn', title: 'Zoom in', group: 'Diagram', enabled: inDiagram, run: () => ws?.activeView()?.zoomIn() });
commands.add({ id: 'diagram.zoomOut', title: 'Zoom out', group: 'Diagram', enabled: inDiagram, run: () => ws?.activeView()?.zoomOut() });
commands.add({ id: 'diagram.tidy', title: 'Tidy the diagram layout', group: 'Diagram', keywords: ['auto layout', 'arrange'], enabled: inDiagram, run: () => ws?.activeView()?.tidy() });
commands.add({ id: 'diagram.related', title: 'Add related blocks to the diagram', group: 'Diagram', keywords: ['parts', 'types', 'generalization', 'show'], enabled: inDiagram, run: () => ws?.activeView()?.addRelated() });
commands.add({ id: 'diagram.remove', title: 'Remove the selection from the diagram (keep in model)', group: 'Diagram', keywords: ['hide'], enabled: () => !!ws?.activeView()?.selection().length, run: () => ws?.activeView()?.removeFromView() });

/** Model elements as palette items, so typing a name jumps to it. @returns {import('./commands.js').Command[]} */
function elementItems() {
  return (ws?.searchItems() || []).map((e) => ({ id: `goto:${e.id}`, title: e.name, group: e.kind, run: () => ws?.select(e.id) }));
}

function showShortcuts() {
  const list = commands.list().filter((c) => c.keys);
  import('./ui/dialog.js').then(({ modal }) => modal({
    title: 'Keyboard shortcuts', ok: 'Done',
    build: () => ({
      body: h('div', { class: 'shortcuts' },
        list.map((c) => h('div', { class: 'shortcut' }, h('span', {}, c.title), h('span', { class: 'kbd' }, formatKeys(/** @type {string} */ (c.keys))))),
        h('div', { class: 'shortcut' }, h('span', {}, 'Move in the model browser'), h('span', { class: 'kbd' }, '↑ ↓ ← →'))),
      value: () => true,
    }),
  }));
}

addEventListener('keydown', (e) => {
  if (isPaletteOpen() || document.querySelector('.dialog-back, .popmenu')) return;
  // in a text field only Mod shortcuts apply, and Mod+Z stays the field's own undo
  const t = /** @type {HTMLElement} */ (e.target);
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const cmd = commands.forEvent(e, IS_MAC);
  if (!cmd) return;
  if (typing && (!cmd.keys?.startsWith('Mod') || cmd.id.startsWith('edit.'))) return;
  e.preventDefault();
  if (!commands.run(cmd.id) && cmd.id !== 'element.deselect') toast(`${cmd.title} is not available here`);
});

// ---------- routing ----------
/** @type {Promise<void>} */
let routing = Promise.resolve();
/** Wait for a route change to finish mounting. */
const settle = () => new Promise((r) => setTimeout(r, 0)).then(() => routing);

function route() { routing = doRoute(); return routing; }

async function doRoute() {
  const m = location.hash.match(/^#\/p\/([A-Za-z0-9_-]+)/);
  ws?.dispose(); ws = null;
  home?.dispose(); home = null;
  if (m) {
    try {
      const { meta, model } = await projects.open(m[1]);
      ws = mountWorkspace(app, { meta, model, settings, commands, save: (mm) => projects.save(meta.id, mm) });
      document.title = `${meta.name} · Pteronautics Loom`;
      return;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open that project', true);
      history.replaceState(null, '', '#/');
    }
  }
  document.title = 'Pteronautics Loom';
  home = await mountHome(app, { projects, open: (id) => { location.hash = `#/p/${id}`; }, toggleTheme });
}

addEventListener('hashchange', route);
route();
