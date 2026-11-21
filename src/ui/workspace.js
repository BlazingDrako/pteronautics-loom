// The project workspace: model browser, tabs (the model overview and open diagrams),
// inspector, status bar.
import { h, icon, brandMark, formatKeys, toast } from './dom.js';
import { createTree } from './tree.js';
import { createInspector } from './inspector.js';
import { popupMenu } from './menu.js';
import { LAYERS, ELEMENTS, kindName, isRel, childKinds, isDiagram, DIAGRAM_KINDS } from '../model/metamodel.js';
import { createDiagramView } from '../canvas/view.js';
import { populate, startingBlocks } from '../canvas/populate.js';
import { createIbdView } from '../canvas/ibdview.js';
import { packIbd } from '../canvas/ibd.js';
import { ModelError } from '../model/model.js';
import { createTableView } from '../views/table.js';
import { createMatrixView } from '../views/matrix.js';
import { createTraceView } from '../views/trace.js';
import { createVHomeView } from '../views/vhome.js';
import { nextReqId } from '../model/trace.js';
import { populateReq } from '../canvas/populate.js';
import { createTextPane } from './textpane.js';
import { createSequenceView } from '../canvas/sdview.js';
import { populateAct } from '../canvas/act.js';
import { populateStm } from '../canvas/stm.js';
import { populateUc, populatePkg } from '../canvas/uc.js';
import { modal, confirm } from './dialog.js';
import { snapshot } from '../model/serialize.js';
import { applySnapshot } from '../text/build.js';
import { projectFiles, signature, snapshotFromFiles, pick, FileError, PROJECT_FILE } from '../storage/folder.js';
import { canUseFolders, pickFolder, hasAccess, readFolder, writeFolder } from '../storage/folderfs.js';
import { LAYER_FILES } from '../text/printer.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../storage/projects.js').ProjectMeta} ProjectMeta */

/** Views listed in the sidebar; `ready: false` shows a "soon" tag. */
const VIEWS = [
  { id: 'v:home', name: 'Systems V', icon: 'vee', ready: true },
  { id: 'v:trace', name: 'RFLP trace', icon: 'trace', ready: true },
  { id: 'overview', name: 'Model overview', icon: 'grid', ready: true },
  { id: 'diagrams', name: 'Diagrams', icon: 'diagram', ready: true },
  { id: 'tables', name: 'Tables & matrices', icon: 'table', ready: true },
  { id: 'library', name: 'SysML library', icon: 'book', ready: false },
];
/** Project views that are not model elements. */
const PROJECT_VIEWS = /** @type {Record<string, { name: string, icon: string }>} */ ({ 'v:home': { name: 'Systems V', icon: 'vee' }, 'v:trace': { name: 'RFLP trace', icon: 'trace' } });
/** Tabs for kinds of view. */
const KIND_ICON = /** @type {Record<string, string>} */ ({ table: 'table', matrix: 'matrix', req: 'req', act: 'trace', stm: 'diagram', sd: 'list', uc: 'diagram', pkg: 'folder' });
/** What a diagram must be made inside, when nothing suitable is selected. */
const DIAGRAM_NEEDS = /** @type {Record<string, string>} */ ({
  act: 'Select a function first: an activity diagram shows what that function does',
  stm: 'Select a block first: a state machine shows that block\'s states',
  ibd: 'Select a block first: an internal block diagram shows its inside',
});
/** Kinds the "Tables & matrices" menu lists. */
const GRID_KINDS = ['table', 'matrix'];

/**
 * @param {HTMLElement} root
 * @param {{
 *   meta: ProjectMeta, model: Model,
 *   settings: import('../settings.js').SettingsStore,
 *   commands: import('../commands.js').CommandRegistry,
 *   save: (m: Model) => Promise<ProjectMeta>,
 *   projects: import('../storage/projects.js').ProjectStore,
 * }} ctx
 */
