// The command registry. Everything Loom can do is a command, so the palette, menus and
// keyboard shortcuts all go through one place, and shortcuts can be remapped later.

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   group: string,
 *   keys?: string,            // e.g. "Mod+K", "Shift+?"; matched by matchKeys()
 *   keywords?: string[],      // extra words the palette search matches
 *   enabled?: () => boolean,  // false shows the command greyed out
 *   run: () => void,
 *   defaultKeys?: string,     // the shortcut it comes with (keys is the one in use)
 * }} Command
 */

export function createCommands() {
  /** @type {Map<string, Command>} */
  const byId = new Map();
  /** Shortcut changes: command id → combo ('' = no shortcut). @type {Record<string, string>} */
  let overrides = {};
  /** @param {Command} c */
  const applyTo = (c) => { const o = overrides[c.id]; c.keys = o === undefined ? c.defaultKeys : o || undefined; };
  return {
    /** @param {Command} cmd */
    add(cmd) {
      if (byId.has(cmd.id)) throw new Error(`Duplicate command id: ${cmd.id}`);
      if (!('defaultKeys' in cmd)) cmd.defaultKeys = cmd.keys;
      byId.set(cmd.id, cmd);
      applyTo(cmd);
    },
    /** Use these shortcut changes (from settings). @param {Record<string, string>} o */
    setOverrides(o) { overrides = { ...o }; byId.forEach(applyTo); },
    /**
     * Commands already using a combo (to warn before taking it).
     * @param {string} combo @param {string} [except] a command id to leave out @returns {Command[]}
     */
    usersOf(combo, except) {
      const k = normalizeCombo(combo);
      return [...byId.values()].filter((c) => c.id !== except && c.keys && normalizeCombo(c.keys) === k);
    },
    /** @param {string} id */
    get: (id) => byId.get(id),
    /** @returns {Command[]} */
    list: () => [...byId.values()],
    /** Run a command by id. Returns false if it is missing or disabled. @param {string} id */
    run(id) {
      const c = byId.get(id);
      if (!c || (c.enabled && !c.enabled())) return false;
      c.run();
      return true;
    },
    /**
     * Find the command bound to a keyboard event.
     * @param {{ key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean }} e
     * @param {boolean} isMac
     */
    forEvent(e, isMac) {
      for (const c of byId.values()) if (c.keys && matchKeys(c.keys, e, isMac)) return c;
      return undefined;
    },
  };
}

/** @typedef {ReturnType<typeof createCommands>} CommandRegistry */

/**
 * Does a keyboard event match a combo such as "Mod+K" or "Shift+?"?
 * "Mod" is ⌘ on macOS and Ctrl elsewhere.
 * @param {string} combo
 * @param {{ key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean }} e
 * @param {boolean} isMac
 */
export function matchKeys(combo, e, isMac) {
  const parts = combo.split('+');
  const key = parts.pop() || '';
  const want = new Set(parts);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (want.has('Mod') !== mod) return false;
  if (want.has('Alt') !== e.altKey) return false;
  // Shift is implied by characters such as "?", so it is only checked for letters, digits
  // and named keys: Mod+Z must not fire on Mod+Shift+Z
  if (want.has('Shift') && !e.shiftKey) return false;
  if (!want.has('Shift') && e.shiftKey && /^([a-z0-9]|F\d+|Delete|Backspace|Enter)$/i.test(key)) return false;
  if (!isMac && !want.has('Mod') && e.ctrlKey) return false;
  if (isMac && !want.has('Mod') && e.metaKey) return false;
  let pressed = e.key === 'Backspace' && key === 'Delete' ? 'Delete' : e.key === ' ' ? 'Space' : e.key; // Backspace deletes too (Mac keyboards have no Delete key)
  // ⌥ changes the character typed on macOS; match the physical key instead
  const code = /** @type {any} */ (e).code;
  if (e.altKey && typeof code === 'string' && /^(Key[A-Z]|Digit\d)$/.test(code)) pressed = code.replace(/^(Key|Digit)/, '');
  return pressed.toLowerCase() === key.toLowerCase();
}

/** A combo in a standard order (Mod, Shift, Alt, then the key), so two spellings compare equal. @param {string} combo */
export function normalizeCombo(combo) {
  const parts = combo.split('+');
  const key = parts.pop() || '';
  const mods = ['Mod', 'Shift', 'Alt'].filter((m) => parts.includes(m));
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
}

/**
 * The combo a key press stands for, for recording a new shortcut; null for a modifier alone.
 * @param {{ key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean, code?: string }} e
 * @param {boolean} isMac
 */
export function comboFromEvent(e, isMac) {
  if (['Meta', 'Control', 'Shift', 'Alt', 'CapsLock', 'Dead'].includes(e.key)) return null;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  let key = e.key === ' ' ? 'Space' : e.key === 'Backspace' ? 'Delete' : e.key;
  // with Alt held, macOS types a special character: use the key itself (⌥K is Alt+K, not ˚)
  if (e.altKey && e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  if (e.altKey && e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (key.length === 1) key = key.toUpperCase();
  // Shift is part of characters like "?" already
  const shift = e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key));
  return [mod ? 'Mod' : '', shift ? 'Shift' : '', e.altKey ? 'Alt' : '', key].filter(Boolean).join('+');
}
