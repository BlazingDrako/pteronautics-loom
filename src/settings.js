// User settings: kept in localStorage, with defaults. Integrations are OFF by default.

/**
 * @typedef {'sysml' | 'v2' | 'guided'} Notation
 * @typedef {{ id: string, name: string, kind: string, props: Record<string, boolean> }} Preset  saved view options for a kind of diagram
 * @typedef {{
 *   notation: Notation,
 *   inspector: boolean,
 *   textPane: boolean,      // the SysML v2 text beside the open view
 *   textWidth: number,      // its width in pixels
 *   problems: boolean,      // the problems panel under the open view
 *   problemsH: number,      // its height in pixels
 *   accent: string,         // an ACCENTS id
 *   contrast: 'normal' | 'high',
 *   grid: boolean,          // the dot grid on diagrams
 *   keys: Record<string, string>,          // shortcut changes: command id → combo ('' = none)
 *   presets: Preset[],                     // the user's own view presets
 *   defaultPresets: Record<string, string>, // diagram kind → preset id new diagrams start with
 *   integrations: { works: boolean },
 * }} Settings
 */

/** Accent colors (the first is the Pteronautics blue). */
export const ACCENTS = ['blue', 'teal', 'violet', 'green', 'amber', 'coral', 'pink', 'slate'];
const COMBO = /^((Mod|Shift|Alt)\+){0,3}([A-Za-z0-9]|F\d{1,2}|Delete|Backspace|Enter|Escape|Tab|Space|Arrow(Up|Down|Left|Right)|[!-/:-@[-`{-~])$/;
/** Is this a combo Loom can bind ("Mod+Shift+K", "F8", "?")? @param {unknown} v */
export const isCombo = (v) => typeof v === 'string' && COMBO.test(v);

const KEY = 'loom-settings';

/** @returns {Settings} */
export function defaults() {
  return {
    notation: 'sysml', inspector: true, textPane: false, textWidth: 460, problems: false, problemsH: 220,
    accent: 'blue', contrast: 'normal', grid: true, keys: {}, presets: [], defaultPresets: {},
    integrations: { works: false },
  };
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
  if (typeof r.textPane === 'boolean') d.textPane = r.textPane;
  if (typeof r.textWidth === 'number' && Number.isFinite(r.textWidth)) d.textWidth = Math.round(Math.min(1200, Math.max(280, r.textWidth)));
  if (typeof r.problems === 'boolean') d.problems = r.problems;
  if (typeof r.problemsH === 'number' && Number.isFinite(r.problemsH)) d.problemsH = Math.round(Math.min(800, Math.max(120, r.problemsH)));
  if (ACCENTS.includes(r.accent)) d.accent = r.accent;
  if (r.contrast === 'normal' || r.contrast === 'high') d.contrast = r.contrast;
  if (typeof r.grid === 'boolean') d.grid = r.grid;
  if (r.keys && typeof r.keys === 'object') for (const [id, v] of Object.entries(r.keys)) if (/^[\w.:-]{1,80}$/.test(id) && (v === '' || isCombo(v))) d.keys[id] = /** @type {string} */ (v);
  if (Array.isArray(r.presets)) for (const p of r.presets.slice(0, 100)) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[\w-]{1,40}$/.test(p.id) || typeof p.kind !== 'string' || !/^\w{1,20}$/.test(p.kind)) continue;
    /** @type {Record<string, boolean>} */
    const props = {};
    if (p.props && typeof p.props === 'object') for (const [k, v] of Object.entries(p.props)) if (/^\w{1,40}$/.test(k) && typeof v === 'boolean') props[k] = v;
    d.presets.push({ id: p.id, name: String(p.name || 'Preset').slice(0, 80), kind: p.kind, props });
  }
  if (r.defaultPresets && typeof r.defaultPresets === 'object') for (const [k, v] of Object.entries(r.defaultPresets)) if (/^\w{1,20}$/.test(k) && typeof v === 'string' && v.length < 60) d.defaultPresets[k] = v;
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
