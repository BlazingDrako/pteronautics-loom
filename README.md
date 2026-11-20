# Pteronautics Loom

**Pteronautics Loom** is the systems engineering program of the Pteronautics family. It is a model-based systems engineering (MBSE) tool built on SysML. You model requirements, functions, architecture and physical parts (RFLP), trace them end to end, and verify them, in a fast, good-looking app that runs in the browser.

## The Pteronautics family

| Program | What it's for |
| --- | --- |
| **Pteronautics Atlas** | Learn how the physics works, one concept at a time, each with a live visual |
| **Pteronautics Works** | Design whole vehicles on the same validated solvers, coupled together |
| **Pteronautics Loom** (this repository, in development) | Model the system: requirements, functions, logical and physical architecture, interfaces and verification, in SysML |

They are separate programs under the Pteronautics name. Loom stands on its own: linking Pteronautics Works is an optional integration, **off by default**.

## What works today (0.2.0: Home and the model core)

- **Home page**: your projects as cards (elements per RFLP layer, traces, last edit), **New project** (blank, or the Kestrel UAS sample), **Import** and **Export** `.loom.json` files, rename, duplicate and delete. Projects are saved on this device (IndexedDB); if the browser blocks storage, Loom still works for the session and says so.
- **The model core**: the SysML element kinds (package, requirement, test case, function, block, interface block, part, port, value property, comment) and relationships (satisfy, verify, derive, refine, allocate, generalization, trace), with the ownership and relationship rules enforced. Every edit is a transaction with **unlimited undo and redo** (⌘Z / ⌘⇧Z). Deleting an element removes everything inside it and every relationship touching it, and undo brings it all back.
- **Model browser**: the four RFLP layers as a tree. Click to select, double-click or F2 to rename, Delete to delete, **drag onto another element to move it** (illegal moves are refused), + to add inside, arrow keys to move around.
- **Inspector**: name, description and every property of the selected element (requirement ID, text, priority and verification method; part and port types; port direction and conjugation; values and units), its location, what it contains, and its relationships. You can add or remove relationships from here.
- **Command palette** (⌘K): every command, plus jump-to-element by name.
- **Notation**: SysML (Block, Part property…), SysML v2 (part def, part…) or Guided (Part type, Part…), switched live.
- **Autosave** a moment after every change, plus the Pteronautics Works switch (off by default) and light and dark themes.

**Not built yet:** diagrams, tables and matrices, the RFLP trace view, the Systems V home, the SysML library and SysML v2 text files. These are marked "soon" in the app. See [PLAN.md](PLAN.md).

## Run it

- **macOS:** double-click `start.command` (first time: right-click → Open).
- **Windows:** double-click `start.bat`.
- **Any system:** `python3 serve.py`, then open http://localhost:8800

Plain ES modules, no build step, no dependencies. Python 3 is the only requirement; browsers need a local server for modules. Atlas uses port 8765 and Works 8790, so all three can run side by side. `python3 serve.py 9000 --no-browser` picks another port and skips opening the browser.

## Tests

Open http://localhost:8800/tests/ with the server running. It runs the settings, commands and shortcuts, fuzzy search, model core, and files/import/export/projects tests. Results are also left in `window.__results`.

### Type checking (optional, for development)

The code carries JSDoc types. With Node installed:

```bash
npx -p typescript tsc --noEmit -p jsconfig.json
```

Loom never needs Node to run; this is only a check.

## Layout

```
index.html, css/loom.css     app page and styles (design tokens shared with Atlas and Works)
src/app.js                   startup, routing (#/ home, #/p/<id> project), commands and shortcuts
src/commands.js              the command registry and shortcut matching
src/settings.js              user settings with safe defaults (integrations off)
src/model/metamodel.js       element and relationship kinds, ownership rules, names per notation
src/model/model.js           the element graph, transactions, undo and redo
src/model/serialize.js       snapshots and the .loom.json file format, with full checking on load
src/model/sample.js          the Kestrel UAS sample model
src/storage/projects.js      projects on this device (IndexedDB, memory fallback), import and export
src/ui/home.js               the Home page
src/ui/workspace.js          a project's window: browser, overview, inspector, status bar
src/ui/tree.js               the model browser
src/ui/inspector.js          the inspector
src/ui/palette.js            the command palette
src/ui/dialog.js, menu.js    dialogs and popup menus
src/ui/fuzzy.js              fuzzy matching and ranking
src/ui/dom.js                DOM helpers, icons, brand, theme
tests/                       test page, runner and Loom tests
PLAN.md                      the build plan
```

## License

Copyright (C) 2026 Andrew Aguiar. Pteronautics Loom is free software under the **GNU General Public License v3.0** (see `LICENSE` and `COPYRIGHT`), the same license as Atlas and Works. The bundled fonts are under the SIL Open Font License (see `assets/fonts/`).
