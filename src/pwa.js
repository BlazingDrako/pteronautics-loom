// Loom as an installed app: the service worker that keeps it working offline, the browser's
// install prompt (offered as a command and on the Home page), and files opened with the
// installed app (from the desktop, or "Open with" a .sysml or .loom.json file).

/** @type {any} */
let deferred = null;
/** @type {Set<() => void>} */
const subs = new Set();
const tell = () => subs.forEach((f) => f());

/** Is Loom running as an installed app (its own window)? */
export const installed = () => typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches);

/** Can Loom be installed right now (the browser offered it, and it is not installed)? */
export const canInstall = () => !!deferred && !installed();

/** Show the browser's install prompt. @returns {Promise<boolean>} whether it was installed */
export async function install() {
  if (!deferred) return false;
  const d = deferred; deferred = null; tell();
  d.prompt();
  const { outcome } = await d.userChoice;
  return outcome === 'accepted';
}

/** @param {() => void} fn @returns {() => void} */
export function onInstallChange(fn) { subs.add(fn); return () => subs.delete(fn); }

/**
 * Start the offline app: register the service worker (not on file:// or in the tests), listen
 * for the install prompt, and hand files the app is opened with to `openFiles`.
 * @param {{ openFiles: (files: File[]) => void, notify?: (text: string) => void }} o
 */
export function startPwa(o) {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; tell(); });
  addEventListener('appinstalled', () => { deferred = null; tell(); o.notify?.('Loom is installed. Open it from your apps, even offline.'); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !location.pathname.includes('/tests/')) {
    const first = !navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      if (!first) return;
      // the first time: say so once the files are cached
      const w = reg.installing || reg.waiting;
      w?.addEventListener('statechange', () => { if (w.state === 'activated') o.notify?.('Loom now works offline'); });
    }).catch(() => { /* offline use is a bonus; the app works without it */ });
  }
  const lq = /** @type {any} */ (globalThis).launchQueue;
  if (lq && typeof lq.setConsumer === 'function') {
    lq.setConsumer(async (/** @type {{ files?: FileSystemFileHandle[] }} */ params) => {
      if (!params.files?.length) return;
      const files = await Promise.all(params.files.map((fh) => fh.getFile()));
      o.openFiles(files);
    });
  }
}
