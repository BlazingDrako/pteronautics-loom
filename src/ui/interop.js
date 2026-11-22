// Dialogs for exchanging models: importing and exporting requirements (ReqIF, Excel, CSV),
// importing Cameo / MagicDraw models (XMI), the SysML v2 API, and generating documents.
import { h, icon, toast } from './dom.js';
import { modal } from './dialog.js';
import { download } from './home.js';
import { kindName } from '../model/metamodel.js';
import { ModelError } from '../model/model.js';
import { readReqif, reqifText, exportReqif } from '../interop/reqif.js';
import { parseCsv, readXlsx, rowsToRecords, requirementRows, requirementsXlsx, toCsv } from '../interop/sheet.js';
import { mergeRequirements, mergeSummary } from '../interop/reqs.js';
import { importXmi, xmiText, reportLines } from '../interop/xmi.js';
import { createApiClient, modelFromApi, apiElementsOf } from '../interop/api.js';
import { buildDocument, SECTIONS, documentDiagrams, loadFonts, printHtml } from '../interop/docs.js';
import { diagramSvg } from '../interop/snapshot.js';
import { InteropError } from '../interop/xml.js';
import { diagramPicture, toPng, pictureName } from '../interop/image.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../interop/reqs.js').ReqRecord} ReqRecord */
/** @typedef {import('../interop/reqs.js').RelRecord} RelRecord */

/** Ask for a file. @param {string} accept @returns {Promise<File | null>} */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

/** What a file is, from its name. @param {string} name */
export function fileFormat(name) {
  const n = name.toLowerCase();
  if (/\.reqifz?$/.test(n)) return 'reqif';
  if (/\.xlsx$/.test(n)) return 'xlsx';
  if (/\.(csv|tsv|txt)$/.test(n)) return 'csv';
  if (/\.(mdzip|xmi|uml)$/.test(n) || (n.endsWith('.xml') && !n.endsWith('.loom.xml'))) return 'xmi';
  return 'loom';
}
export const REQ_ACCEPT = '.reqif,.reqifz,.xlsx,.csv,.tsv,.txt';
export const MODEL_ACCEPT = '.json,.loom.json,.zip,.mdzip,.xmi,.uml,.xml,.reqif,.reqifz,.xlsx,.csv';

/**
 * Requirements from a ReqIF, Excel or CSV file, as records.
 * @param {File} file @param {(id: string) => boolean} [isLoomId]
 * @returns {Promise<{ records: ReqRecord[], rels: RelRecord[], title: string, columns?: { name: string, role: string | null }[] }>}
 */
