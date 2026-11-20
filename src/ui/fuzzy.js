// Fuzzy matching for the command palette and, later, model search.
// Every query character must appear in order. Matches at word starts and in runs score higher.

/**
 * @param {string} query
 * @param {string} text
 * @returns {{ score: number, hits: number[] } | null} null when the text does not match
 */
export function fuzzy(query, text) {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, hits: [] };
  const t = text.toLowerCase();
  // a plain substring is the best kind of match
  const at = t.indexOf(q);
  if (at >= 0) {
    const hits = Array.from({ length: q.length }, (_, i) => at + i);
    return { score: 1000 - at + (isWordStart(text, at) ? 200 : 0) - text.length * 0.1, hits };
  }
  /** @type {number[]} */
  const hits = [];
  let score = 0, ti = 0, prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    score += found === prev + 1 ? 15 : 1;
    if (isWordStart(text, found)) score += 10;
    hits.push(found);
    prev = found; ti = found + 1;
  }
  return { score: score - text.length * 0.1, hits };
}

/** @param {string} text @param {number} i */
function isWordStart(text, i) {
  if (i === 0) return true;
  const p = text[i - 1], c = text[i];
  return /[\s\-_./:·]/.test(p) || (p === p.toLowerCase() && c !== c.toLowerCase());
}

/**
 * Rank items by how well their label (and keywords) match the query.
 * @template T
 * @param {string} query
 * @param {T[]} items
 * @param {(item: T) => string} label
 * @param {(item: T) => string[]} [extra]
 * @returns {{ item: T, hits: number[] }[]}
 */
export function rank(query, items, label, extra = () => []) {
  /** @type {{ item: T, hits: number[], score: number }[]} */
  const out = [];
  for (const item of items) {
    const m = fuzzy(query, label(item));
    if (m) { out.push({ item, hits: m.hits, score: m.score }); continue; }
    // keywords can match too, but never highlight the label
    const k = extra(item).map((w) => fuzzy(query, w)).filter((x) => x !== null);
    if (k.length) out.push({ item, hits: [], score: Math.max(...k.map((x) => x.score)) - 50 });
  }
  return out.sort((a, b) => b.score - a.score).map(({ item, hits }) => ({ item, hits }));
}
