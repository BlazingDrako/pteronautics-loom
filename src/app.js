// Pteronautics Loom: startup, commands and keyboard shortcuts.
import { initTheme, toggleTheme, toast, formatKeys, IS_MAC } from './ui/dom.js';
import { createSettings } from './settings.js';
import { createCommands } from './commands.js';
import { mountShell } from './ui/shell.js';
import { openPalette, isPaletteOpen } from './ui/palette.js';

initTheme();
const settings = createSettings();
const commands = createCommands();

commands.add({ id: 'palette.open', title: 'Open the command palette', group: 'General', keys: 'Mod+K', run: () => openPalette(commands) });
commands.add({ id: 'theme.toggle', title: 'Switch light / dark theme', group: 'View', keywords: ['dark mode', 'light mode', 'appearance'], run: toggleTheme });
commands.add({ id: 'view.inspector', title: 'Show or hide the inspector', group: 'View', keys: 'Mod+.', keywords: ['properties', 'panel'], run: () => settings.update((s) => { s.inspector = !s.inspector; }) });
commands.add({ id: 'notation.sysml', title: 'Notation: SysML', group: 'View', keywords: ['stereotype', 'expert'], run: () => settings.update((s) => { s.notation = 'sysml'; }) });
commands.add({ id: 'notation.guided', title: 'Notation: Guided (plain words)', group: 'View', keywords: ['beginner', 'newcomer', 'simple'], run: () => settings.update((s) => { s.notation = 'guided'; }) });
commands.add({
  id: 'integrations.works', title: 'Turn the Pteronautics Works link on or off', group: 'Integrations', keywords: ['works', 'integration', 'link'],
  run: () => {
    settings.update((s) => { s.integrations.works = !s.integrations.works; });
    toast(settings.get().integrations.works ? 'Pteronautics Works link turned on' : 'Pteronautics Works link turned off');
  },
});
commands.add({
  id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', keywords: ['keys', 'hotkeys'],
  run: () => toast(commands.list().filter((c) => c.keys).map((c) => `${formatKeys(/** @type {string} */ (c.keys))} ${c.title}`).join('   ·   ')),
});
commands.add({ id: 'help.library', title: 'Open the SysML library', group: 'Help', keys: '?', keywords: ['reference', 'help', 'docs'], enabled: () => false, run: () => {} });
commands.add({ id: 'model.new-package', title: 'New package', group: 'Model', keywords: ['create', 'add'], enabled: () => false, run: () => {} });
commands.add({ id: 'model.new-part-def', title: 'New part definition (block)', group: 'Model', keywords: ['create', 'add', 'block'], enabled: () => false, run: () => {} });
commands.add({ id: 'model.new-requirement', title: 'New requirement', group: 'Model', keywords: ['create', 'add', 'req'], enabled: () => false, run: () => {} });

addEventListener('keydown', (e) => {
  // typing in a field never triggers single-key shortcuts such as "?"
  const t = /** @type {HTMLElement} */ (e.target);
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (isPaletteOpen()) return;
  const cmd = commands.forEvent(e, IS_MAC);
  if (!cmd || (typing && !cmd.keys?.startsWith('Mod'))) return;
  e.preventDefault();
  if (!commands.run(cmd.id)) toast(`${cmd.title} is not available yet`);
});

const app = document.getElementById('app');
if (app) mountShell(app, { settings, commands });
