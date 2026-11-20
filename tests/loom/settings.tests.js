import { createSettings, defaults, sanitize } from '../../src/settings.js';

/** In-memory stand-in for localStorage. */
function memoryStorage() {
  /** @type {Map<string, string>} */
  const m = new Map();
  return { getItem: (/** @type {string} */ k) => m.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { m.set(k, v); }, m };
}

/** @param {import('../run.js').Log} log */
export function settingsTests(log) {
  const d = defaults();
  log('Works integration is off by default', d.integrations.works === false, JSON.stringify(d.integrations));
  log('Default notation is SysML', d.notation === 'sysml', d.notation);
  log('Inspector is shown by default', d.inspector === true);

  log('Garbage input falls back to defaults', JSON.stringify(sanitize('nonsense')) === JSON.stringify(d));
  log('Unknown notation is ignored', sanitize({ notation: 'uml' }).notation === 'sysml');
  log('Wrongly typed values are ignored', sanitize({ inspector: 'yes', integrations: { works: 1 } }).integrations.works === false);
  log('Unknown keys are dropped', !('evil' in sanitize({ evil: true })));

  const mem = memoryStorage();
  const a = createSettings(mem);
  let calls = 0;
  a.subscribe(() => { calls++; });
  a.update((s) => { s.notation = 'guided'; s.integrations.works = true; });
  log('update() notifies subscribers once', calls === 1, calls);
  log('update() changes the state', a.get().notation === 'guided' && a.get().integrations.works === true);
  const b = createSettings(mem);
  log('Settings persist to storage and load back', b.get().notation === 'guided' && b.get().integrations.works === true, mem.m.get('loom-settings'));

  mem.setItem('loom-settings', '{not json');
  log('A damaged stored record loads as defaults', createSettings(mem).get().notation === 'sysml');

  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const c = createSettings(throwing);
  c.update((s) => { s.inspector = false; });
  log('Blocked storage still works in memory', c.get().inspector === false);
  log('No storage at all works', createSettings(null).get().notation === 'sysml');
}
