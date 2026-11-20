// The project workspace: model browser, tabs (the model overview and open diagrams),
// inspector, status bar.
import { h, icon, brandMark, formatKeys, toast } from './dom.js';
import { createTree } from './tree.js';
import { createInspector } from './inspector.js';
import { popupMenu } from './menu.js';
import { LAYERS, ELEMENTS, kindName, isRel, childKinds, isDiagram, DIAGRAM_KINDS } from '../model/metamodel.js';
import { createDiagramView } from '../canvas/view.js';
import { populate, startingBlocks } from '../canvas/populate.js';
import { ModelError } from '../model/model.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../storage/projects.js').ProjectMeta} ProjectMeta */

/** Views listed in the sidebar; `ready: false` shows a "soon" tag. */
const VIEWS = [
  { id: 'overview', name: 'Model overview', icon: 'grid', ready: true },
  { id: 'diagrams', name: 'Diagrams', icon: 'diagram', ready: true },
  { id: 'home', name: 'Systems V', icon: 'vee', ready: false },
  { id: 'trace', name: 'RFLP trace', icon: 'trace', ready: false },
  { id: 'tables', name: 'Tables & matrices', icon: 'table', ready: false },
  { id: 'library', name: 'SysML library', icon: 'book', ready: false },
];

/**
 * @param {HTMLElement} root
 * @param {{
 *   meta: ProjectMeta, model: Model,
 *   settings: import('../settings.js').SettingsStore,
 *   commands: import('../commands.js').CommandRegistry,
 *   save: (m: Model) => Promise<ProjectMeta>,
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
  /** Open diagram tabs, in order. @type {string[]} */
  const tabs = [];
  /** 'overview' or a diagram id. */
  let active = 'overview';
  /** @type {Map<string, import('../canvas/view.js').DiagramView>} */
  const views = new Map();
  const activeView = () => (active === 'overview' ? null : views.get(active) || null);

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
    activeView()?.syncSelection(id);
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
  /** @param {string} id */
  function openDiagram(id) {
    const d = model.get(id);
    if (!d || !isDiagram(d.kind)) return;
    if (!tabs.includes(id)) tabs.push(id);
    active = id;
    paintMain();
    activeView()?.syncSelection(selected);
    activeView()?.focus();
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
  /** @param {string} id */
  function viewFor(id) {
    let v = views.get(id);
    if (!v) {
      v = createDiagramView({ model, diagramId: id, notation, selected: () => selected, select, edit });
      views.set(id, v);
    }
    return v;
  }
  /** Create a diagram in a package (default: the selected one, or the Logical layer), filled with the blocks there. @param {string} kind @param {string | null} [where] */
  function newDiagram(kind, where) {
    const owner = where || ownerFor(kind);
    if (!owner) return;
    const o = /** @type {import('../model/model.js').Element} */ (model.get(owner));
    let id = '';
    if (!edit(`New ${kindName(kind, 'sysml').toLowerCase()}`, (tx) => {
      id = tx.create(kind, { owner, name: `${o.name} structure` });
      populate(model, tx, id, startingBlocks(model, owner), notation());
    })) return;
    expanded.add(owner);
    selected = id;
    tree.render(); inspector.render();
    openDiagram(id);
  }
  /** @param {HTMLElement} anchor */
  function diagramsMenu(anchor) {
    const all = DIAGRAM_KINDS.flatMap((k) => model.byKind(k)).sort((a, b) => a.name.localeCompare(b.name));
    popupMenu(anchor, [
      ...all.map((d) => ({ label: d.name, hint: ELEMENTS[d.kind].abbr, run: () => openDiagram(d.id) })),
      ...(all.length ? /** @type {const} */ (['sep']) : []),
      { label: `New ${kindName('bdd', notation())}`, hint: '+', run: () => newDiagram('bdd') },
    ], { title: all.length ? 'Open a diagram' : 'No diagrams yet' });
  }

  /** Create an element and start renaming it. @param {string} kind @param {string} owner */
  function create(kind, owner) {
    if (isDiagram(kind)) { newDiagram(kind, owner); return; }
    /** @type {string} */
    let id = '';
    if (!edit(`New ${kindName(kind, 'sysml').toLowerCase()}`, (tx) => { id = tx.create(kind, { owner }); })) return;
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
  }
  const unsub = model.subscribe((ev) => {
    if (ev.cause === 'load') return;
    pending = true; saveState = 'saving';
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400);
    if (selected && !model.get(selected)) selected = null;
    for (const t of [...tabs]) if (!model.get(t)) closeTab(t);
    tree.render(); inspector.render(); paintStage(); paintStatus(); paintTop(); paintTabs();
    activeView()?.invalidate();
    if (ev.cause !== 'do') toast(`${ev.cause === 'undo' ? 'Undid' : 'Redid'}: ${ev.label}`);
  });
  const unsubSettings = settings.subscribe(() => { tree.render(); inspector.render(); paintStage(); paintStatus(); shell.classList.toggle('no-insp', !settings.get().inspector); paintTop(); paintTabs(); activeView()?.invalidate(); });
  const onUnload = () => { if (pending) flush(); };
  addEventListener('beforeunload', onUnload);

  // ---------- layout ----------
  const shell = h('div', { class: 'shell' + (settings.get().inspector ? '' : ' no-insp') });
  const top = h('header', { class: 'topbar' });
  const stage = h('div', { class: 'stage', role: 'region', 'aria-label': 'Model overview' });
  const tabbar = h('div', { class: 'tabbar', role: 'tablist', 'aria-label': 'Open views' });
  const content = h('div', { class: 'content' });
  const status = h('footer', { class: 'statusbar' });

  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Model' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'Pteronautics Loom home' }, brandMark(), h('div', {}, h('div', { class: 'brand-name' }, 'Pteronautics'), h('div', { class: 'brand-sub brand-product' }, 'Loom'))),
    h('div', { class: 'nav-group' }, 'Model'),
    tree.el,
    h('div', { class: 'nav-group' }, 'Views'),
    VIEWS.map((v) => h('button', {
      class: 'nav-item' + (v.ready ? '' : ' planned'), type: 'button', 'aria-disabled': v.ready ? undefined : 'true', 'aria-haspopup': v.id === 'diagrams' ? 'menu' : undefined,
      onclick: (/** @type {Event} */ e) => { if (v.id === 'overview') { active = 'overview'; paintMain(); } else if (v.id === 'diagrams') diagramsMenu(/** @type {HTMLElement} */ (e.currentTarget)); },
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
      h('span', { class: 'grow' }),
      h('span', {}, st.notation === 'guided' ? 'Guided notation' : st.notation === 'v2' ? 'SysML v2 notation' : 'SysML notation'),
      st.integrations.works ? h('span', { class: 'pill accent' }, 'Works linked') : null,
    ].filter((x) => x !== null));
  }

  function paintTabs() {
    const tab = (/** @type {string} */ id, /** @type {string} */ label, /** @type {string} */ ic, /** @type {boolean} */ closable) => {
      const on = active === id;
      return h('div', { class: 'tab' + (on ? ' on' : ''), role: 'presentation' },
        h('button', { class: 'tab-btn', type: 'button', role: 'tab', 'aria-selected': String(on), title: label, onclick: () => { active = id; paintMain(); if (id !== 'overview') activeView()?.focus(); } },
          icon(ic), h('span', { class: 'tab-label' }, label)),
        closable ? h('button', { class: 'tab-x', type: 'button', 'aria-label': `Close ${label}`, onclick: () => closeTab(id) }, icon('x')) : null);
    };
    tabbar.replaceChildren(
      tab('overview', 'Model overview', 'grid', false),
      ...tabs.map((id) => tab(id, model.get(id)?.name || 'Diagram', 'diagram', true)),
      h('button', { class: 'icon-btn sm tab-new', type: 'button', 'aria-label': 'Open or create a diagram', title: 'Open or create a diagram', onclick: (/** @type {Event} */ e) => diagramsMenu(/** @type {HTMLElement} */ (e.currentTarget)) }, icon('plus')));
  }
  function paintMain() {
    paintTabs();
    if (active === 'overview') { if (content.firstChild !== stage) content.replaceChildren(stage); paintStage(); return; }
    const v = viewFor(active);
    if (content.firstChild !== v.el) content.replaceChildren(v.el);
    v.invalidate();
  }

  shell.append(sidebar, top, h('main', { class: 'main' }, tabbar, content), inspector.el, status);
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
    activeView,
    dispose() { clearTimeout(saveTimer); flush(); unsub(); unsubSettings(); removeEventListener('beforeunload', onUnload); views.forEach((v) => v.dispose()); },
  };
}

/** @typedef {ReturnType<typeof mountWorkspace>} Workspace */