export async function readRequirementsFile(file, isLoomId) {
  const fmt = fileFormat(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (fmt === 'reqif') { const r = readReqif(await reqifText(bytes), { isLoomId }); return { records: r.records, rels: r.rels, title: r.title }; }
  if (fmt === 'xlsx') {
    const sheets = await readXlsx(bytes);
    // the first sheet that looks like requirements
    let last = null;
    for (const s of sheets) { try { const r = rowsToRecords(s.rows); return { ...r, title: s.name }; } catch (e) { last = e; } }
    throw last || new InteropError('The workbook has no sheets');
  }
  if (fmt === 'csv') { const r = rowsToRecords(parseCsv(new TextDecoder().decode(bytes))); return { ...r, title: file.name.replace(/\.\w+$/, '') }; }
  throw new InteropError('Requirements can be imported from ReqIF (.reqif, .reqifz), Excel (.xlsx) or CSV files');
}

/** The package requirements go into: the selection's package if it is one, else the Requirements layer. @param {Model} m @param {string | null} selected */
export function requirementsPackage(m, selected) {
  for (let e = selected ? m.get(selected) : undefined; e; e = e.owner ? m.get(e.owner) : undefined) if (e.kind === 'package' && e.owner) return e.id;
  return /** @type {string} */ (m.layers().find((l) => l.layer === 'r')?.id);
}

/**
 * Import requirements into a project, after showing what will happen.
 * @param {Model} m @param {string | null} selected @param {(label: string, fn: (tx: any) => void) => boolean} edit
 */
export async function importRequirements(m, selected, edit) {
  const file = await pickFile(REQ_ACCEPT);
  if (!file) return;
  let data;
  try { data = await readRequirementsFile(file, (id) => !!m.get(id)); }
  catch (e) { toast(e instanceof Error ? e.message : 'Could not read that file', true); return; }
  const target = requirementsPackage(m, selected);
  const pkgs = m.byKind('package').filter((p) => p.owner && (m.layerOf(p.id) === 'r' || p.layer === 'r'));
  const reqs = data.records.filter((r) => !r.heading).length;
  const where = await modal({
    title: `Import ${reqs} requirement${reqs === 1 ? '' : 's'}`, ok: 'Import',
    build: () => {
      const sel = h('select', { class: 'field' }, pkgs.map((p) => h('option', { value: p.id, selected: p.id === target ? true : undefined }, m.path(p.id).filter((x) => x.owner).map((x) => x.name).concat(p.name).join(' / '))));
      return {
        body: h('div', {},
          h('p', { class: 'dialog-text' }, `From ${file.name}${data.title && data.title !== file.name ? ` (“${data.title}”)` : ''}: ${reqs} requirements${data.records.length - reqs ? `, ${data.records.length - reqs} headings` : ''}${data.rels.length ? `, ${data.rels.length} relationships` : ''}.`),
          data.columns ? h('p', { class: 'muted small' }, `Columns read: ${data.columns.filter((c) => c.role).map((c) => c.name).join(', ') || 'none'}${data.columns.some((c) => !c.role) ? `. Left out: ${data.columns.filter((c) => !c.role && c.name).map((c) => c.name).join(', ')}` : ''}.`) : null,
          h('label', { class: 'field-label' }, 'Into', sel, h('small', {}, 'Requirements already there with the same ID are updated, not duplicated.'))),
        focus: sel,
        value: () => sel.value,
      };
    },
  });
  if (!where) return;
  /** @type {import('../interop/reqs.js').MergeStats | null} */
  let st = null;
  if (!edit(`Import requirements from ${file.name}`, (tx) => { st = mergeRequirements(m, tx, where, data.records, data.rels); })) return;
  const s = /** @type {any} */ (st);
  if (s.warnings.length > 1) await modal({ title: 'Imported, with notes', ok: 'Done', noCancel: true, build: () => ({ body: h('div', {}, h('p', { class: 'dialog-text' }, mergeSummary({ ...s, warnings: [] })), h('ul', { class: 'notes-list' }, s.warnings.map((/** @type {string} */ w) => h('li', {}, w)))), value: () => true }) });
  else toast(`Imported: ${mergeSummary(s)}`);
}

/**
 * Export a package's requirements as ReqIF, Excel or CSV.
 * @param {Model} m @param {string | null} selected
 */
export async function exportRequirements(m, selected) {
  const pkgs = m.byKind('package').filter((p) => p.owner && m.children(p.id).length);
  const target = requirementsPackage(m, selected);
  const r = await modal({
    title: 'Export requirements', ok: 'Export',
    build: () => {
      let fmt = 'xlsx';
      const sel = h('select', { class: 'field' }, pkgs.map((p) => h('option', { value: p.id, selected: p.id === target ? true : undefined }, m.path(p.id).filter((x) => x.owner).map((x) => x.name).concat(p.name).join(' / '))));
      const seg = h('div', { class: 'seg seg-full', role: 'group', 'aria-label': 'Format' });
      const note = h('small', {});
      const NOTES = /** @type {Record<string, string>} */ ({ reqif: 'For DOORS, Polarion, Jama, Codebeamer and suppliers. Sub-packages become headings; derive, copy and trace links go too.', xlsx: 'One requirement per row, with what satisfies and verifies it. Edit it and import it again: rows are matched by ID.', csv: 'The same rows as plain text, for any tool.' });
      const paint = () => { seg.replaceChildren(...[['xlsx', 'Excel'], ['reqif', 'ReqIF'], ['csv', 'CSV']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(fmt === v), onclick: () => { fmt = v; paint(); } }, l))); note.textContent = NOTES[fmt]; };
      paint();
      return { body: h('div', {}, h('label', { class: 'field-label' }, 'Requirements in', sel), h('div', { class: 'field-label' }, 'Format', seg, note)), focus: sel, value: () => ({ pkg: sel.value, fmt }) };
    },
  });
  if (!r) return;
  const base = `${m.root().name} ${m.get(r.pkg)?.name || ''}`.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'requirements';
  const rows = requirementRows(m, r.pkg);
  if (rows.length <= 1 && r.fmt !== 'reqif') { toast('There are no requirements in that package', true); return; }
  if (r.fmt === 'reqif') download(`${base}.reqif`, exportReqif(m, r.pkg), 'application/xml');
  else if (r.fmt === 'csv') download(`${base}.csv`, toCsv(rows), 'text/csv');
  else download(`${base}.xlsx`, /** @type {any} */ (await requirementsXlsx(m, r.pkg)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  toast(`Exported ${rows.length - 1} requirements`);
}

/**
 * A new model from an imported file that is not a Loom project: Cameo XMI, or requirements.
 * Shows what was read and what was left out. Returns the model and its name, or null.
 * @param {File} file @returns {Promise<{ model: Model, name: string } | null>}
 */
export async function modelFromForeignFile(file) {
  const fmt = fileFormat(file.name);
  if (fmt === 'xmi') {
    const rep = importXmi(await xmiText(new Uint8Array(await file.arrayBuffer())));
    const lines = reportLines(rep);
    const ok = await modal({
      title: `Import “${rep.name}”`, ok: 'Create project',
      build: () => ({
        body: h('div', { class: 'import-report' },
          h('p', { class: 'dialog-text' }, `From ${file.name} (SysML 1.x XMI). Elements go to the RFLP layer of their kind, in the same packages.`),
          h('div', { class: 'sec' }, 'Read'), lines.made.length ? h('ul', { class: 'notes-list' }, lines.made.map((x) => h('li', {}, x))) : h('p', { class: 'muted small' }, 'Nothing Loom can use.'),
          lines.left.length ? [h('div', { class: 'sec' }, 'Left out'), h('ul', { class: 'notes-list' }, lines.left.map((x) => h('li', {}, x)))] : null,
          lines.notes.length ? [h('div', { class: 'sec' }, 'Notes'), h('ul', { class: 'notes-list' }, lines.notes.map((x) => h('li', {}, x)))] : null),
        value: () => true,
      }),
    });
    return ok ? { model: rep.model, name: rep.name } : null;
  }
  if (fmt === 'reqif' || fmt === 'xlsx' || fmt === 'csv') {
    const data = await readRequirementsFile(file);
    const { createModel } = await import('../model/model.js');
    const m = createModel({ name: data.title || file.name.replace(/\.\w+$/, '') });
    const R = /** @type {string} */ (m.layers().find((l) => l.layer === 'r')?.id);
    /** @type {any} */
    let st = null;
    m.transact('Import requirements', (tx) => { st = mergeRequirements(m, tx, R, data.records, data.rels); });
    m.clear();
    toast(`Read ${file.name}: ${mergeSummary(st)}`);
    return { model: m, name: m.root().name };
  }
  return null;
}

// ---------- documents ----------

/**
 * Generate a document of the model.
 * @param {Model} m @param {import('../model/metamodel.js').Notation} notation
 */
export async function documentDialog(m, notation) {
  const KEY = 'loom-doc-options';
  /** @type {{ sections: string[], subtitle: string, author: string }} */
  let saved = { sections: SECTIONS.map((s) => s[0]), subtitle: 'System model report', author: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.sections)) saved = { ...saved, ...v }; } catch { /* storage blocked */ }
  const r = await modal({
    title: 'Generate a document', ok: 'Generate', wide: true,
    build: () => {
      const title = h('input', { class: 'field', type: 'text', value: m.root().name, maxlength: 200 });
      const subtitle = h('input', { class: 'field', type: 'text', value: saved.subtitle, maxlength: 200 });
      const author = h('input', { class: 'field', type: 'text', value: saved.author, maxlength: 200, placeholder: 'Your name or team (optional)' });
      const picks = new Set(saved.sections);
      const boxes = h('div', { class: 'kind-picks', role: 'group', 'aria-label': 'Sections' });
      const paint = () => boxes.replaceChildren(...SECTIONS.map(([id, label]) => h('button', { class: 'kind-pick' + (picks.has(id) ? ' on' : ''), type: 'button', 'aria-pressed': String(picks.has(id)), onclick: () => { if (picks.has(id)) picks.delete(id); else picks.add(id); paint(); } }, label)));
      paint();
      let out = 'pdf';
      const seg = h('div', { class: 'seg seg-full', role: 'group', 'aria-label': 'Output' });
      const paintOut = () => seg.replaceChildren(...[['pdf', 'Print or save as PDF'], ['html', 'Download HTML'], ['tab', 'Open in a new tab']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(out === v), onclick: () => { out = v; paintOut(); } }, l)));
      paintOut();
      const n = documentDiagrams(m).length;
      return {
        body: h('div', {},
          h('label', { class: 'field-label' }, 'Title', title),
          h('div', { class: 'doc-row' }, h('label', { class: 'field-label' }, 'Subtitle', subtitle), h('label', { class: 'field-label' }, 'Author', author)),
          h('div', { class: 'field-label' }, 'Sections', boxes, h('small', {}, `${n} diagram${n === 1 ? '' : 's'} in the model. The notation is the one you use now (${notation === 'guided' ? 'Guided' : notation === 'v2' ? 'SysML v2' : 'SysML'}).`)),
          h('div', { class: 'field-label' }, 'Output', seg, h('small', {}, 'One file with everything in it: styles, fonts and diagrams. For PDF, choose Save as PDF in the print dialog.'))),
        focus: title,
        value: () => ({ title: title.value.trim() || m.root().name, subtitle: subtitle.value.trim(), author: author.value.trim(), sections: SECTIONS.map((s) => s[0]).filter((s) => picks.has(s)), out }),
      };
    },
  });
  if (!r) return;
  try { localStorage.setItem(KEY, JSON.stringify({ sections: r.sections, subtitle: r.subtitle, author: r.author })); } catch { /* storage blocked */ }
  /** @type {Map<string, { svg: string, w: number, h: number }>} */
  const diagrams = new Map();
  if (r.sections.includes('diagrams')) {
    const ds = documentDiagrams(m);
    for (let i = 0; i < ds.length; i++) {
      toast(`Drawing diagrams for the document: ${i + 1} of ${ds.length}`);
      try { const pic = await diagramSvg(m, ds[i].id, notation); if (pic) diagrams.set(ds[i].id, pic); } catch (e) { console.warn('Could not draw', ds[i].name, e); }
    }
  }
  const html = buildDocument(m, { ...r, notation, diagrams, fonts: await loadFonts() });
  const name = `${r.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'document'}.html`;
  if (r.out === 'html') { download(name, html, 'text/html'); toast(`Saved ${name}`); }
  else if (r.out === 'tab') { const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); toast('Opened the document in a new tab'); }
  else { printHtml(html); toast('Opening the print dialog: choose Save as PDF'); }
}

