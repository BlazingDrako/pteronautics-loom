// The Home page: the first thing Loom shows. Your projects, a new-project flow (blank or the
// samples), import and export of .loom.json files, and links to the rest of the family.
import { h, s, icon, brandMark, toast, resolvedTheme } from './dom.js';
import { modal, prompt, confirm } from './dialog.js';
import { LAYERS } from '../model/metamodel.js';
import { canUseFolders, pickFolder, readFolder } from '../storage/folderfs.js';
import { VERSION } from '../version.js';
import { fileFormat, modelFromForeignFile, MODEL_ACCEPT, importFromApi } from './interop.js';
import { SAMPLES, sampleById } from '../model/samples.js';
import { modelFromFiles } from '../storage/folder.js';
import { canInstall, install, onInstallChange } from '../pwa.js';

/** @typedef {import('../storage/projects.js').ProjectStore} ProjectStore */
/** @typedef {import('../storage/projects.js').ProjectMeta} ProjectMeta */

/** "3 min ago", "yesterday". @param {string} iso */
export function ago(iso) {
  const t = Date.parse(iso); if (!isFinite(t)) return '';
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  const d = Math.round(sec / 86400);
  return d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : new Date(t).toLocaleDateString();
}

/** Download text as a file. @param {string} filename @param {string} text @param {string} [type] */
export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The woven-thread artwork behind the hero: four RFLP-colored threads crossing a warp. */
function weave() {
  const svg = s('svg', { class: 'weave', viewBox: '0 0 1200 360', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  for (let x = 30; x < 1200; x += 46) svg.append(s('line', { x1: x, y1: 0, x2: x, y2: 360, class: 'warp' }));
  const colors = ['var(--layer-r)', 'var(--layer-f)', 'var(--layer-l)', 'var(--layer-p)'];
  colors.forEach((c, i) => {
    const y = 90 + i * 58;
    let d = `M -20 ${y}`;
    for (let x = -20, k = 0; x < 1240; x += 92, k++) d += ` Q ${x + 46} ${y + (k % 2 ? 22 : -22)} ${x + 92} ${y}`;
    svg.append(s('path', { d, class: 'weft', style: `stroke:${c};animation-delay:${-i * 1.6}s` }));
  });
  return svg;
}

/**
 * @param {HTMLElement} root
 * @param {{ projects: ProjectStore, open: (id: string) => void }} ctx
 */
export async function mountHome(root, ctx) {
  const { projects } = ctx;
  let list = await projects.list();
  const page = h('div', { class: 'home' });
  root.replaceChildren(page);

  const fileInput = h('input', { type: 'file', accept: MODEL_ACCEPT, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) await openFiles([f]);
  });
  /**
   * Open files as a project: a Loom file, a model or requirements from another tool, or
   * SysML v2 text files (the .sysml files of a project folder). Used by Import and by the
   * installed app when files are opened with it.
   * @param {File[]} files
   */
  async function openFiles(files) {
    if (!files.length) return;
    if (files.some((x) => x.size > 200 * 1024 * 1024)) { toast('That file is larger than 200 MB', true); return; }
    if (files.every((x) => x.name.toLowerCase().endsWith('.sysml'))) {
      try {
        /** @type {Record<string, string>} */
        const texts = {};
        for (const x of files) texts[x.name] = await x.text();
        const { model } = modelFromFiles(texts);
        const name = files.length === 1 ? files[0].name.replace(/\.sysml$/i, '') : model.root().name;
        const meta = await projects.importModel(name, `Opened from ${files.map((x) => x.name).join(', ')}`, model);
        toast(`Opened “${meta.name}”`);
        ctx.open(meta.id);
      } catch (e) { toast(e instanceof Error ? e.message : 'Could not read that SysML file', true); }
      return;
    }
    const f = files[0];
    try {
      if (fileFormat(f.name) !== 'loom') {
        // a model from another tool (Cameo XMI) or requirements (ReqIF, Excel, CSV): a new project
        const r = await modelFromForeignFile(f);
        if (!r) return;
        const meta = await projects.importModel(r.name, `Imported from ${f.name}`, r.model);
        toast(`Imported “${meta.name}”`);
        ctx.open(meta.id);
        return;
      }
      const meta = await projects.importBytes(new Uint8Array(await f.arrayBuffer()));
      toast(`Imported “${meta.name}”`);
      await refresh();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not import that file', true); }
  }
  /** A project from a SysML v2 API server. */
  async function openFromServer() {
    const r = await importFromApi();
    if (!r) return;
    const meta = await projects.importModel(r.name, 'Imported from a SysML v2 API server', r.model);
    ctx.open(meta.id);
  }

  const refresh = async () => { list = await projects.list(); render(); };

  /** Open a project folder (SysML text plus .loom/) and keep it in step. */
  async function openFolder() {
    if (!canUseFolders()) { toast('This browser cannot open folders. Import a .zip of the folder instead (Chrome, Edge and Arc can open folders).', true); return; }
    const dir = await pickFolder();
    if (!dir) return;
    try {
      const files = await readFolder(dir);
      if (!Object.keys(files).some((p) => p.endsWith('.sysml'))) { toast(`“${dir.name}” has no Loom project (no .sysml files). To save a project into it, open the project and choose Save to a folder.`, true); return; }
      const meta = await projects.importFolder(files, dir, dir.name);
      toast(`Opened “${meta.name}” from the folder ${dir.name}`);
      ctx.open(meta.id);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not open that folder', true); }
  }

  async function newProject() {
    /** @type {{ name: string, template: string } | null} */
    const r = await modal({
      title: 'New project', ok: 'Create',
      build: () => {
        const name = h('input', { class: 'field', type: 'text', value: 'Untitled project', maxlength: 200 });
        let template = 'blank';
        const defaults = new Set(['Untitled project', ...SAMPLES.map((x) => x.name)]);
        const pick = (/** @type {string} */ t) => {
          template = t;
          for (const b of opts.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.t === t));
          if (defaults.has(name.value)) name.value = sampleById(t)?.name || 'Untitled project';
        };
        const opts = h('div', { class: 'templates', role: 'group', 'aria-label': 'Start from' },
          h('button', { type: 'button', class: 'template', 'data-t': 'blank', 'aria-pressed': 'true', onclick: () => pick('blank') },
            h('b', {}, 'Blank'), h('span', {}, 'The four RFLP layers, empty.')),
          SAMPLES.map((x) => h('button', { type: 'button', class: 'template', 'data-t': x.id, 'aria-pressed': 'false', onclick: () => pick(x.id) },
            h('b', {}, `${x.title} sample`), h('span', {}, x.blurb))));
        return {
          body: h('div', {}, h('label', { class: 'field-label' }, 'Name', name), h('div', { class: 'field-label' }, 'Start from'), opts),
          focus: name,
          value: () => ({ name: name.value.trim() || 'Untitled project', template }),
        };
      },
    });
    if (!r) return;
    const meta = await projects.create(r);
    ctx.open(meta.id);
  }

  /** @param {ProjectMeta} p */
  async function renameProject(p) {
    const name = await prompt({ title: 'Rename project', label: 'Name', value: p.name, ok: 'Rename' });
    if (!name) return;
    await projects.rename(p.id, name); await refresh();
  }
  /** @param {ProjectMeta} p */
  async function exportProject(p) {
    const f = await projects.exportFile(p.id);
    download(f.filename, f.text);
    toast(`Exported ${f.filename}`);
  }
  /** @param {ProjectMeta} p */
  async function exportZip(p) {
    const f = await projects.exportZip(p.id);
    download(f.filename, /** @type {any} */ (f.bytes), 'application/zip');
    toast(`Exported ${f.filename}`);
  }
  /** @param {ProjectMeta} p */
  async function deleteProject(p) {
    const ok = await confirm({ title: `Delete “${p.name}”?`, body: `This removes the project and its ${p.stats.elements} elements from this device. It cannot be undone. Export it first if you may want it back.`, ok: 'Delete project', danger: true });
    if (!ok) return;
    await projects.remove(p.id); toast(`Deleted “${p.name}”`); await refresh();
  }
  /** @param {ProjectMeta} p */
  async function duplicateProject(p) { const m = await projects.duplicate(p.id); toast(`Created “${m.name}”`); await refresh(); }

  /** @param {ProjectMeta} p */
  function card(p) {
    const total = Math.max(1, LAYERS.reduce((a, l) => a + (p.stats.layers[l.id] || 0), 0));
    const menu = h('div', { class: 'card-menu', role: 'menu', hidden: true },
      ...[['Open', () => ctx.open(p.id)], ['Rename…', () => renameProject(p)], ['Duplicate', () => duplicateProject(p)], ['Export .zip (SysML text)', () => exportZip(p)], ['Export .loom.json', () => exportProject(p)], ['Delete…', () => deleteProject(p)]]
        .map(([label, fn]) => h('button', { type: 'button', role: 'menuitem', class: label === 'Delete…' ? 'danger-text' : '', onclick: (/** @type {Event} */ e) => { e.stopPropagation(); menu.hidden = true; /** @type {() => void} */ (fn)(); } }, /** @type {string} */ (label))));
    const more = h('button', { class: 'icon-btn card-more', type: 'button', 'aria-label': `Actions for ${p.name}`, 'aria-haspopup': 'menu',
      onclick: (/** @type {Event} */ e) => {
        e.stopPropagation();
        const was = menu.hidden;
        document.querySelectorAll('.card-menu').forEach((m) => { /** @type {HTMLElement} */ (m).hidden = true; });
        menu.hidden = !was;
        if (!menu.hidden) /** @type {HTMLElement | null} */ (menu.querySelector('button'))?.focus();
      } }, icon('more'));
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.hidden = true; more.focus(); } });
    return h('article', { class: 'pcard' },
      h('button', { class: 'pcard-open', type: 'button', onclick: () => ctx.open(p.id), 'aria-label': `Open ${p.name}` },
        h('div', { class: 'pcard-stage' },
          h('div', { class: 'pcard-bars' }, LAYERS.map((l) => h('div', { class: 'pcard-bar' },
            h('span', { class: 'pcard-bar-label' }, l.name),
            h('span', { class: 'pcard-bar-track' }, h('i', { style: { width: `${Math.round(((p.stats.layers[l.id] || 0) / total) * 100)}%`, background: l.color } })),
            h('span', { class: 'pcard-bar-n mono' }, String(p.stats.layers[l.id] || 0)))))),
        h('div', { class: 'pcard-body' },
          h('h3', { class: 'pcard-title', title: p.name }, p.name),
          h('div', { class: 'pcard-meta' }, p.folder ? h('span', { class: 'pcard-folder', title: `Saved to the folder ${p.folder.name}` }, icon('folder'), p.folder.name) : null, h('span', {}, `${p.stats.elements} elements`), h('span', {}, `${p.stats.relationships} traces`), h('span', {}, `edited ${ago(p.modified)}`)))),
      more, menu);
  }

  function render() {
    page.replaceChildren(
      h('header', { class: 'home-top' },
        h('a', { class: 'brand', href: '#/' }, brandMark(), h('div', {}, h('div', { class: 'brand-name' }, 'Pteronautics'), h('div', { class: 'brand-sub brand-product' }, 'Loom'))),
        h('div', { style: { flex: '1' } }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': resolvedTheme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme', onclick: () => ctx.toggleTheme() }, icon(resolvedTheme() === 'dark' ? 'sun' : 'moon'))),
      h('section', { class: 'hero' },
        weave(),
        h('div', { class: 'hero-inner' },
          h('div', { class: 'eyebrow' }, 'Model-based systems engineering'),
          h('h1', { class: 'hero-title' }, 'Every requirement, ', h('em', {}, 'woven through'), ' to the part that meets it.'),
          h('p', { class: 'hero-sub' }, 'Loom models your system in SysML across four layers (requirements, functions, logical and physical) and keeps every thread between them traced.'),
          h('div', { class: 'hero-actions' },
            h('button', { class: 'btn primary lg', type: 'button', onclick: newProject }, icon('plus'), 'New project'),
            canUseFolders() ? h('button', { class: 'btn lg', type: 'button', title: 'Open a folder of .sysml files saved by Loom (for example a git repository)', onclick: openFolder }, icon('folder'), 'Open folder') : null,
            h('button', { class: 'btn lg', type: 'button', title: 'Import a Loom project (.loom.json, .zip), a Cameo or MagicDraw model (.mdzip, .xmi), or requirements (ReqIF, Excel, CSV)', onclick: () => fileInput.click() }, icon('upload'), 'Import'),
            h('button', { class: 'btn lg', type: 'button', title: 'Open a project from a SysML v2 API server', onclick: openFromServer }, icon('plug'), 'SysML v2 server'),
            canInstall() ? h('button', { class: 'btn lg', type: 'button', title: 'Install Loom as an app: its own window, in your dock or start menu, and it works offline', onclick: () => install() }, icon('download'), 'Install app') : null))),
      h('section', { class: 'projects' },
        h('div', { class: 'projects-head' },
          h('h2', {}, 'Your projects'),
          h('span', { class: 'muted' }, list.length ? `${list.length} on this device` : ''),
          projects.persistent ? null : h('span', { class: 'pill warn-pill' }, 'Storage is off in this window: projects last until you close it')),
        list.length
          ? h('div', { class: 'pgrid' }, list.map(card))
          : h('div', { class: 'pempty' },
            h('b', {}, 'No projects yet'),
            h('p', {}, 'Start a blank project, open a sample to look around (a survey drone, a CubeSat’s power system or a landing gear), or bring in a project file or folder.'),
            h('button', { class: 'btn', type: 'button', onclick: newProject }, icon('plus'), 'New project'))),
      h('footer', { class: 'home-foot' },
        h('span', {}, 'Part of the ',
          h('a', { href: 'https://blazingdrako.github.io/pteronautics/', target: '_blank', rel: 'noopener' }, 'Pteronautics'), ' family: ',
          h('a', { href: 'https://blazingdrako.github.io/pteronautics-atlas/', target: '_blank', rel: 'noopener' }, 'Atlas'), ' · ',
          h('a', { href: 'https://blazingdrako.github.io/pteronautics-works/', target: '_blank', rel: 'noopener' }, 'Works'), ' · Loom'),
        h('span', { class: 'home-credit' }, 'Made by Andrew Aguiar'),
        h('span', { class: 'mono' }, `Loom ${VERSION} · GPLv3`)),
      fileInput);
  }

  const closeMenus = (/** @type {Event} */ e) => { if (!(e.target instanceof Element && e.target.closest('.card-menu, .card-more'))) document.querySelectorAll('.card-menu').forEach((m) => { /** @type {HTMLElement} */ (m).hidden = true; }); };
  document.addEventListener('click', closeMenus);
  addEventListener('themechange', render);
  const unsubInstall = onInstallChange(render);
  render();
  return {
    newProject, importFile: () => fileInput.click(), openFiles, openFolder, openFromServer,
    dispose() { document.removeEventListener('click', closeMenus); removeEventListener('themechange', render); unsubInstall(); },
  };
}
