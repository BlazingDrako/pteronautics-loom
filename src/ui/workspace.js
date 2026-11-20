// The project workspace: model browser, overview stage, inspector, status bar.
// Diagrams replace the overview stage in the next build; everything else here stays.
import { h, icon, brandMark, formatKeys, toast } from './dom.js';
import { createTree } from './tree.js';
import { createInspector } from './inspector.js';
import { popupMenu } from './menu.js';
import { LAYERS, ELEMENTS, kindName, isRel, childKinds } from '../model/metamodel.js';
import { ModelError } from '../model/model.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../storage/projects.js').ProjectMeta} ProjectMeta */

/** Views listed in the sidebar; `ready: false` shows a "soon" tag. */
const VIEWS = [
  { id: 'overview', name: 'Model overview', icon: 'grid', ready: true },
  { id: 'diagrams', name: 'Diagrams', icon: 'diagram', ready: false },
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
  }

  const tree = createTree({
    model, notation, expanded,
    selected: () => selected,
    select,
    create: (kind, owner) => create(kind, owner),
    rename: (id, name) => { edit('Rename', (tx) => tx.rename(id, name)); },
    move: (id, owner) => edit('Move', (tx) => tx.move(id, owner)),
    remove: (id) => removeEl(id),
  });
  const inspector = createInspector({ model, settings, commands, selected: () => selected, select, edit, meta: () => meta });

  /** Create an element and start renaming it. @param {string} kind @param {string} owner */
  function create(kind, owner) {
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
    tree.render(); inspector.render(); paintStage(); paintStatus(); paintTop();
    if (ev.cause !== 'do') toast(`${ev.cause === 'undo' ? 'Undid' : 'Redid'}: ${ev.label}`);
  });
  const unsubSettings = settings.subscribe(() => { tree.render(); inspector.render(); paintStage(); paintStatus(); shell.classList.toggle('no-insp', !settings.get().inspector); paintTop(); });
  const onUnload = () => { if (pending) flush(); };
  addEventListener('beforeunload', onUnload);

  // ---------- layout ----------
  const shell = h('div', { class: 'shell' + (settings.get().inspector ? '' : ' no-insp') });
  const top = h('header', { class: 'topbar' });
  const stage = h('div', { class: 'stage', role: 'region', 'aria-label': 'Model overview' });
  const status = h('footer', { class: 'statusbar' });

  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Model' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'Pteronautics Loom home' }, brandMark(), h('div', {}, h('div', { class: 'brand-name' }, 'Pteronautics'), h('div', { class: 'brand-sub brand-product' }, 'Loom'))),
    h('div', { class: 'nav-group' }, 'Model'),
    tree.el,
    h('div', { class: 'nav-group' }, 'Views'),
    VIEWS.map((v) => h('button', { class: 'nav-item' + (v.id === 'overview' ? ' active' : '') + (v.ready ? '' : ' planned'), type: 'button', 'aria-disabled': v.ready ? undefined : 'true', 'aria-current': v.id === 'overview' ? 'page' : undefined },
      icon(v.icon), h('span', { class: 'nav-label' }, v.name), v.ready ? null : h('span', { class: 'soon' }, 'soon'))),
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

  shell.append(sidebar, top, h('main', { class: 'main' }, h('div', { class: 'tabbar' }, h('span', { class: 'tab on' }, icon('grid'), 'Model overview')), stage), inspector.el, status);
  root.replaceChildren(shell);
  paintTop(); paintStage(); paintStatus();

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
    dispose() { clearTimeout(saveTimer); flush(); unsub(); unsubSettings(); removeEventListener('beforeunload', onUnload); },
  };
}

/** @typedef {ReturnType<typeof mountWorkspace>} Workspace */
