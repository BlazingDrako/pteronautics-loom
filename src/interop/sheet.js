// Spreadsheets: CSV and Excel (.xlsx), read and written with no libraries (an .xlsx file is a
// zip of XML). Requirements go out one per row and come back in the same way, matched by ID,
// so a spreadsheet can be handed to someone, edited and imported again.
import { zip, unzip, isZip } from '../storage/zip.js';
import { parseXml, kids, kid, all, attr, esc, InteropError } from './xml.js';
import { requirementStatus } from '../model/trace.js';
import { verificationText } from '../views/table.js';
import { roleOf } from './reqif.js';

/** @typedef {import('../model/model.js').Model} Model */
/** @typedef {import('../model/model.js').Element} Element */
/** @typedef {(string | number)[]} SheetRow */
/** @typedef {{ name: string, rows: SheetRow[], widths?: number[] }} Sheet */

// ---------- CSV ----------

/**
 * Parse CSV (RFC 4180: quotes, doubled quotes, line breaks inside quotes). The separator is
 * worked out from the first line: comma, semicolon (European Excel) or tab.
 * @param {string} text @returns {string[][]}
 */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [',', ';', '\t'].map((s) => [s, (firstLine.match(new RegExp(s === '\t' ? '\t' : s, 'g')) || []).length]);
  const sep = /** @type {string} */ (counts.sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]))[0][0]);
  /** @type {string[][]} */
  const rows = [];
  let row = /** @type {string[]} */ ([]), cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** @param {string | number} v */
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** Rows as CSV (with a byte-order mark, so Excel reads accents correctly). @param {SheetRow[]} rows */
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// ---------- Excel ----------

/** "A", "B", … "AA" for a column index. @param {number} i */
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
/** Column index from a cell reference ("C12" → 2). @param {string} ref */
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/**
 * Write an Excel workbook. The first row of each sheet is a bold, frozen header with a filter.
 * @param {Sheet[]} sheets @returns {Promise<Uint8Array>}
 */
