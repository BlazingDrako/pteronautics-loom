// Preferences: how Loom looks (theme, accent, contrast, grid, notation), keyboard shortcuts
// (any command can be given a shortcut, or have its own changed), and your view presets.
// Preferences are yours, not the project's: they are kept in this browser and apply to every
// project. Changes take effect at once.
import { h, icon, formatKeys, IS_MAC, chosenTheme, setTheme } from './dom.js';
import { modal } from './dialog.js';
import { ACCENTS } from '../settings.js';
import { comboFromEvent, normalizeCombo } from '../commands.js';
import { presetsFor, PRESET_KINDS, kindLabel, viewFlags } from '../custom/presets.js';

/**
 * @param {{ settings: import('../settings.js').SettingsStore, commands: import('../commands.js').CommandRegistry }} ctx
 * @param {'look' | 'keys' | 'presets'} [tab]
 */
export function openPreferences(ctx, tab = 'look') {
  const { settings, commands } = ctx;
  let current = tab;
  let query = '';
  /** The command whose shortcut is being recorded, and a combo waiting for "use it anyway". */
  let recording = /** @type {string | null} */ (null);
  let pending = /** @type {{ id: string, combo: string } | null} */ (null);
  return modal({
    title: 'Preferences', ok: 'Done', wide: true, noCancel: true,
    build: () => {
      const body = h('div', { class: 'prefs' });
      const tabs = /** @type {const} */ ([['look', 'Appearance'], ['keys', 'Keyboard shortcuts'], ['presets', 'View presets']]);
      function paint() {
        const scroll = body.querySelector('.prefs-body')?.scrollTop || 0;
        body.replaceChildren(
          h('div', { class: 'seg prefs-tabs', role: 'tablist', 'aria-label': 'Preferences' }, tabs.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(current === id), 'aria-pressed': String(current === id), onclick: () => { current = id; recording = null; pending = null; paint(); } }, label))),
          h('div', { class: 'prefs-body' }, current === 'look' ? look() : current === 'keys' ? keys() : presets()));
        const b = body.querySelector('.prefs-body');
        if (b) b.scrollTop = scroll;
        if (recording) /** @type {HTMLElement | null} */ (body.querySelector('.key-rec'))?.focus();
      }

      // ---------- appearance ----------
      function look() {
        const st = settings.get();
        /** @param {string} label @param {[string, string][]} opts @param {string} cur @param {(v: string) => void} set @param {string} [note] */
        const seg = (label, opts, cur, set, note) => h('div', { class: 'field-label' }, label,
          h('div', { class: 'seg seg-full', role: 'group', 'aria-label': label }, opts.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(cur === v), onclick: () => { set(v); paint(); } }, l))),
          note ? h('small', {}, note) : null);
        return [
          seg('Theme', [['system', 'Same as the computer'], ['light', 'Light'], ['dark', 'Dark']], chosenTheme(), (v) => setTheme(/** @type {any} */ (v))),
          h('div', { class: 'field-label' }, 'Accent color',
            h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent color' }, ACCENTS.map((a) => h('button', {
              class: `swatch-btn acc-${a}`, type: 'button', role: 'radio', 'aria-checked': String(st.accent === a), 'aria-label': a[0].toUpperCase() + a.slice(1), title: a[0].toUpperCase() + a.slice(1),
              onclick: () => { settings.update((s) => { s.accent = a; }); paint(); },
            }, st.accent === a ? icon('check') : null))),
            h('small', {}, 'Buttons, selection and links. Blue is the Pteronautics accent.')),
          seg('Contrast', [['normal', 'Normal'], ['high', 'High']], st.contrast, (v) => settings.update((s) => { s.contrast = /** @type {any} */ (v); }), 'High contrast darkens text and lines, for bright rooms, projectors and low vision.'),
          seg('Density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], st.density, (v) => settings.update((s) => { s.density = /** @type {any} */ (v); }), 'Compact fits more of the model browser, toolbars and properties on the screen.'),
          seg('Notation', [['sysml', 'SysML'], ['v2', 'SysML v2'], ['guided', 'Guided']], st.notation, (v) => settings.update((s) => { s.notation = /** @type {any} */ (v); })),
          h('div', { class: 'opt' }, h('span', {}, 'Names in diagram palettes', h('small', {}, 'Show each tool\'s name beside its icon. Hover a tool for its name either way.')),
            h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(st.paletteLabels), 'aria-label': 'Names in diagram palettes', onclick: () => { settings.update((s) => { s.paletteLabels = !s.paletteLabels; }); paint(); } })),
          h('div', { class: 'opt' }, h('span', {}, 'Model browser', h('small', {}, `Drag its edge to resize it. ${'Mod+B'.replace('Mod', /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl')} hides it to give diagrams the whole window.`)),
            h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(st.sidebar), 'aria-label': 'Show the model browser', onclick: () => { settings.update((s) => { s.sidebar = !s.sidebar; }); paint(); } })),
          h('div', { class: 'opt' }, h('span', {}, 'Grid on diagrams', h('small', {}, 'The dots behind boxes. Snapping works either way.')),
            h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(st.grid), 'aria-label': 'Grid on diagrams', onclick: () => { settings.update((s) => { s.grid = !s.grid; }); paint(); } })),
        ];
      }

      // ---------- shortcuts ----------
      /** @param {string} id @param {string} combo */
      function assign(id, combo) {
        const users = commands.usersOf(combo, id);
        settings.update((s) => {
          for (const u of users) s.keys[u.id] = '';
          const c = commands.get(id);
          if (c && c.defaultKeys && normalizeCombo(c.defaultKeys) === normalizeCombo(combo)) delete s.keys[id]; else s.keys[id] = combo;
        });
        recording = null; pending = null;
        paint();
      }
      function keys() {
        const q = query.toLowerCase();
        const all = commands.list().filter((c) => !q || `${c.title} ${c.group} ${c.keys || ''} ${(c.keywords || []).join(' ')}`.toLowerCase().includes(q));
        const groups = [...new Set(all.map((c) => c.group))];
        const changed = Object.keys(settings.get().keys).length;
        const search = h('input', { class: 'field', type: 'search', placeholder: 'Find a command', value: query, 'aria-label': 'Find a command' });
        search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        search.addEventListener('input', () => { query = search.value; paint(); const s2 = /** @type {HTMLInputElement | null} */ (body.querySelector('input[type=search]')); s2?.focus(); s2?.setSelectionRange(s2.value.length, s2.value.length); });
        return [
          h('div', { class: 'rules-tools' }, search, changed ? h('button', { class: 'btn sm', type: 'button', onclick: () => { settings.update((s) => { s.keys = {}; }); paint(); } }, `Reset all (${changed} changed)`) : null),
          h('p', { class: 'muted small' }, `Click a shortcut to change it, then press the new keys. ${IS_MAC ? '⌘' : 'Ctrl'} works while you type in a field; other shortcuts do not. Esc cancels, Delete removes the shortcut.`),
          groups.map((g) => h('section', { class: 'rules-cat' }, h('div', { class: 'sec' }, g),
            all.filter((c) => c.group === g).map((c) => {
              const isChanged = c.id in settings.get().keys;
              const rec = recording === c.id;
              const keyBtn = h('button', { class: 'key-btn' + (rec ? ' key-rec' : ''), type: 'button', 'aria-label': rec ? `Press the new shortcut for ${c.title}` : `Change the shortcut for ${c.title}`, onclick: () => { recording = rec ? null : c.id; pending = null; paint(); } },
                rec ? (pending ? h('span', { class: 'kbd' }, formatKeys(pending.combo)) : h('span', { class: 'muted' }, 'Press keys…')) : c.keys ? h('span', { class: 'kbd' }, formatKeys(c.keys)) : h('span', { class: 'muted' }, 'None'));
              if (rec) keyBtn.addEventListener('keydown', (ev) => {
                if (ev.key === 'Tab') return;
                ev.preventDefault(); ev.stopPropagation();
                if (ev.key === 'Escape') { recording = null; pending = null; paint(); return; }
                if ((ev.key === 'Backspace' || ev.key === 'Delete') && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) { settings.update((s) => { if (c.defaultKeys) s.keys[c.id] = ''; else delete s.keys[c.id]; }); recording = null; paint(); return; }
                const combo = comboFromEvent(ev, IS_MAC);
                if (!combo) return;
                const users = commands.usersOf(combo, c.id);
                if (users.length && !(pending && pending.combo === combo)) { pending = { id: c.id, combo }; paint(); return; }
                assign(c.id, combo);
              });
              const users = rec && pending ? commands.usersOf(pending.combo, c.id) : [];
              return h('div', { class: 'rule-row' },
                h('div', { class: 'rule-text' }, h('b', {}, c.title),
                  users.length ? h('small', { class: 'warn' }, `${formatKeys(/** @type {string} */ (pending?.combo))} is used by ${users.map((u) => u.title).join(', ')}. Press it again to use it here instead.`) : null,
                  isChanged && !rec ? h('small', {}, c.defaultKeys ? `Normally ${formatKeys(c.defaultKeys)}` : 'Added by you') : null),
                keyBtn,
                isChanged ? h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Reset the shortcut for ${c.title}`, title: 'Back to the normal shortcut', onclick: () => { settings.update((s) => { delete s.keys[c.id]; }); recording = null; paint(); } }, icon('reset')) : h('span', { class: 'icon-spacer' }));
            }))),
        ];
      }

      // ---------- presets ----------
      function presets() {
        const st = settings.get();
        return [
          h('p', { class: 'muted small' }, 'A preset is a set of view options (compartments, labels, tags) for one kind of diagram. Save one from a diagram\'s View menu; apply it there to any diagram of that kind. The default is what new diagrams start with.'),
          PRESET_KINDS.map((kind) => {
            const list = presetsFor(kind, st.presets);
            const mine = list.filter((p) => !p.builtIn);
            const def = st.defaultPresets[kind] || '';
            const sel = h('select', { class: 'field sm', 'aria-label': `New ${kindLabel(kind).toLowerCase()}s start with` },
              h('option', { value: '' }, 'Everything (Loom\'s default)'), list.filter((p) => p.id !== `${kind}-all`).map((p) => h('option', { value: p.id, selected: p.id === def ? true : undefined }, p.name)));
            sel.addEventListener('change', () => settings.update((s) => { if (sel.value) s.defaultPresets[kind] = sel.value; else delete s.defaultPresets[kind]; }));
            return h('section', { class: 'rules-cat' }, h('div', { class: 'sec' }, kindLabel(kind)),
              h('div', { class: 'rule-row' }, h('div', { class: 'rule-text' }, h('b', {}, 'New diagrams start with'), h('small', {}, viewFlags(kind).map(([, l]) => l).join(' · '))), sel),
              mine.map((p) => {
                const name = h('input', { class: 'field sm', type: 'text', value: p.name, 'aria-label': 'Preset name', maxlength: 80 });
                name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
                name.addEventListener('change', () => { const v = name.value.trim(); if (v) settings.update((s) => { const x = s.presets.find((y) => y.id === p.id); if (x) x.name = v; }); });
                return h('div', { class: 'rule-row' },
                  h('div', { class: 'rule-text' }, name, h('small', {}, viewFlags(kind).filter(([k]) => p.props[k] !== false).map(([, l]) => l).join(' · ') || 'Nothing but names')),
                  h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': `Delete the preset ${p.name}`, title: 'Delete this preset', onclick: () => { settings.update((s) => { s.presets = s.presets.filter((y) => y.id !== p.id); if (s.defaultPresets[kind] === p.id) delete s.defaultPresets[kind]; }); paint(); } }, icon('x')));
              }));
          }),
        ];
      }

      paint();
      return { body, value: () => true };
    },
  });
}
