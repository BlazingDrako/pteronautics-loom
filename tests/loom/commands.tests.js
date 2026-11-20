import { createCommands, matchKeys } from '../../src/commands.js';

/** @param {Partial<KeyboardEvent>} p */
const ev = (p) => ({ key: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...p });

/** @param {import('../run.js').Log} log */
export function commandsTests(log) {
  const reg = createCommands();
  let ran = 0;
  reg.add({ id: 'a', title: 'Alpha', group: 'G', keys: 'Mod+K', run: () => { ran++; } });
  reg.add({ id: 'off', title: 'Disabled', group: 'G', enabled: () => false, run: () => { ran += 100; } });
  reg.add({ id: 'help', title: 'Help', group: 'G', keys: '?', run: () => {} });

  let threw = false;
  try { reg.add({ id: 'a', title: 'Again', group: 'G', run: () => {} }); } catch { threw = true; }
  log('Duplicate command ids are refused', threw);
  log('run() runs an enabled command', reg.run('a') === true && ran === 1, ran);
  log('run() refuses a disabled command', reg.run('off') === false && ran === 1, ran);
  log('run() returns false for an unknown id', reg.run('nope') === false);
  log('list() returns every command', reg.list().length === 3);

  log('Mod+K matches ⌘K on macOS', matchKeys('Mod+K', ev({ key: 'k', metaKey: true }), true));
  log('Mod+K matches Ctrl+K elsewhere', matchKeys('Mod+K', ev({ key: 'k', ctrlKey: true }), false));
  log('Mod+K does not match plain K', !matchKeys('Mod+K', ev({ key: 'k' }), true));
  log('Mod+K does not match Ctrl+K on macOS', !matchKeys('Mod+K', ev({ key: 'k', ctrlKey: true }), true));
  log('"?" matches Shift+/ (the key is "?")', matchKeys('?', ev({ key: '?', shiftKey: true }), true));
  log('"?" does not match ⌘?', !matchKeys('?', ev({ key: '?', shiftKey: true, metaKey: true }), true));
  log('Alt must match exactly', !matchKeys('Mod+K', ev({ key: 'k', metaKey: true, altKey: true }), true));
  log('forEvent finds the bound command', reg.forEvent(ev({ key: 'K', metaKey: true }), true)?.id === 'a');
  log('forEvent ignores unbound keys', reg.forEvent(ev({ key: 'j', metaKey: true }), true) === undefined);
}
