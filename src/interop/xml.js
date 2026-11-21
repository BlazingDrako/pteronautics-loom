// Small XML helpers for the importers and exporters (ReqIF, XMI, Excel). Reading uses the
// browser's DOMParser; elements are found by local name, so namespace prefixes (xmi:, uml:,
// reqif:, SysML:) never matter.

export class InteropError extends Error {}

/** Parse XML text, or throw a readable error. @param {string} text @param {string} what e.g. "ReqIF file" */
export function parseXml(text, what) {
  if (typeof DOMParser === 'undefined') throw new InteropError('Reading XML needs a browser');
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new InteropError(`This ${what} is not well-formed XML: ${(err.textContent || '').split('\n').find((l) => l.trim())?.trim().slice(0, 160) || 'it cannot be read'}`);
  return doc;
}

/** The local name of an element ("SPEC-OBJECT" for reqif:SPEC-OBJECT). @param {Element} el */
export const local = (el) => el.localName || el.nodeName.replace(/^.*:/, '');
/** Direct children with a local name (any name when omitted). @param {Element | Document} el @param {string} [name] @returns {Element[]} */
export const kids = (el, name) => [...el.children].filter((c) => !name || local(c) === name);
/** The first direct child with a local name. @param {Element | Document} el @param {string} name */
export const kid = (el, name) => kids(el, name)[0];
/** Every descendant with a local name. @param {Element | Document} el @param {string} name @returns {Element[]} */
export const all = (el, name) => [...el.getElementsByTagNameNS('*', name)];
/** Follow a path of child names. @param {Element | Document | undefined} el @param {...string} names */
export function path(el, ...names) {
  let cur = el;
  for (const n of names) { if (!cur) return undefined; cur = kid(cur, n); }
  return /** @type {Element | undefined} */ (cur);
}
/** An attribute by local name, whatever its prefix (xmi:id, id). @param {Element} el @param {string} name */
export function attr(el, name) {
  if (el.hasAttribute(name)) return el.getAttribute(name);
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}

/** Escape text for XML content and attributes. @param {unknown} v */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/**
 * Text of rich content (XHTML) as plain text: paragraphs, line breaks and list items become
 * new lines, runs of spaces collapse.
 * @param {Node} node
 */
export function plainText(node) {
  const BLOCK = /^(p|div|li|tr|h[1-6]|pre|blockquote|ul|ol|table)$/i;
  let out = '';
  const walk = (/** @type {Node} */ n) => {
    if (n.nodeType === 3) { out += (n.nodeValue || '').replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const name = local(/** @type {Element} */ (n));
    if (name === 'br') { out += '\n'; return; }
    const block = BLOCK.test(name);
    if (block && out && !out.endsWith('\n')) out += '\n';
    if (name === 'li') out += '• ';
    n.childNodes.forEach(walk);
    if (block && !out.endsWith('\n')) out += '\n';
  };
  walk(node);
  return out.split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
