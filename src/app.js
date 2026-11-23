// Pteronautics Loom: startup, routing, commands and keyboard shortcuts.
//   #/            Home: your projects
//   #/p/<id>      a project's workspace
import { ARRANGE } from './canvas/arrange.js';
import { initTheme, toggleTheme, toast, IS_MAC, applyLook } from './ui/dom.js';
import { openPreferences } from './ui/prefs.js';
import { createSettings } from './settings.js';
import { createCommands } from './commands.js';
import { openPalette, isPaletteOpen } from './ui/palette.js';
import { mountHome, download } from './ui/home.js';
import { mountWorkspace } from './ui/workspace.js';
import { prompt } from './ui/dialog.js';
import { createProjectStore, defaultBackend } from './storage/projects.js';
import { ELEMENTS, kindName } from './model/metamodel.js';
import { canUseFolders } from './storage/folderfs.js';
import { startPwa, canInstall, install } from './pwa.js';

initTheme();
const settings = createSettings();
const commands = createCommands();
// appearance and shortcut changes from the preferences apply everywhere, at once
const applySettings = () => { applyLook(settings.get()); commands.setOverrides(settings.get().keys); };
applySettings();
settings.subscribe(applySettings);
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
commands.add({ id: 'view.inspector', title: 'Show or hide the properties of the selection', group: 'View', keys: 'Mod+.', keywords: ['properties', 'inspector', 'specification', 'edit', 'panel'], enabled: inProject, run: () => ws?.toggleProps() });
commands.add({ id: 'view.sidebar', title: 'Show or hide the sidebar', group: 'View', keys: 'Mod+B', keywords: ['model browser', 'tree', 'panel', 'focus', 'space'], enabled: inProject, run: () => settings.update((s) => { s.sidebar = !s.sidebar; }) });
commands.add({ id: 'view.density', title: 'Switch compact view on or off', group: 'View', keywords: ['compact', 'dense', 'density', 'small', 'space'], run: () => settings.update((s) => { s.density = s.density === 'compact' ? 'comfortable' : 'compact'; }) });
commands.add({ id: 'project.settings', title: 'Project settings…', group: 'Project', keywords: ['project', 'properties', 'name', 'files', 'integrations', 'works'], enabled: inProject, run: () => ws?.projectSettings() });
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
commands.add({ id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', keywords: ['keys', 'hotkeys', 'remap', 'change', 'customize'], run: () => openPreferences({ settings, commands }, 'keys') });
commands.add({ id: 'prefs.open', title: 'Preferences…', group: 'General', keys: 'Mod+,', keywords: ['settings', 'options', 'customize', 'theme', 'accent', 'contrast', 'shortcuts', 'presets'], run: () => openPreferences({ settings, commands }, 'look') });
commands.add({ id: 'prefs.presets', title: 'Manage view presets…', group: 'View', keywords: ['preset', 'view options', 'compartments', 'default'], run: () => openPreferences({ settings, commands }, 'presets') });
commands.add({ id: 'view.contrast', title: 'Switch high contrast on or off', group: 'View', keywords: ['accessibility', 'contrast', 'low vision', 'projector'], run: () => settings.update((s) => { s.contrast = s.contrast === 'high' ? 'normal' : 'high'; }) });
commands.add({ id: 'view.grid', title: 'Show or hide the grid on diagrams', group: 'View', keywords: ['dots', 'background'], run: () => settings.update((s) => { s.grid = !s.grid; }) });

// ---------- validation ----------
commands.add({ id: 'view.problems', title: 'Show or hide the problems panel', group: 'Validation', keys: 'Mod+Shift+M', keywords: ['validation', 'errors', 'warnings', 'check', 'lint', 'rules'], enabled: inProject, run: () => settings.update((s) => { s.problems = !s.problems; }) });
commands.add({ id: 'problems.next', title: 'Go to the next problem', group: 'Validation', keys: 'F8', keywords: ['error', 'warning'], enabled: inProject, run: () => ws?.stepProblem(1) });
commands.add({ id: 'problems.prev', title: 'Go to the previous problem', group: 'Validation', keys: 'Shift+F8', keywords: ['error', 'warning'], enabled: inProject, run: () => ws?.stepProblem(-1) });
commands.add({ id: 'validation.rules', title: 'Validation rules and rule sets…', group: 'Validation', keywords: ['rules', 'rule set', 'strict', 'lint', 'custom rule', 'ignore'], enabled: inProject, run: () => ws?.openRules() });
commands.add({
  id: 'validation.run', title: 'Validate the model now', group: 'Validation', keywords: ['check', 'errors', 'lint'], enabled: inProject,
  run: async () => { if (!ws) return; const r = await ws.validator.now(); const c = r.counts; toast(c.error + c.warning + c.info ? `${c.error} errors, ${c.warning} warnings, ${c.info} notes (${Math.round(r.ms)} ms)` : `No problems (${Math.round(r.ms)} ms)`); },
});
commands.add({ id: 'model.newProfile', title: 'New profile (your own stereotypes)', group: 'Model', keywords: ['stereotype', 'profile', 'custom kind', 'tagged value', 'metadata'], enabled: inProject, run: () => ws?.newProfile() });
commands.add({ id: 'help.library', title: 'Open the SysML library (help on the selection)', group: 'Help', keys: '?', keywords: ['reference', 'help', 'docs', 'what is', 'sysml', 'mbse'], enabled: inProject, run: () => ws?.openLibrary() });

// ---------- exchange ----------
commands.add({ id: 'interop.importReqs', title: 'Import requirements (ReqIF, Excel, CSV)…', group: 'Exchange', keywords: ['reqif', 'doors', 'polarion', 'jama', 'excel', 'xlsx', 'csv', 'spreadsheet', 'supplier'], enabled: inProject, run: () => ws?.importRequirements() });
commands.add({ id: 'interop.exportReqs', title: 'Export requirements (ReqIF, Excel, CSV)…', group: 'Exchange', keywords: ['reqif', 'doors', 'polarion', 'excel', 'xlsx', 'csv', 'spreadsheet', 'supplier'], enabled: inProject, run: () => ws?.exportRequirements() });
commands.add({ id: 'doc.generate', title: 'Generate a document (HTML or PDF)…', group: 'Exchange', keywords: ['report', 'specification', 'pdf', 'print', 'word', 'export', 'document'], enabled: inProject, run: () => ws?.generateDocument() });
commands.add({ id: 'api.send', title: 'Send this project to a SysML v2 API server…', group: 'Exchange', keywords: ['sysml v2', 'api', 'server', 'repository', 'push', 'omg'], enabled: inProject, run: () => ws?.sendToApi() });
commands.add({ id: 'api.open', title: 'Open a project from a SysML v2 API server…', group: 'Exchange', keywords: ['sysml v2', 'api', 'server', 'repository', 'pull', 'omg'], run: async () => { if (ws) { location.hash = '#/'; await settle(); } home?.openFromServer(); } });
commands.add({ id: 'interop.exportModel', title: 'Export to Cameo / MagicDraw (SysML 1.6 XMI)…', group: 'Exchange', keywords: ['cameo', 'magicdraw', 'xmi', 'sysml 1', 'uml', 'export', 'download'], enabled: inProject, run: () => ws?.exportModelXmi() });
commands.add({ id: 'interop.importModel', title: 'Import a Cameo / MagicDraw model (.mdzip, .xmi)…', group: 'Exchange', keywords: ['cameo', 'magicdraw', 'xmi', 'mdzip', 'sysml 1', 'uml', 'capella'], run: async () => { if (ws) { location.hash = '#/'; await settle(); } home?.importFile(); } });

// ---------- projects ----------
commands.add({ id: 'app.install', title: 'Install Loom as an app (works offline)', group: 'General', keywords: ['pwa', 'desktop', 'offline', 'install', 'app', 'window'], enabled: canInstall, run: async () => { if (await install()) toast('Installing Loom…'); } });
commands.add({ id: 'project.new', title: 'New project…', group: 'Project', keywords: ['create'], run: async () => { if (ws) { location.hash = '#/'; await settle(); } home?.newProject(); } });
commands.add({ id: 'project.import', title: 'Import a project file (.loom.json or .zip)…', group: 'Project', keywords: ['open', 'load', 'file', 'zip'], run: async () => { if (ws) { location.hash = '#/'; await settle(); } home?.importFile(); } });
commands.add({ id: 'project.openFolder', title: 'Open a project folder…', group: 'Project', keywords: ['open', 'folder', 'directory', 'git', 'sysml'], enabled: canUseFolders, run: async () => { if (ws) { location.hash = '#/'; await settle(); } home?.openFolder(); } });
commands.add({
  id: 'project.exportZip', title: 'Export this project as a .zip (SysML text)', group: 'Project', keywords: ['zip', 'download', 'sysml', 'text', 'git'], enabled: inProject,
  run: async () => { if (!ws) return; await ws.flush(); const f = await projects.exportZip(ws.meta().id); download(f.filename, /** @type {any} */ (f.bytes), 'application/zip'); toast(`Exported ${f.filename}`); },
});
commands.add({ id: 'project.folder.link', title: 'Save this project to a folder…', group: 'Project', keywords: ['folder', 'directory', 'git', 'sysml', 'disk', 'link'], enabled: () => inProject() && canUseFolders(), run: () => ws?.linkFolder() });
commands.add({ id: 'project.folder.sync', title: 'Save to the linked folder now', group: 'Project', keywords: ['folder', 'sync', 'write'], enabled: () => !!ws?.linked(), run: () => ws?.syncFolder() });
commands.add({ id: 'project.folder.load', title: 'Load changes from the linked folder', group: 'Project', keywords: ['folder', 'git pull', 'reload', 'read'], enabled: () => !!ws?.linked(), run: () => ws?.loadFromFolder() });
commands.add({ id: 'project.folder.unlink', title: 'Stop saving to the linked folder', group: 'Project', keywords: ['folder', 'unlink', 'disconnect'], enabled: () => !!ws?.linked(), run: () => ws?.unlinkFolder() });
commands.add({ id: 'view.text', title: 'Show or hide the SysML v2 text', group: 'View', keys: 'Mod+E', keywords: ['text', 'sysml v2', 'code', 'textual notation', 'source'], enabled: inProject, run: () => settings.update((s) => { s.textPane = !s.textPane; }) });
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
commands.add({ id: 'edit.replace', title: 'Find and replace…', group: 'Edit', keys: 'Mod+Shift+F', keywords: ['search', 'replace', 'rename', 'substitute', 'find', 'text', 'regex'], enabled: inProject, run: () => ws?.findReplace() });
commands.add({ id: 'edit.bulk', title: 'Set a property on many elements (bulk edit)…', group: 'Edit', keywords: ['bulk', 'batch', 'many', 'multiple', 'priority', 'status', 'set all', 'mass edit'], enabled: inProject, run: () => ws?.bulkEdit() });
commands.add({ id: 'element.rename', title: 'Rename the selected element', group: 'Edit', keys: 'F2', enabled: () => !!ws?.canRenameSelection(), run: () => ws?.rename() });
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
commands.add({ id: 'diagram.new.req', group: 'Diagram', get title() { return `New ${kindName('req', notation())}`; }, keywords: ['req', 'requirements', 'satisfy', 'verify', 'derive', 'create'], enabled: () => !!ws?.canNew('req'), run: () => ws?.newDiagram('req') });
commands.add({ id: 'view.table.new', group: 'Views', get title() { return `New ${kindName('table', notation())}`; }, keywords: ['table', 'grid', 'spreadsheet', 'requirements', 'create'], enabled: () => !!ws?.canNew('table'), run: () => ws?.newDiagram('table') });
commands.add({ id: 'view.gtable.new', group: 'Views', get title() { return `New ${kindName('gtable', notation())} (any kinds of element, columns you choose)`; }, keywords: ['generic table', 'table', 'grid', 'spreadsheet', 'blocks', 'parts', 'ports', 'columns', 'create', 'instance'], enabled: () => !!ws?.canNew('gtable'), run: () => ws?.newDiagram('gtable') });
commands.add({ id: 'view.matrix.new', group: 'Views', get title() { return `New ${kindName('matrix', notation())}`; }, keywords: ['matrix', 'dependency', 'grid', 'allocation', 'satisfy', 'create'], enabled: () => !!ws?.canNew('matrix'), run: () => ws?.newDiagram('matrix') });
commands.add({ id: 'view.icd', title: 'Open the interfaces (ICD table and N² chart)', group: 'Views', keywords: ['icd', 'interface control document', 'n2', 'n squared', 'n²', 'connectors', 'ports', 'item flows', 'interfaces'], enabled: inProject, run: () => { const s = ws?.selected() ? ws.model.get(/** @type {string} */ (ws.selected())) : undefined; ws?.openIcd(s?.kind === 'partDef' ? s.id : undefined); } });
commands.add({ id: 'view.home', title: 'Open the Systems V', group: 'Views', keywords: ['vee', 'home', 'progress', 'lifecycle', 'verification'], enabled: inProject, run: () => ws?.openDiagram('v:home') });
commands.add({ id: 'view.trace', title: 'Open the RFLP trace', group: 'Views', keywords: ['traceability', 'coverage', 'thread', 'gaps', 'lanes'], enabled: inProject, run: () => ws?.openDiagram('v:trace') });
commands.add({ id: 'view.table', title: 'Open the requirements table', group: 'Views', keywords: ['requirements', 'list', 'grid', 'csv', 'excel'], enabled: inProject, run: () => ws?.openOrCreate('table') });
commands.add({ id: 'view.matrix', title: 'Open the satisfy matrix', group: 'Views', keywords: ['matrix', 'dependency', 'satisfy', 'coverage'], enabled: inProject, run: () => ws?.openOrCreate('matrix') });
for (const [k, words] of /** @type {[string, string[]][]} */ ([['act', ['activity', 'flow', 'swimlane', 'behavior']], ['stm', ['state machine', 'states', 'transitions', 'behavior']], ['sd', ['sequence', 'messages', 'scenario', 'interaction']], ['uc', ['use case', 'actors', 'goals']], ['pkg', ['package', 'organization', 'imports']], ['par', ['parametric', 'equations', 'constraints', 'solver', 'analysis']]])) {
  commands.add({ id: `diagram.new.${k}`, group: 'Diagram', get title() { return `New ${kindName(k, notation())}`; }, keywords: [...words, 'create'], enabled: () => inProject() && (k === 'sd' || !!ws?.canNew(k)), run: () => ws?.newDiagram(k) });
}
const inDiagram = () => !!ws?.activeView();
commands.add({ id: 'diagram.run', title: 'Run the diagram (activity, state machine or sequence)', group: 'Diagram', keywords: ['simulate', 'simulation', 'play', 'execute', 'tokens', 'check', 'verify'], enabled: () => !!ws?.runnable(), run: () => ws?.runnable()?.toggleRun() });
commands.add({ id: 'diagram.fit', title: 'Fit the diagram to the window', group: 'Diagram', keywords: ['zoom', 'all'], enabled: inDiagram, run: () => ws?.activeView()?.fit() });
commands.add({ id: 'diagram.zoomIn', title: 'Zoom in', group: 'Diagram', enabled: inDiagram, run: () => ws?.activeView()?.zoomIn() });
commands.add({ id: 'diagram.zoomOut', title: 'Zoom out', group: 'Diagram', enabled: inDiagram, run: () => ws?.activeView()?.zoomOut() });
commands.add({ id: 'diagram.tidy', title: 'Tidy the diagram layout', group: 'Diagram', keywords: ['auto layout', 'arrange'], enabled: inDiagram, run: () => ws?.activeView()?.tidy() });
commands.add({ id: 'diagram.related', title: 'Add related blocks to the diagram', group: 'Diagram', keywords: ['parts', 'types', 'generalization', 'show'], enabled: inDiagram, run: () => ws?.activeView()?.addRelated() });
commands.add({ id: 'nav.back', title: 'Go back to the previous view', group: 'View', keys: 'Mod+[', keywords: ['history', 'previous', 'back', 'navigate'], enabled: () => !!ws?.canNavigate(-1), run: () => ws?.navigate(-1) });
commands.add({ id: 'nav.forward', title: 'Go forward', group: 'View', keys: 'Mod+]', keywords: ['history', 'next', 'forward', 'navigate'], enabled: () => !!ws?.canNavigate(1), run: () => ws?.navigate(1) });
commands.add({ id: 'diagram.image', title: 'Copy or download the diagram as a picture (PNG, SVG)…', group: 'Diagram', keywords: ['image', 'picture', 'png', 'svg', 'export', 'screenshot', 'slides', 'clipboard'], enabled: () => !!ws?.canImage(), run: () => ws?.diagramImage() });
commands.add({ id: 'diagram.copyImage', title: 'Copy the diagram as a picture', group: 'Diagram', keys: 'Mod+Alt+C', keywords: ['image', 'picture', 'png', 'clipboard', 'paste', 'slides'], enabled: () => !!ws?.canImage(), run: () => ws?.diagramImage({ quick: true }) });
for (const a of ARRANGE) {
  commands.add({ id: `arrange.${a.id}`, title: a.label, group: 'Arrange', keywords: ['align', 'arrange', 'distribute', 'tidy', a.group, 'layout'], enabled: () => (ws?.activeView()?.selection().length || 0) >= a.min && !!ws?.activeView()?.arrange, run: () => ws?.activeView()?.arrange?.(a.id) });
}
commands.add({ id: 'format.copy', title: 'Copy the selected box\'s look (format painter)', group: 'Diagram', keys: 'Alt+Shift+C', keywords: ['format painter', 'style', 'color', 'fill', 'size', 'copy'], enabled: () => !!ws?.activeView()?.copyLook && ws?.activeView()?.selection().length === 1, run: () => ws?.activeView()?.copyLook?.() });
commands.add({ id: 'format.paste', title: 'Paste a copied look onto the selected boxes', group: 'Diagram', keys: 'Alt+Shift+V', keywords: ['format painter', 'style', 'color', 'fill', 'size', 'paste'], enabled: () => !!ws?.activeView()?.pasteLook && !!ws?.activeView()?.selection().length, run: () => ws?.activeView()?.pasteLook?.() });
commands.add({ id: 'diagram.fromSelection', title: 'New diagram from the rows selected in the model browser', group: 'Diagram', keywords: ['selection', 'create', 'show', 'diagram of these', 'bdd', 'requirements'], enabled: () => (ws?.browserSelection().length || 0) > 0, run: () => { const ids = ws?.browserSelection() || []; if (ids.length) ws?.diagramFrom(ids); } });
commands.add({ id: 'diagram.quickAdd', title: 'Add to the diagram by typing (or just start typing on it)', group: 'Diagram', keywords: ['quick add', 'type', 'create', 'new block', 'part', 'fast'], enabled: () => !!ws?.activeView()?.openQuick, run: () => ws?.activeView()?.openQuick?.() });
commands.add({ id: 'diagram.remove', title: 'Remove the selection from the diagram (keep in model)', group: 'Diagram', keywords: ['hide'], enabled: () => !!ws?.activeView()?.selection().length, run: () => ws?.activeView()?.removeFromView() });

/** Model elements as palette items, so typing a name jumps to it. @returns {import('./commands.js').Command[]} */
function elementItems() {
  return (ws?.searchItems() || []).map((e) => ({ id: `goto:${e.id}`, title: e.name, group: e.kind, run: () => ws?.select(e.id) }));
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
      ws = mountWorkspace(app, { meta, model, settings, commands, projects, save: (mm) => projects.save(meta.id, mm) });
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
// the installed app's "New project" shortcut opens #new
const startNew = location.hash === '#new';
if (startNew) history.replaceState(null, '', '#/');
route().then(() => { if (startNew) home?.newProject(); });

// offline and installed: files opened with the installed app become projects
startPwa({
  notify: (text) => toast(text),
  openFiles: async (files) => { if (ws) { location.hash = '#/'; await settle(); } await routing; home?.openFiles(files); },
});
