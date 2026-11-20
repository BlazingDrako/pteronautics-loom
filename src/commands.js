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
 * }} Command
 */

export function createCommands() {
  /** @type {Map<string, Command>} */
  const byId = new Map();
  return {
    /** @param {Command} cmd */
    add(cmd) {
      if (byId.has(cmd.id)) throw new Error(`Duplicate command id: ${cmd.id}`);
      byId.set(cmd.id, cmd);
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
  const pressed = e.key === 'Backspace' && key === 'Delete' ? 'Delete' : e.key; // Backspace deletes too (Mac keyboards have no Delete key)
  return pressed.toLowerCase() === key.toLowerCase();
}