// ---------- the SysML v2 API ----------

const API_KEY = 'loom-api-url';
const lastUrl = () => { try { return localStorage.getItem(API_KEY) || 'http://localhost:9000'; } catch { return 'http://localhost:9000'; } };
const keepUrl = (/** @type {string} */ u) => { try { localStorage.setItem(API_KEY, u); } catch { /* storage blocked */ } };

/**
 * Pick a project on a SysML v2 API server and read it as a new Loom model.
 * @returns {Promise<{ model: Model, name: string } | null>}
 */
export async function importFromApi() {
  /** @type {import('../interop/api.js').ApiProject[]} */
  let list = [];
  /** @type {import('../interop/api.js').ApiClient | null} */
  let client = null;
  const pick = await modal({
    title: 'Open a project from a SysML v2 API server', ok: 'Import', wide: true,
    build: () => {
      const url = h('input', { class: 'field mono', type: 'url', value: lastUrl(), 'aria-label': 'Server address' });
      const token = h('input', { class: 'field', type: 'password', placeholder: 'Access token (only if the server needs one)', 'aria-label': 'Access token', autocomplete: 'off' });
      const status = h('p', { class: 'muted small' }, 'The address of a server that implements the OMG Systems Modeling API, such as the SysML v2 pilot implementation\'s API server.');
      const sel = h('select', { class: 'field', size: 8, 'aria-label': 'Projects' });
      const connect = async () => {
        status.textContent = 'Connecting…'; status.className = 'muted small';
        try {
          client = createApiClient(url.value, { token: token.value || undefined });
          list = await client.projects();
          keepUrl(client.base);
          sel.replaceChildren(...list.map((p) => h('option', { value: p['@id'] }, `${p.name}${p.description ? ` · ${p.description}` : ''}`)));
          if (list[0]) sel.value = list[0]['@id'];
          status.textContent = list.length ? `${list.length} project${list.length === 1 ? '' : 's'}. Choose one to import.` : 'The server has no projects.';
        } catch (e) { status.textContent = e instanceof Error ? e.message : String(e); status.className = 'bad small'; }
      };
      url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); connect(); } });
      return {
        body: h('div', {}, h('div', { class: 'api-row' }, url, h('button', { class: 'btn', type: 'button', onclick: connect }, 'Connect')), token, status, sel),
        focus: url,
        value: () => (sel.value ? sel.value : (status.textContent = 'Connect and choose a project first.', null)),
      };
    },
  });
  if (!pick || !client) return null;
  const c = /** @type {import('../interop/api.js').ApiClient} */ (client);
  const proj = list.find((p) => p['@id'] === pick);
  try {
    toast('Reading the project…');
    const commit = await c.headCommit(pick);
    const els = await c.elements(pick, commit, (k) => toast(`Read ${k} elements…`));
    const r = modelFromApi(els, proj?.name || 'SysML v2 project');
    const made = Object.entries(r.counts).filter(([, k]) => k).map(([k, x]) => `${x} ${k === 'relationships' ? k : kindName(k, 'sysml').toLowerCase()}`).join(', ');
    const left = Object.entries(r.skipped).map(([w, x]) => `${x} ${w}`).join('; ');
    toast(`Read ${els.length} elements: ${made || 'nothing Loom can use'}${left ? `. Left out: ${left}` : ''}`);
    return { model: r.model, name: proj?.name || 'SysML v2 project' };
  } catch (e) { toast(e instanceof Error ? e.message : String(e), true); return null; }
}

