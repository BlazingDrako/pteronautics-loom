# Loom on the desktop

Loom runs in any modern browser. There are three ways to have it as an app of its own.

## 1. Install it from the browser (recommended)

Open Loom (`python3 serve.py`, or wherever it is hosted) in Chrome, Edge or Arc and choose
**Install app** on the Home page, or *Install Loom as an app* in the command palette (Mod+K).
Safari: **File → Add to Dock**.

The installed app:

- opens in its own window, from the Dock, Start menu or app launcher;
- **works offline**: every file Loom needs is kept by its service worker, and while online it
  still fetches the newest files first, so updates arrive on the next launch;
- opens files you hand it, where the browser supports it: `.loom.json` and `.zip` projects,
  `.sysml` text, Cameo `.mdzip` and `.xmi`, and ReqIF. Each becomes a project;
- has a **New project** shortcut on its icon's menu.

Projects stay in the browser's storage for that site, the same ones you see in the browser tab.

## 2. The macOS launcher

`Pteronautics Loom.app` in the project folder starts the local server and opens Loom in your
browser, like the Atlas launcher. Double-click it (the first time: right-click → Open). It needs
Python 3. Quit it from the Dock to stop the server. Combine it with **Install app** for a
windowed, offline Loom.

## 3. A native build with Tauri

`desktop/tauri/` is a [Tauri 2](https://tauri.app) project that wraps the same files in a native
window, with a real app bundle and installer for macOS, Windows and Linux.

```bash
python3 desktop/stage.py           # copy the app into desktop/tauri/dist and set the version
cd desktop/tauri
cargo install tauri-cli --version "^2"
cargo tauri build                  # or: cargo tauri dev
```

You need Rust (https://rustup.rs) and, on Linux, the WebKitGTK packages Tauri lists.

What differs from the browser:

- Tauri uses the system web view (WebKit on macOS and Linux, WebView2 on Windows). On WebKit
  there is no *Open folder*; use Import and Export `.zip` for SysML text.
- Downloads (exports, documents) depend on the web view: WebView2 saves them; WebKit may need a
  save dialog added through Tauri's dialog plugin.
- The service worker is not used: the files are already inside the app.

This build has not been run yet: Rust is not part of Loom's toolchain, and the configuration is
checked only by the test suite (name, version, icons). Treat it as a starting point.
