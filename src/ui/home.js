// The Home page: the first thing Loom shows. Your projects, a new-project flow (blank or the
// Kestrel sample), import and export of .loom.json files, and links to the rest of the family.
import { h, s, icon, brandMark, toast, resolvedTheme } from './dom.js';
import { modal, prompt, confirm } from './dialog.js';
import { LAYERS } from '../model/metamodel.js';
import { VERSION } from '../version.js';

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

/** Download text as a file. @param {string} filename @param {string} text */
export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
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

  const fileInput = h('input', { type: 'file', accept: '.json,.loom.json,application/json', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { toast('That file is larger than 50 MB', true); return; }
    try {
      const meta = await projects.importFile(await f.text());
      toast(`Imported “${meta.name}”`);
      await refresh();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not import that file', true); }
  });

  const refresh = async () => { list = await projects.list(); render(); };

  async function newProject() {
    /** @type {{ name: string, template: 'blank' | 'kestrel' } | null} */
    const r = await modal({
      title: 'New project', ok: 'Create',
      build: () => {
        const name = h('input', { class: 'field', type: 'text', value: 'Untitled project', maxlength: 200 });
        let template = /** @type {'blank' | 'kestrel'} */ ('blank');
        const pick = (/** @type {'blank' | 'kestrel'} */ t) => {
          template = t;
          for (const b of opts.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.t === t));
          if (t === 'kestrel' && name.value === 'Untitled project') name.value = 'Kestrel UAS';
          if (t === 'blank' && name.value === 'Kestrel UAS') name.value = 'Untitled project';
        };
        const opts = h('div', { class: 'templates', role: 'group', 'aria-label': 'Start from' },
          h('button', { type: 'button', class: 'template', 'data-t': 'blank', 'aria-pressed': 'true', onclick: () => pick('blank') },
            h('b', {}, 'Blank'), h('span', {}, 'The four RFLP layers, empty.')),
          h('button', { type: 'button', class: 'template', 'data-t': 'kestrel', 'aria-pressed': 'false', onclick: () => pick('kestrel') },
            h('b', {}, 'Kestrel UAS sample'), h('span', {}, 'A small survey drone: requirements, functions, blocks, ports and traces.')));
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
      ...[['Open', () => ctx.open(p.id)], ['Rename…', () => renameProject(p)], ['Duplicate', () => duplicateProject(p)], ['Export .loom.json', () => exportProject(p)], ['Delete…', () => deleteProject(p)]]
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
          h('div', { class: 'pcard-meta' }, h('span', {}, `${p.stats.elements} elements`), h('span', {}, `${p.stats.relationships} traces`), h('span', {}, `edited ${ago(p.modified)}`)))),
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
            h('button', { class: 'btn lg', type: 'button', onclick: () => fileInput.click() }, icon('upload'), 'Import .loom.json')))),
      h('section', { class: 'projects' },
        h('div', { class: 'projects-head' },
          h('h2', {}, 'Your projects'),
          h('span', { class: 'muted' }, list.length ? `${list.length} on this device` : ''),
          projects.persistent ? null : h('span', { class: 'pill warn-pill' }, 'Storage is off in this window: projects last until you close it')),
        list.length
          ? h('div', { class: 'pgrid' }, list.map(card))
          : h('div', { class: 'pempty' },
            h('b', {}, 'No projects yet'),
            h('p', {}, 'Start a blank project, open the Kestrel sample to look around, or import a .loom.json file.'),
            h('button', { class: 'btn', type: 'button', onclick: newProject }, icon('plus'), 'New project'))),
      h('footer', { class: 'home-foot' },
        h('span', {}, 'Part of the Pteronautics family: ',
          h('a', { href: 'https://github.com/BlazingDrako/pteronautics-atlas', target: '_blank', rel: 'noopener' }, 'Atlas'), ' · ',
          h('a', { href: 'https://github.com/BlazingDrako/pteronautics-works', target: '_blank', rel: 'noopener' }, 'Works'), ' · Loom'),
        h('span', { class: 'mono' }, `Loom ${VERSION} · GPLv3`)),
      fileInput);
  }

  const closeMenus = (/** @type {Event} */ e) => { if (!(e.target instanceof Element && e.target.closest('.card-menu, .card-more'))) document.querySelectorAll('.card-menu').forEach((m) => { /** @type {HTMLElement} */ (m).hidden = true; }); };
  document.addEventListener('click', closeMenus);
  addEventListener('themechange', render);
  render();
  return {
    newProject, importFile: () => fileInput.click(),
    dispose() { document.removeEventListener('click', closeMenus); removeEventListener('themechange', render); },
  };
}