/** Send a Loom project to a SysML v2 API server, as a new project with one commit. @param {Model} m */
export async function sendToApi(m) {
  const r = await modal({
    title: 'Send to a SysML v2 API server', ok: 'Send',
    build: () => {
      const url = h('input', { class: 'field mono', type: 'url', value: lastUrl(), 'aria-label': 'Server address' });
      const token = h('input', { class: 'field', type: 'password', placeholder: 'Access token (only if the server needs one)', 'aria-label': 'Access token', autocomplete: 'off' });
      const name = h('input', { class: 'field', type: 'text', value: m.root().name, 'aria-label': 'Project name on the server' });
      return {
        body: h('div', {}, h('label', { class: 'field-label' }, 'Server', url), token, h('label', { class: 'field-label' }, 'New project on the server', name),
          h('p', { class: 'muted small' }, 'Loom creates a new project there and commits the model as SysML v2 elements. Diagrams stay in Loom.')),
        focus: url,
        value: () => ({ url: url.value, token: token.value, name: name.value.trim() || m.root().name }),
      };
    },
  });
  if (!r) return;
  try {
    const c = createApiClient(r.url, { token: r.token || undefined });
    const { elements, left } = apiElementsOf(m);
    toast('Creating the project on the server…');
    const p = await c.createProject(r.name, `Sent from Pteronautics Loom`);
    await c.commit(p['@id'], elements, p.defaultBranch?.['@id']);
    keepUrl(c.base);
    toast(`Sent ${elements.length} elements to “${r.name}” on ${c.base}${left ? ` (${left} Loom elements have no SysML v2 form yet)` : ''}`);
  } catch (e) { toast(e instanceof InteropError || e instanceof ModelError ? e.message : `Could not send: ${e instanceof Error ? e.message : e}`, true); }
}