export async function writeXlsx(sheets) {
  /** @type {Record<string, string>} */
  const files = {};
  const safe = sheets.map((s, i) => ({ ...s, name: (s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`) }));
  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safe.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files['xl/styles.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`;
  safe.forEach((s, i) => {
    const width = s.rows.reduce((w, r) => Math.max(w, r.length), 0);
    const cols = width ? `<cols>${Array.from({ length: width }, (_, c) => `<col min="${c + 1}" max="${c + 1}" width="${s.widths?.[c] || 18}" customWidth="1"/>`).join('')}</cols>` : '';
    const body = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`, style = ri === 0 ? ' s="1"' : ' s="2"';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      const t = String(v ?? '');
      return t === '' ? '' : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const last = width ? `${colName(width - 1)}${Math.max(1, s.rows.length)}` : 'A1';
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData>${s.rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
  });
  return zip(files);
}

/**
 * Read every sheet of an Excel workbook as rows of text.
 * @param {Uint8Array} bytes @returns {Promise<{ name: string, rows: string[][] }[]>}
 */
export async function readXlsx(bytes) {
  if (!isZip(bytes)) throw new InteropError('This is not an Excel workbook (.xlsx). Older .xls files must be saved as .xlsx or CSV first.');
  const files = await unzip(bytes);
  const text = (/** @type {string} */ p) => { const f = files[p] || files[p.replace(/^\//, '')]; return f ? new TextDecoder().decode(f) : null; };
  const wb = text('xl/workbook.xml');
  if (!wb) throw new InteropError('This .xlsx file has no workbook in it');
  /** @type {string[]} */
  const shared = [];
  const ss = text('xl/sharedStrings.xml');
  if (ss) for (const si of all(parseXml(ss, 'workbook'), 'si')) shared.push(all(si, 't').map((t) => t.textContent || '').join(''));
  const rels = new Map(all(parseXml(text('xl/_rels/workbook.xml.rels') || '<Relationships/>', 'workbook'), 'Relationship').map((r) => [r.getAttribute('Id') || '', r.getAttribute('Target') || '']));
  const out = [];
  for (const sh of all(parseXml(wb, 'workbook'), 'sheet')) {
    const target = rels.get(attr(sh, 'id') || '') || '';
    const xml = text(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    if (!xml) continue;
    /** @type {string[][]} */
    const rows = [];
    for (const row of all(parseXml(xml, 'worksheet'), 'row')) {
      /** @type {string[]} */
      const cells = [];
      for (const c of kids(row, 'c')) {
        const ref = c.getAttribute('r'), t = c.getAttribute('t');
        const i = ref ? colIndex(ref) : cells.length;
        let v = '';
        if (t === 's') v = shared[Number(kid(c, 'v')?.textContent)] ?? '';
        else if (t === 'inlineStr') v = all(c, 't').map((x) => x.textContent || '').join('');
        else if (t === 'b') v = kid(c, 'v')?.textContent === '1' ? 'TRUE' : 'FALSE';
        else v = kid(c, 'v')?.textContent ?? '';
        while (cells.length < i) cells.push('');
        cells[i] = v;
      }
      const r = Number(row.getAttribute('r')) - 1;
      while (Number.isFinite(r) && rows.length < r) rows.push([]);
      rows.push(cells);
    }
    out.push({ name: sh.getAttribute('name') || 'Sheet', rows: rows.filter((r) => r.some((x) => String(x).trim() !== '')) });
  }
  return out;
}

// ---------- requirements as rows ----------

/** The columns Loom writes, in order. */
export const REQ_HEADER = ['ID', 'Name', 'Text', 'Level', 'Priority', 'Status', 'Verification method', 'Rationale', 'Parent ID', 'Derived from', 'Satisfied by', 'Verified by', 'Verification result', 'Package'];
const WIDTHS = [14, 28, 60, 12, 10, 12, 18, 40, 14, 20, 28, 28, 18, 24];

/**
 * Every requirement inside a package as rows (with a header), depth first.
 * @param {Model} m @param {string} rootId @returns {SheetRow[]}
 */
export function requirementRows(m, rootId) {
  const status = requirementStatus(m);
  const label = (/** @type {Element} */ e) => (e.kind === 'requirement' && e.props.reqId ? e.props.reqId : e.name);
  /** @type {SheetRow[]} */
  const rows = [REQ_HEADER];
  const walk = (/** @type {string} */ id) => {
    for (const c of m.children(id)) {
      if (c.kind === 'package') { walk(c.id); continue; }
      if (c.kind !== 'requirement') continue;
      const parent = m.get(/** @type {string} */ (c.owner));
      const src = (/** @type {string} */ k) => m.relsTo(c.id).filter((r) => r.kind === k).map((r) => label(/** @type {Element} */ (m.get(/** @type {string} */ (r.source))))).join(', ');
      rows.push([
        c.props.reqId || '', c.name, c.props.text || '', c.props.level, c.props.priority === '—' ? '' : c.props.priority, c.props.status,
        c.props.method === '—' ? '' : c.props.method, c.props.doc || '',
        parent?.kind === 'requirement' ? label(parent) : '',
        m.relsFrom(c.id).filter((r) => r.kind === 'derive').map((r) => label(/** @type {Element} */ (m.get(/** @type {string} */ (r.target))))).join(', '),
        src('satisfy'), src('verify'), verificationText(status.get(c.id)),
        m.path(c.id).filter((p) => p.owner && p.kind === 'package').map((p) => p.name).join(' / '),
      ]);
      walk(c.id);
    }
  };
  walk(rootId);
  return rows;
}

/** A workbook of requirements. @param {Model} m @param {string} rootId */
export const requirementsXlsx = (m, rootId) => writeXlsx([{ name: 'Requirements', rows: requirementRows(m, rootId), widths: WIDTHS }]);

/** Header names that set the parent, or derive links, beyond the ReqIF names. */
const PARENT = ['parent id', 'parent', 'parent requirement', 'contained in', 'parent key'];
const DERIVED = ['derived from', 'derives from', 'source requirement', 'derived'];
const HEADING = ['type', 'object type', 'kind', 'row type'];

/**
 * Turn spreadsheet rows (the first is the header) into records for mergeRequirements.
 * Columns are recognised by name (ID, Name, Text, Priority…); others are left out.
 * @param {string[][]} rows
 * @returns {{ records: import('./reqs.js').ReqRecord[], rels: import('./reqs.js').RelRecord[], columns: { name: string, role: string | null }[] }}
 */
export function rowsToRecords(rows) {
  if (!rows.length) throw new InteropError('The sheet is empty');
  const header = rows[0].map((x) => String(x));
  const roles = header.map((hd) => {
    const n = hd.trim().toLowerCase().replace(/[_\s]+/g, ' ');
    if (PARENT.includes(n)) return 'parent';
    if (DERIVED.includes(n)) return 'derived';
    if (HEADING.includes(n)) return 'type';
    return roleOf(hd);
  });
  if (!roles.some((r) => r === 'text' || r === 'name' || r === 'reqId')) throw new InteropError(`Loom cannot find the requirement columns. Name them ID, Name and Text (found: ${header.filter(Boolean).slice(0, 8).join(', ')})`);
  /** @type {import('./reqs.js').ReqRecord[]} */
  const records = [];
  /** @type {import('./reqs.js').RelRecord[]} */
  const rels = [];
  /** @type {Map<string, string>} */
  const refByReqId = new Map();
  /** @type {{ ref: string, parent: string }[]} */
  const parents = [];
  rows.slice(1).forEach((row, i) => {
    const ref = `row${i + 2}`;
    /** @type {Record<string, string>} */
    const v = {};
    roles.forEach((role, c) => { if (role && row[c] !== undefined && v[role] === undefined) v[role] = String(row[c]); });
    if (!Object.values(v).some((x) => x.trim())) return;
    const heading = /^(heading|chapter|section|title)$/i.test((v.type || '').trim()) || (!!v.chapter && !v.text);
    /** @type {import('./reqs.js').ReqRecord} */
    const r = { ref, heading, reqId: v.reqId, name: heading ? (v.chapter || v.name) : v.name, text: v.text, priority: v.priority, status: v.status, method: v.method, level: v.level, rationale: v.rationale };
    for (const k of Object.keys(r)) if (/** @type {any} */ (r)[k] === undefined) delete /** @type {any} */ (r)[k];
    records.push(r);
    if (v.reqId?.trim()) refByReqId.set(v.reqId.trim(), ref);
    if (v.parent?.trim()) parents.push({ ref, parent: v.parent.trim() });
    for (const d of (v.derived || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) rels.push({ kind: 'derive', from: ref, to: d });
  });
  for (const p of parents) { const r = records.find((x) => x.ref === p.ref); const pr = refByReqId.get(p.parent); if (r && pr && pr !== r.ref) r.parentRef = pr; }
  // derive targets name requirement IDs: point at rows in this sheet where they are here
  for (const rel of rels) rel.to = refByReqId.get(rel.to) || rel.to;
  return { records, rels, columns: header.map((name, i) => ({ name, role: roles[i] })) };
}