export function mountWorkspace(root, ctx) {
  const { model, settings, commands } = ctx;
  let meta = ctx.meta;
  /** @type {string | null} */
  let selected = null;
  const expanded = new Set(model.layers().map((l) => l.id));
  /** @type {'saved' | 'saving' | 'error'} */
  let saveState = 'saved';
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saveTimer;
  let pending = false;

  const notation = () => settings.get().notation;
  /** Open tabs after the overview, in order: views ('v:…') and diagram ids. @type {string[]} */
  const tabs = ['v:home'];
  /** 'overview', a project view ('v:…') or a diagram id. */
  let active = 'v:home';
  /** @type {Map<string, any>} */
  const views = new Map();
  /** The open view, if any. */
  const currentView = () => (active === 'overview' ? null : views.get(active) || null);
  /** The open diagram canvas, if the open view is one (diagram commands act on it). */
  const activeView = () => { const v = currentView(); return v && v.canvas ? /** @type {import('../canvas/view.js').DiagramView} */ (v) : null; };
  const isView = (/** @type {string} */ id) => id in PROJECT_VIEWS;

  /** Run an edit; show model errors as a message instead of throwing. @param {string} label @param {(tx: any) => void} fn */
  function edit(label, fn) {
    try { model.transact(label, fn); return true; }
    catch (e) { if (e instanceof ModelError) { toast(e.message, true); return false; } throw e; }
  }

  /** @param {string | null} id */
  function select(id) {
    if (id && !model.get(id)) id = null;
    if (id === selected) return;
    selected = id;
    tree.render(); inspector.render(); paintStage();
    currentView()?.syncSelection(id);
    pane?.syncSelection(id);
  }

  const tree = createTree({
    model, notation, expanded,
    selected: () => selected,
    select,
    create: (kind, owner) => create(kind, owner),
    rename: (id, name) => { edit('Rename', (tx) => tx.rename(id, name)); },
    move: (id, owner) => edit('Move', (tx) => tx.move(id, owner)),
    remove: (id) => removeEl(id),
    open: (id) => openDiagram(id),
  });
  const inspector = createInspector({ model, settings, commands, selected: () => selected, select, edit, meta: () => meta, open: (id) => openDiagram(id) });

  // ---------- diagrams ----------
  /** Open a diagram, table or matrix, or a project view ('v:home', 'v:trace'). @param {string} id */
  function openDiagram(id) {
    if (!isView(id)) {
      const d = model.get(id);
      if (!d || !isDiagram(d.kind)) return;
    }
    if (!tabs.includes(id)) tabs.push(id);
    active = id;
    paintMain();
    currentView()?.syncSelection(selected);
    // with nothing selected, the text shows what the diagram is about (an ibd's block, say)
    pane?.syncSelection(selected || (isView(id) ? null : model.get(id)?.kind === 'ibd' ? model.get(id)?.owner || id : id));
    currentView()?.focus();
  }
  /** Open the first view of a kind, or make one in the Requirements layer. @param {string} kind */
  function openOrCreate(kind) {
    const have = model.byKind(kind);
    const pick = kind === 'matrix' ? have.find((x) => x.props.rel === 'satisfy') || have[0] : have[0];
    if (pick) openDiagram(pick.id); else newDiagram(kind, model.layers().find((l) => l.layer === 'r')?.id);
  }
  /** @param {string} id */
  function closeTab(id) {
    const i = tabs.indexOf(id);
    if (i < 0) return;
    tabs.splice(i, 1);
    views.get(id)?.dispose(); views.delete(id);
    if (active === id) active = tabs[Math.min(i, tabs.length - 1)] || 'overview';
    paintMain();
  }
  /** Props a new element starts with: requirements get the next ID for their package. @param {string} kind @param {string} owner */
  const newProps = (kind, owner) => (kind === 'requirement' ? { reqId: nextReqId(model, owner) } : undefined);
  /** @param {string} id */
  function viewFor(id) {
    let v = views.get(id);
    if (!v) {
      const base = { model, diagramId: id, notation, selected: () => selected, select, edit, newProps };
      const kind = model.get(id)?.kind;
      if (id === 'v:home') v = createVHomeView({ ...base, create: (k, owner, props) => create(k, owner, props), openTrace: () => openDiagram('v:trace'), openTable: () => openOrCreate('table'), openMatrix: () => openOrCreate('matrix') });
      else if (id === 'v:trace') v = createTraceView(base);
      else if (kind === 'table') v = createTableView(base);
      else if (kind === 'matrix') v = createMatrixView(base);
      else if (kind === 'ibd') v = Object.assign(createIbdView(base), { canvas: true });
      else if (kind === 'sd') v = createSequenceView(base);
      else v = Object.assign(createDiagramView(base), { canvas: true });
      views.set(id, v);
    }
    return v;
  }
  /** Create a diagram in a package (default: the selected one, or the Logical layer), filled with the blocks there. @param {string} kind @param {string | null} [where] */
  function newDiagram(kind, where) {
    let owner = where || ownerFor(kind);
    // a sequence diagram shows an interaction: make one when none is selected
    if (!owner && kind === 'sd') owner = ownerFor('interaction');
    if (!owner) { toast(DIAGRAM_NEEDS[kind] || `Select where the ${kindName(kind, notation()).toLowerCase()} should go`, true); return; }
    const o = /** @type {import('../model/model.js').Element} */ (model.get(owner));
    let id = '';
    const names = /** @type {Record<string, string>} */ ({ req: `${o.name} requirements`, table: `${o.name} table`, matrix: 'Satisfy matrix', act: `${o.name} flow`, stm: `${o.name} states`, uc: `${o.name} use cases`, pkg: `${o.name} organization` });
    if (!edit(`New ${kindName(kind, 'sysml').toLowerCase()}`, (tx) => {
      if (kind === 'sd') {
        const inter = o.kind === 'interaction' ? owner : tx.create('interaction', { owner, name: 'Scenario' });
        id = tx.create('sd', { owner: /** @type {string} */ (inter), name: `${model.get(/** @type {string} */ (inter))?.name || 'Scenario'} sequence` });
        return;
      }
      if (kind === 'act' || kind === 'stm' || kind === 'uc' || kind === 'pkg') {
        id = tx.create(kind, { owner, name: names[kind] });
        ({ act: populateAct, stm: populateStm, uc: populateUc, pkg: populatePkg })[kind](model, tx, id, notation());
        return;
      }
      if (kind === 'ibd') {
        id = tx.create(kind, { owner, name: `${o.name} internals` });
        tx.place(id, packIbd(model, owner, { notation: notation() }));
      } else if (kind === 'req') {
        id = tx.create(kind, { owner, name: names.req });
        populateReq(model, tx, id, notation());
      } else if (kind === 'table' || kind === 'matrix') {
        id = tx.create(kind, { owner, name: names[kind] });
      } else {
        id = tx.create(kind, { owner, name: `${o.name} structure` });
        populate(model, tx, id, startingBlocks(model, owner), notation());
      }
    })) return;
    expanded.add(owner);
    selected = id;
    tree.render(); inspector.render();
    openDiagram(id);
  }
  /** @param {HTMLElement} anchor */
  function diagramsMenu(anchor) {
    const all = DIAGRAM_KINDS.filter((k) => !GRID_KINDS.includes(k)).flatMap((k) => model.byKind(k)).sort((a, b) => a.name.localeCompare(b.name));
    popupMenu(anchor, [
      ...all.map((d) => ({ label: d.name, hint: ELEMENTS[d.kind].abbr, run: () => openDiagram(d.id) })),
      ...(all.length ? /** @type {const} */ (['sep']) : []),
      { label: `New ${kindName('bdd', notation())}`, hint: '+', run: () => newDiagram('bdd') },
      { label: `New ${kindName('ibd', notation())}${ownerFor('ibd') ? '' : ' (select a block first)'}`, hint: '+', disabled: !ownerFor('ibd'), run: () => newDiagram('ibd') },
      { label: `New ${kindName('req', notation())}`, hint: '+', run: () => newDiagram('req') },
      { label: `New ${kindName('act', notation())}${ownerFor('act') ? '' : ' (select a function first)'}`, hint: '+', disabled: !ownerFor('act'), run: () => newDiagram('act') },
      { label: `New ${kindName('stm', notation())}${ownerFor('stm') ? '' : ' (select a block first)'}`, hint: '+', disabled: !ownerFor('stm'), run: () => newDiagram('stm') },
      { label: `New ${kindName('sd', notation())}`, hint: '+', run: () => newDiagram('sd') },
      { label: `New ${kindName('uc', notation())}`, hint: '+', run: () => newDiagram('uc') },
      { label: `New ${kindName('pkg', notation())}`, hint: '+', run: () => newDiagram('pkg') },
    ], { title: all.length ? 'Open a diagram' : 'No diagrams yet' });
  }
  /** @param {HTMLElement} anchor */
  function gridsMenu(anchor) {
    const all = GRID_KINDS.flatMap((k) => model.byKind(k)).sort((a, b) => a.name.localeCompare(b.name));
    popupMenu(anchor, [
      ...all.map((d) => ({ label: d.name, hint: ELEMENTS[d.kind].abbr, run: () => openDiagram(d.id) })),
      ...(all.length ? /** @type {const} */ (['sep']) : []),
      { label: `New ${kindName('table', notation())}`, hint: '+', run: () => newDiagram('table') },
      { label: `New ${kindName('matrix', notation())}`, hint: '+', run: () => newDiagram('matrix') },
    ], { title: all.length ? 'Open a table or matrix' : 'No tables or matrices yet' });
  }

  /** Create an element and start renaming it. @param {string} kind @param {string} owner @param {Record<string, any>} [props] */
  function create(kind, owner, props) {
    if (isDiagram(kind)) { newDiagram(kind, owner); return; }
    /** @type {string} */
    let id = '';
    if (!edit(`New ${kindName(kind, 'sysml').toLowerCase()}`, (tx) => { id = tx.create(kind, { owner, props: { ...newProps(kind, owner), ...props } }); })) return;
    expanded.add(owner);
    selected = id;
    tree.render(); inspector.render(); paintStage();
    tree.startRename(id);
  }

  /** @param {string} id */
  function removeEl(id) {
    const e = model.get(id);
    if (!e || e.layer || !e.owner) return;
    const owner = e.owner;
    const sibs = model.children(owner).map((c) => c.id);
    const next = sibs[sibs.indexOf(id) + 1] || sibs[sibs.indexOf(id) - 1] || owner;
    if (edit(`Delete ${e.name}`, (tx) => tx.remove(id))) {
      selected = model.get(next) ? next : null;
      tree.render(); inspector.render(); paintStage();
      tree.focus();
      toast(`Deleted ${e.name}. ${formatKeys('Mod+Z')} to undo.`);
    }
  }

  /**
   * Where a new element of `kind` goes: inside the selection if it can hold it, else the
   * nearest ancestor that can, else the kind's default layer.
   * @param {string} kind
   */
  function ownerFor(kind) {
    if (selected) {
      const chain = [selected, ...model.path(selected).reverse().map((p) => p.id)];
      for (const id of chain) if (model.canCreate(id, kind)) return id;
    }
    const layer = ELEMENTS[kind].defaultLayer || 'l';
    const pkg = model.layers().find((l) => l.layer === layer);
    return pkg && model.canCreate(pkg.id, kind) ? pkg.id : null;
  }

  // ---------- autosave ----------
  async function flush() {
    if (!pending) return;
    pending = false; saveState = 'saving'; paintStatus();
    try { meta = await ctx.save(model); saveState = 'saved'; }
    catch (e) { saveState = 'error'; toast(`Could not save: ${e instanceof Error ? e.message : e}`, true); }
    paintStatus(); paintTop();
    if (saveState === 'saved' && meta.folder) await syncFolder(false);
  }

  // ---------- folder on disk ----------
  /** @type {'none' | 'synced' | 'saving' | 'locked' | 'conflict' | 'error' | 'missing'} */
  let folderState = meta.folder ? 'synced' : 'none';
  /** The files Loom writes for the model now. */
  const ourFiles = () => projectFiles(model, meta);
  /** Only Loom's files from what is on disk. @param {Record<string, string>} disk */
  const ours = (disk) => pick(disk, [...new Set([...Object.keys(ourFiles()), ...Object.values(LAYER_FILES)])]);
  let syncing = false;
  /**
   * Write the model to the linked folder. When the folder changed outside Loom since the last
   * sync, ask which version wins instead of overwriting. `ask`: may ask for access (a click).
   * @param {boolean} ask
   */
  async function syncFolder(ask) {
    if (!meta.folder || syncing) return;
    syncing = true;
    try {
      const dir = await ctx.projects.folderHandle(meta.id);
      if (!dir) { folderState = 'missing'; return; }
      if (!(await hasAccess(dir, ask))) { folderState = 'locked'; return; }
      folderState = 'saving'; paintStatus();
      const files = ourFiles(), sig = signature(files);
      const disk = ours(await readFolder(dir)), diskSig = signature(disk);
      if (diskSig !== meta.folder.sig && diskSig !== sig && Object.keys(disk).length) { folderState = 'conflict'; paintStatus(); syncing = false; await resolveConflict(); return; }
      if (diskSig !== sig) await writeFolder(dir, files);
      meta = await ctx.projects.synced(meta.id, sig);
      folderState = 'synced';
    } catch (e) {
      folderState = 'error';
      toast(`Could not save to the folder: ${e instanceof Error ? e.message : e}`, true);
    } finally { syncing = false; paintStatus(); }
  }
  /** The folder changed outside Loom (a git pull, another editor): ask which version to keep. */
  async function resolveConflict() {
    const choice = await modal({
      title: `“${meta.folder?.name}” changed outside Loom`, ok: 'Load the folder\'s version',
      build: (close) => ({
        body: h('div', {},
          h('p', { class: 'dialog-text' }, 'The files in the folder were changed since Loom last saved them, for example by git or another editor.'),
          h('p', { class: 'dialog-text' }, 'Load the folder\'s version into Loom (one step you can undo), or keep Loom\'s version and overwrite the folder\'s files.'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => close('keep') }, 'Keep Loom\'s version and overwrite the folder')),
        value: () => 'load',
      }),
    });
    if (choice === 'load') await loadFromFolder();
    else if (choice === 'keep') { if (meta.folder) meta = await ctx.projects.synced(meta.id, '(overwrite)'); folderState = 'synced'; await syncFolder(true); }
    else paintStatus();
  }
  /** Bring the folder's files into the model, as one undoable edit. */
  async function loadFromFolder() {
    const dir = meta.folder ? await ctx.projects.folderHandle(meta.id) : null;
    if (!dir || !(await hasAccess(dir, true))) { toast('Loom cannot read the folder. Allow access and try again.', true); return; }
    const disk = ours(await readFolder(dir));
    try {
      const snap = snapshotFromFiles(model, disk);
      const s = applySnapshot(model, snap, 'Load from folder');
      meta = await ctx.projects.synced(meta.id, signature(disk));
      folderState = 'synced';
      toast(s.created + s.removed + s.changed ? `Loaded from the folder: ${s.created} added, ${s.removed} removed, ${s.changed} changed. ${formatKeys('Mod+Z')} to undo.` : 'The folder matches the model');
    } catch (e) {
      folderState = 'error';
      toast(e instanceof FileError || e instanceof ModelError ? `The folder has a problem: ${e.message}` : `Could not load the folder: ${e instanceof Error ? e.message : e}`, true);
    }
    paintStatus();
  }
  /** Link this project to a folder (choosing one) and save into it. */
  async function linkFolder() {
    if (!canUseFolders()) { toast('This browser cannot save to folders. Use Export .zip instead (Chrome, Edge and Arc can).', true); return; }
    const dir = await pickFolder();
    if (!dir) return;
    const disk = await readFolder(dir);
    const foreign = PROJECT_FILE in disk || Object.values(LAYER_FILES).some((f) => f in disk);
    if (foreign && !(await confirm({ title: `Replace the project in “${dir.name}”?`, body: 'That folder already holds a Loom project. Saving this project there replaces its .sysml and .loom files. Other files in the folder are left alone.', ok: 'Replace its files', danger: true }))) return;
    const files = ourFiles();
    await writeFolder(dir, files);
    meta = await ctx.projects.link(meta.id, dir, dir.name, signature(files));
    folderState = 'synced';
    paintStatus(); inspector.render();
    toast(`Saved to “${dir.name}”. Loom now keeps it up to date as you work.`);
  }
  async function unlinkFolder() {
    if (!meta.folder) return;
    const name = meta.folder.name;
    meta = await ctx.projects.unlink(meta.id);
    folderState = 'none';
    paintStatus(); inspector.render();
    toast(`No longer saving to “${name}”. Its files stay as they are.`);
  }
  /** On opening: if the folder changed since the last sync, offer to load it. */
  async function checkFolderOnOpen() {
    if (!meta.folder) return;
    const dir = await ctx.projects.folderHandle(meta.id);
    if (!dir) { folderState = 'missing'; paintStatus(); return; }
    if (!(await hasAccess(dir, false))) { folderState = 'locked'; paintStatus(); return; }
    try {
      const disk = ours(await readFolder(dir));
      if (Object.keys(disk).length && signature(disk) !== meta.folder.sig) { folderState = 'conflict'; paintStatus(); await resolveConflict(); }
    } catch { folderState = 'error'; paintStatus(); }
  }
  /** The status bar's folder button. */
  function folderPill() {
    if (!meta.folder) return null;
    const n = meta.folder.name;
    /** @type {Record<string, [string, string, () => void]>} */
    const states = {
      synced: [`Folder: ${n}`, 'good', () => syncFolder(true)],
      saving: ['Saving to folder…', '', () => {}],
      locked: [`Allow access to ${n}`, 'warn', () => syncFolder(true)],
      conflict: [`${n} changed outside Loom`, 'warn', () => resolveConflict()],
      error: [`Folder problem: retry`, 'bad', () => syncFolder(true)],
      missing: [`Folder link lost`, 'bad', () => linkFolder()],
      none: ['', '', () => {}],
    };
    const [label, cls, run] = states[folderState];
    return h('button', { class: `pill folder-pill ${cls}`, type: 'button', title: folderState === 'synced' ? `Saved to the folder “${n}” as SysML text. Click to save now.` : label, onclick: run }, icon('folder'), h('span', {}, label));
  }
  const unsub = model.subscribe((ev) => {
    if (ev.cause === 'load') return;
    pending = true; saveState = 'saving';
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400);
    if (selected && !model.get(selected)) selected = null;
    for (const t of [...tabs]) if (!isView(t) && !model.get(t)) closeTab(t);
    tree.render(); inspector.render(); paintStage(); paintStatus(); paintTop(); paintTabs();
    currentView()?.invalidate();
    if (ev.cause !== 'do') toast(`${ev.cause === 'undo' ? 'Undid' : 'Redid'}: ${ev.label}`);
  });
  const unsubSettings = settings.subscribe(() => { paintPane(); tree.render(); inspector.render(); paintStage(); paintStatus(); shell.classList.toggle('no-insp', !settings.get().inspector); paintTop(); paintTabs(); currentView()?.invalidate(); });
  const onUnload = () => { if (pending) flush(); };
  addEventListener('beforeunload', onUnload);

  // ---------- layout ----------
  const shell = h('div', { class: 'shell' + (settings.get().inspector ? '' : ' no-insp') });
  const top = h('header', { class: 'topbar' });
  const stage = h('div', { class: 'stage', role: 'region', 'aria-label': 'Model overview' });
  const tabbar = h('div', { class: 'tabbar', role: 'tablist', 'aria-label': 'Open views' });
  const content = h('div', { class: 'content' });
  /** @type {ReturnType<typeof createTextPane> | null} */
  let pane = null;
  const workrow = h('div', { class: 'workrow' }, content);
  function paintPane() {
    const want = settings.get().textPane;
    if (want && !pane) {
      pane = createTextPane({
        model, selected: () => selected, select, toast,
        close: () => settings.update((st) => { st.textPane = false; }),
        width: () => settings.get().textWidth,
        setWidth: (w) => settings.update((st) => { st.textWidth = w; }),
      });
      workrow.append(pane.el);
      pane.syncSelection(selected);
    } else if (!want && pane) { pane.dispose(); pane.el.remove(); pane = null; }
  }
  const status = h('footer', { class: 'statusbar' });

  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Model' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'Pteronautics Loom home' }, brandMark(), h('div', {}, h('div', { class: 'brand-name' }, 'Pteronautics'), h('div', { class: 'brand-sub brand-product' }, 'Loom'))),
    h('div', { class: 'nav-group' }, 'Model'),
    tree.el,
    h('div', { class: 'nav-group' }, 'Views'),
    VIEWS.map((v) => h('button', {
      class: 'nav-item' + (v.ready ? '' : ' planned'), type: 'button', 'aria-disabled': v.ready ? undefined : 'true', 'aria-haspopup': v.id === 'diagrams' || v.id === 'tables' ? 'menu' : undefined,
      onclick: (/** @type {Event} */ e) => {
        if (v.id === 'overview') { active = 'overview'; paintMain(); }
        else if (v.id === 'diagrams') diagramsMenu(/** @type {HTMLElement} */ (e.currentTarget));
        else if (v.id === 'tables') gridsMenu(/** @type {HTMLElement} */ (e.currentTarget));
        else if (isView(v.id)) openDiagram(v.id);
      },
    }, icon(v.icon), h('span', { class: 'nav-label' }, v.name), v.ready ? null : h('span', { class: 'soon' }, 'soon'))),
    h('div', { class: 'sidebar-foot' },
      h('a', { class: 'nav-item', href: '#/' }, icon('home'), h('span', { class: 'nav-label' }, 'All projects')),
      h('button', { class: 'nav-item', type: 'button', onclick: () => commands.run('help.shortcuts') }, icon('keyboard'), h('span', { class: 'nav-label' }, 'Shortcuts'))));

  function paintTop() {
    top.replaceChildren(
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
        h('a', { href: '#/', class: 'crumb-link' }, 'Projects'), h('span', { class: 'sep' }, '›'), h('b', { class: 'crumb-current', title: model.root().name }, model.root().name)),
      h('div', { style: { flex: '1' } }),
      h('div', { class: 'undo-group' },
        h('button', { class: 'icon-btn', type: 'button', disabled: model.canUndo() ? undefined : true, 'aria-label': 'Undo', title: model.canUndo() ? `Undo ${model.undoLabel()} (${formatKeys('Mod+Z')})` : 'Nothing to undo', onclick: () => commands.run('edit.undo') }, icon('undo')),
        h('button', { class: 'icon-btn', type: 'button', disabled: model.canRedo() ? undefined : true, 'aria-label': 'Redo', title: model.canRedo() ? `Redo ${model.redoLabel()} (${formatKeys('Mod+Shift+Z')})` : 'Nothing to redo', onclick: () => commands.run('edit.redo') }, icon('redo'))),
      h('button', { class: 'palette-trigger', type: 'button', onclick: () => commands.run('palette.open'), 'aria-label': 'Search the model or run a command' },
        icon('search'), h('span', { class: 'pt-label' }, 'Search the model or run a command'), h('span', { class: 'kbd' }, formatKeys('Mod+K'))),
      h('button', { class: 'icon-btn' + (settings.get().inspector ? ' on' : ''), type: 'button', 'aria-label': 'Show or hide the inspector', 'aria-pressed': String(settings.get().inspector), title: `Inspector (${formatKeys('Mod+.')})`, onclick: () => commands.run('view.inspector') }, icon('panel')));
  }

  function paintStage() {
    const n = notation();
    const total = model.elementCount() - 5;
    const layerCards = model.layers().map((l) => {
      const info = /** @type {typeof LAYERS[number]} */ (LAYERS.find((x) => x.id === l.layer));
      const kids = model.children(l.id);
      let deep = 0; const walk = (/** @type {string} */ x) => { for (const c of model.children(x)) { deep++; walk(c.id); } }; walk(l.id);
      return h('section', { class: 'lcard', style: { '--lc': info.color } },
        h('div', { class: 'lcard-head' },
          h('span', { class: 'lcard-dot' }), h('h3', {}, info.name), h('span', { class: 'lcard-n mono' }, String(deep))),
        h('p', { class: 'lcard-note' }, info.note),
        kids.length
          ? h('ul', { class: 'lcard-list' }, kids.slice(0, 6).map((k) => h('li', {}, h('button', { type: 'button', class: 'lcard-item' + (selected === k.id ? ' sel' : ''), title: k.name, onclick: () => select(k.id) },
            h('span', { class: 'kbadge' }, ELEMENTS[k.kind].abbr), h('span', { class: 'lcard-name' }, k.name)))),
          kids.length > 6 ? h('li', { class: 'muted small' }, `and ${kids.length - 6} more`) : null)
          : h('p', { class: 'lcard-empty' }, 'Empty'),
        h('button', { class: 'btn sm lcard-add', type: 'button', 'aria-haspopup': 'menu',
          onclick: (/** @type {Event} */ ev) => popupMenu(/** @type {HTMLElement} */ (ev.currentTarget), childKinds(l.kind).map((k) => ({ label: kindName(k, n), hint: ELEMENTS[k].abbr, run: () => create(k, l.id) })), { title: `Add to ${info.name}` }) },
        icon('plus'), `Add to ${info.name.toLowerCase()}`));
    });
    stage.replaceChildren(h('div', { class: 'overview' },
      h('div', { class: 'overview-head' },
        h('div', {},
          h('div', { class: 'eyebrow' }, total ? 'Model overview' : 'New project'),
          h('h2', {}, total ? model.root().name : 'Start your model')),
        h('p', { class: 'overview-sub' }, total
          ? `${total} elements and ${model.count() - model.elementCount()} relationships across the four RFLP layers. Diagrams come next; for now, build the model in the model browser.`
          : n === 'guided'
            ? 'A Loom model has four layers. Start with what the system must do, then describe the parts that do it.'
            : 'Loom organizes a model in four RFLP layers, traced end to end from requirements to physical parts. Use the + buttons or the command palette to add elements.')),
      h('div', { class: 'lgrid' }, layerCards)));
  }

  function paintStatus() {
    const st = settings.get();
    status.replaceChildren(...[
      h('span', { class: 'save-state ' + saveState }, h('span', { class: 'ok-dot' }), saveState === 'saved' ? 'Saved on this device' : saveState === 'saving' ? 'Saving…' : 'Not saved'),
      h('span', {}, `${model.elementCount() - 5} elements`),
      folderPill(),
      h('span', { class: 'grow' }),
      h('span', {}, st.notation === 'guided' ? 'Guided notation' : st.notation === 'v2' ? 'SysML v2 notation' : 'SysML notation'),
      st.integrations.works ? h('span', { class: 'pill accent' }, 'Works linked') : null,
    ].filter((x) => x !== null));
  }

  function paintTabs() {
    const tab = (/** @type {string} */ id, /** @type {string} */ label, /** @type {string} */ ic, /** @type {boolean} */ closable) => {
      const on = active === id;
      return h('div', { class: 'tab' + (on ? ' on' : ''), role: 'presentation' },
        h('button', { class: 'tab-btn', type: 'button', role: 'tab', 'aria-selected': String(on), title: label, onclick: () => { active = id; paintMain(); if (id !== 'overview') currentView()?.focus(); } },
          icon(ic), h('span', { class: 'tab-label' }, label)),
        closable ? h('button', { class: 'tab-x', type: 'button', 'aria-label': `Close ${label}`, onclick: () => closeTab(id) }, icon('x')) : null);
    };
    tabbar.replaceChildren(
      tab('v:home', PROJECT_VIEWS['v:home'].name, PROJECT_VIEWS['v:home'].icon, false),
      tab('overview', 'Model overview', 'grid', false),
      ...tabs.filter((id) => id !== 'v:home').map((id) => isView(id) ? tab(id, PROJECT_VIEWS[id].name, PROJECT_VIEWS[id].icon, id !== 'v:home') : tab(id, model.get(id)?.name || 'Diagram', KIND_ICON[model.get(id)?.kind || ''] || 'diagram', true)),
      h('button', { class: 'icon-btn sm tab-new', type: 'button', 'aria-label': 'Open or create a diagram', title: 'Open or create a diagram', onclick: (/** @type {Event} */ e) => diagramsMenu(/** @type {HTMLElement} */ (e.currentTarget)) }, icon('plus')));
  }
  function paintMain() {
    paintTabs();
    if (active === 'overview') { if (content.firstChild !== stage) content.replaceChildren(stage); paintStage(); return; }
    const v = viewFor(active);
    if (content.firstChild !== v.el) content.replaceChildren(v.el);
    v.invalidate();
  }

  shell.append(sidebar, top, h('main', { class: 'main' }, tabbar, workrow), inspector.el, status);
  paintPane();
  checkFolderOnOpen();
  root.replaceChildren(shell);
  paintTop(); paintMain(); paintStatus();

  /** Commands the app routes here while this project is open. */
  return {
    model,
    selected: () => selected,
    select,
    /** @param {string} kind */
    canNew: (kind) => ownerFor(kind) !== null,
    /** @param {string} kind */
    newElement(kind) { const o = ownerFor(kind); if (o) create(kind, o); },
    rename() { if (selected) { const e = model.get(selected); if (e && !e.layer && e.owner) tree.startRename(selected); } },
    canEditSelection: () => { const e = selected ? model.get(selected) : undefined; return !!e && !e.layer && !!e.owner && !isRel(e.kind); },
    remove() { if (selected) removeEl(selected); },
    flush,
    meta: () => meta,
    /** Elements for the palette's search. */
    searchItems: () => model.all().filter((e) => !isRel(e.kind) && e.owner).map((e) => ({ id: e.id, name: e.name, kind: kindName(e.kind, notation()) })),
    newDiagram,
    openDiagram,
    openOrCreate,
    activeView,
    currentView,
    /** The package a new view of `kind` goes in. @param {string} kind */
    ownerFor,
    linkFolder, unlinkFolder, loadFromFolder,
    syncFolder: () => syncFolder(true),
    linked: () => !!meta.folder,
    textPane: () => pane,
    dispose() { pane?.dispose(); clearTimeout(saveTimer); flush(); unsub(); unsubSettings(); removeEventListener('beforeunload', onUnload); views.forEach((v) => v.dispose()); },
  };
}

/** @typedef {ReturnType<typeof mountWorkspace>} Workspace */