// ---------- a diagram as a picture ----------

const IMG_KEY = 'loom-image-options';
/** @returns {{ format: 'png' | 'svg', scale: number, frame: boolean }} */
function imageOptions() {
  const o = { format: /** @type {'png' | 'svg'} */ ('png'), scale: 2, frame: true };
  try { const v = JSON.parse(localStorage.getItem(IMG_KEY) || 'null'); if (v) { if (v.format === 'svg' || v.format === 'png') o.format = v.format; if ([1, 2, 4].includes(v.scale)) o.scale = v.scale; if (typeof v.frame === 'boolean') o.frame = v.frame; } } catch { /* storage blocked */ }
  return o;
}

/**
 * Copy or download one diagram as a picture. With `quick`, copy at once with the last options.
 * @param {Model} m @param {string} id @param {import('../model/metamodel.js').Notation} notation @param {{ quick?: boolean }} [o]
 */
export async function imageDialog(m, id, notation, o = {}) {
  const d = m.get(id);
  if (!d || d.kind === 'table' || d.kind === 'matrix' || d.kind === 'gtable') { toast('Open a diagram first (tables and matrices export to Excel)', true); return; }
  let opts = imageOptions();
  /** @type {'copy' | 'download'} */
  let action = 'copy';
  if (!o.quick) {
    const r = await modal({
      title: `Picture of ${d.name}`, ok: 'Copy',
      build: (done) => {
        const seg = (/** @type {string} */ label, /** @type {[any, string][]} */ list, /** @type {() => any} */ get, /** @type {(v: any) => void} */ put) => {
          const el = h('div', { class: 'seg seg-full', role: 'group', 'aria-label': label });
          const paint = () => el.replaceChildren(...list.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(get() === v), onclick: () => { put(v); paint(); paintScale(); } }, l)));
          paint();
          return el;
        };
        const fmt = seg('Format', [['png', 'PNG'], ['svg', 'SVG']], () => opts.format, (v) => { opts.format = v; });
        const scale = seg('Scale', [[1, '1×'], [2, '2×'], [4, '4×']], () => opts.scale, (v) => { opts.scale = v; });
        const scaleRow = h('div', { class: 'field-label' }, 'Size', scale, h('small', {}, '2× is sharp on most screens and slides; 4× for print.'));
        const paintScale = () => { scaleRow.hidden = opts.format !== 'png'; };
        paintScale();
        const frame = h('input', { type: 'checkbox', checked: opts.frame || undefined, onchange: () => { opts.frame = frame.checked; } });
        const dlBtn = h('button', { class: 'btn', type: 'button', onclick: () => { action = 'download'; done(true); } }, icon('download'), 'Download');
        return {
          body: h('div', {},
            h('div', { class: 'field-label' }, 'Format', fmt, h('small', {}, 'PNG pastes anywhere. SVG stays sharp at any size (slides, wikis, Word).')),
            scaleRow,
            h('label', { class: 'check-row' }, frame, h('span', {}, 'Draw the SysML frame with the diagram\'s name')),
            h('div', { class: 'img-actions' }, dlBtn, h('small', {}, 'or Copy to paste it straight into slides, mail or chat.'))),
          value: () => true,
        };
      },
    });
    if (!r) return;
    try { localStorage.setItem(IMG_KEY, JSON.stringify(opts)); } catch { /* storage blocked */ }
  }
  toast('Drawing the picture…');
  const picP = diagramPicture(m, id, notation, { frame: opts.frame }).catch((e) => { console.warn(e); return null; });
  const name = pictureName(d.name, opts.format);
  try {
    if (opts.format === 'png' && action === 'copy' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      // hand the clipboard a promise straight away, while the click still counts (Safari needs this)
      let used = opts.scale;
      const blobP = picP.then(async (pic) => { if (!pic) throw new Error('This diagram has nothing to draw yet'); const png = await toPng(pic, opts.scale); used = png.scale; return png.blob; });
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]);
        toast(`Copied the picture${used < opts.scale ? ` (at ${used}×: the diagram is too big for ${opts.scale}×)` : ''}`);
      } catch (e) {
        // the browser refused the clipboard (permission, or the page lost focus): save it instead
        const blob = await blobP;
        download(name, /** @type {any} */ (blob), 'image/png');
        toast(`The browser would not let Loom copy, so it saved ${name} instead`);
      }
      return;
    }
    const pic = await picP;
    if (!pic) { toast('This diagram has nothing to draw yet', true); return; }
    if (opts.format === 'svg') {
      if (action === 'copy') {
        try { await navigator.clipboard.writeText(pic.svg); toast('Copied the SVG (as text: paste it into Figma, a wiki or an .svg file)'); }
        catch { download(name, pic.svg, 'image/svg+xml'); toast(`The browser would not let Loom copy, so it saved ${name} instead`); }
      }
      else { download(name, pic.svg, 'image/svg+xml'); toast(`Saved ${name}`); }
      return;
    }
    const png = await toPng(pic, opts.scale);
    download(name, /** @type {any} */ (png.blob), 'image/png');
    toast(`${action === 'copy' ? 'This browser cannot copy pictures: saved' : 'Saved'} ${name}${png.scale < opts.scale ? ` (at ${png.scale}×: the diagram is too big for ${opts.scale}×)` : ''}`);
  } catch (e) {
    toast(e instanceof Error && e.message ? e.message : 'Could not make the picture', true);
  }
}
