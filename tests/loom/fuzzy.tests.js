import { fuzzy, rank } from '../../src/ui/fuzzy.js';

/** @param {import('../run.js').Log} log */
export function fuzzyTests(log) {
  log('Empty query matches everything', fuzzy('', 'anything')?.score === 0);
  log('Letters must appear in order', fuzzy('kp', 'palette open') === null);
  log('Case does not matter', fuzzy('PAL', 'Open the command palette') !== null);
  const sub = fuzzy('pal', 'Open the command palette');
  log('A substring match highlights the right letters', JSON.stringify(sub?.hits) === JSON.stringify([17, 18, 19]), JSON.stringify(sub?.hits));
  const scattered = fuzzy('npt', 'New part definition');
  log('Scattered letters match', scattered !== null && scattered.hits.length === 3, JSON.stringify(scattered));

  const titles = ['New requirement', 'New part definition (block)', 'Open the command palette', 'Notation: Guided (plain words)'];
  const r = rank('req', titles, (t) => t);
  log('Substring beats scattered letters', r[0]?.item === 'New requirement', r.map((x) => x.item).join(' | '));
  const r2 = rank('npd', titles, (t) => t);
  log('Initials find "New part definition"', r2[0]?.item === 'New part definition (block)', r2.map((x) => x.item).join(' | '));
  const r3 = rank('block', titles, (t) => t);
  log('Words inside parentheses still match', r3[0]?.item === 'New part definition (block)');
  const r4 = rank('beginner', [{ t: 'Notation: Guided', k: ['beginner'] }, { t: 'Other', k: [] }], (x) => x.t, (x) => x.k);
  log('Keywords match when the title does not', r4.length === 1 && r4[0].item.t === 'Notation: Guided' && r4[0].hits.length === 0);
  log('No match returns an empty list', rank('zzz', titles, (t) => t).length === 0);
}
