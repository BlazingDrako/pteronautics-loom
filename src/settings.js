// User settings: kept in localStorage, with defaults. Integrations are OFF by default.

/**
 * @typedef {'sysml' | 'v2' | 'guided'} Notation
 * @typedef {{
 *   notation: Notation,
 *   inspector: boolean,
 *   integrations: { works: boolean },
 * }} Settings
 */

const KEY = 'loom-settings';

/** @returns {Settings} */
export function defaults() {
  return { notation: 'sysml', inspector: true, integrations: { works: false } };
}

/**
 * Merge stored values over the defaults, keeping only known keys with the right types,
 * so a damaged or old settings record can never break the app.
 * @param {unknown} raw @returns {Settings}
 */
export function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  const r = /** @type {Record<string, any>} */ (raw);
  if (r.notation === 'sysml' || r.notation === 'v2' || r.notation === 'guided') d.notation = r.notation;
  if (typeof r.inspector === 'boolean') d.inspector = r.inspector;
  if (r.integrations && typeof r.integrations.works === 'boolean') d.integrations.works = r.integrations.works;
  return d;
}

/**
 * A small settings store. Storage can be swapped for tests.
 * @param {{ getItem(k: string): string | null, setItem(k: string, v: string): void } | null} [storage]
 */
export function createSettings(storage = safeLocalStorage()) {
  /** @type {Settings} */
  let state = load();
  /** @type {Set<(s: Settings) => void>} */
  const subs = new Set();

  function load() {
    try { return sanitize(JSON.parse(storage?.getItem(KEY) || 'null')); } catch { return defaults(); }
  }
  function save() {
    try { storage?.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked: keep working in memory */ }
  }
  return {
    /** @returns {Settings} */
    get: () => state,
    /** Apply a change and notify subscribers. @param {(s: Settings) => void} fn */
    update(fn) {
      const next = sanitize(JSON.parse(JSON.stringify(state)));
      fn(next);
      state = sanitize(next);
      save();
      subs.forEach((f) => f(state));
    },
    /** @param {(s: Settings) => void} fn @returns {() => void} */
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

/** @typedef {ReturnType<typeof createSettings>} SettingsStore */

function safeLocalStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
