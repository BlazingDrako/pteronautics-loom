# Pteronautics Loom

**Pteronautics Loom** is the systems engineering program of the Pteronautics family. It is a model-based systems engineering (MBSE) tool built on SysML. You model requirements, functions, architecture and physical parts (RFLP), trace them end to end, and verify them, in a fast, good-looking app that runs in the browser.

## The Pteronautics family

| Program | What it's for |
| --- | --- |
| **Pteronautics Atlas** | Learn how the physics works, one concept at a time, each with a live visual |
| **Pteronautics Works** | Design whole vehicles on the same validated solvers, coupled together |
| **Pteronautics Loom** (this repository, in development) | Model the system: requirements, functions, logical and physical architecture, interfaces and verification, in SysML |

They are separate programs under the Pteronautics name. Loom stands on its own: linking Pteronautics Works is an optional integration, **off by default**.

## What works today (0.1.0, the skeleton)

- The app shell in the Pteronautics design language: a sidebar with the four RFLP layers and the views, a top bar, the diagram stage, the inspector and a status bar. Light and dark themes, and a layout that stacks at phone width.
- **Command palette** (⌘K / Ctrl+K): fuzzy search over every command, with keyboard navigation. Every action in Loom is a command, so shortcuts and menus stay in one place.
- **Notation**: SysML (standard vocabulary) or Guided (plain words for newcomers). For now this switches the welcome text; it will drive every diagram.
- **Integrations**: the Pteronautics Works switch (off by default), saved with your settings.
- Show or hide the inspector (⌘. / Ctrl+.).

**Not built yet:** the model itself (packages, parts, requirements, relationships), diagrams, tables, matrices, the RFLP trace view, the Systems V home and the SysML library. These are marked "soon" in the app. See [PLAN.md](PLAN.md) for the full build plan and milestones.

## Run it

- **macOS:** double-click `start.command` (first time: right-click → Open).
- **Windows:** double-click `start.bat`.
- **Any system:** `python3 serve.py`, then open http://localhost:8800

Plain ES modules, no build step, no dependencies. Python 3 is the only requirement; browsers need a local server for modules. Atlas uses port 8765 and Works 8790, so all three can run side by side. `python3 serve.py 9000 --no-browser` picks another port and skips opening the browser.

## Tests

Open http://localhost:8800/tests/ with the server running. It runs the settings, command and shortcut, and fuzzy search tests. Results are also left in `window.__results`.

### Type checking (optional, for development)

The code carries JSDoc types. With Node installed:

```bash
npx -p typescript tsc --noEmit -p jsconfig.json
```

Loom never needs Node to run; this is only a check.

## Layout

```
index.html, css/loom.css     app page and styles (design tokens shared with Atlas and Works)
src/app.js                   startup, commands and keyboard shortcuts
src/commands.js              the command registry and shortcut matching
src/settings.js              user settings with safe defaults (integrations off)
src/ui/shell.js              the window: sidebar, top bar, stage, inspector, status bar
src/ui/palette.js            the command palette
src/ui/fuzzy.js              fuzzy matching and ranking
src/ui/dom.js                DOM helpers, icons, brand, theme
tests/                       test page, runner and Loom tests
PLAN.md                      the build plan
```

## License

Copyright (C) 2026 Andrew Aguiar. Pteronautics Loom is free software under the **GNU General Public License v3.0** (see `LICENSE` and `COPYRIGHT`), the same license as Atlas and Works. The bundled fonts are under the SIL Open Font License (see `assets/fonts/`).
