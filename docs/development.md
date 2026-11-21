# Developing Loom

Loom is plain ES modules with JSDoc types: no build step, no dependencies, no package manager.
Python 3 serves it locally; any static host serves it in production.

## Run, test, measure

| What | How |
| --- | --- |
| Run | `python3 serve.py` → http://localhost:8800 (`python3 serve.py 8801 --no-browser` for another port) |
| Tests | http://localhost:8800/tests/ runs every suite; results are left in `window.__results`. `?only=release` runs one suite by its id |
| Benchmarks | http://localhost:8800/tests/bench.html, against the budgets in [PLAN.md](../PLAN.md) section 6 |
| Types | `npx -p typescript tsc --noEmit -p jsconfig.json` (needs Node, as a check only) |

The local server sends `Cache-Control: no-store`, so a reload always shows your edits. The
service worker fetches from the network first, so it does not get in the way either.

## How the code is arranged

```
model/       the element graph, transactions, undo; the metamodel; files; samples
text/        SysML v2 text: lexer, parser, printer, name resolution, text → model
canvas/      diagrams: one module per diagram kind for what it shows, plus the canvas views
views/       non-diagram views: Systems V, trace, table, matrix, library
analysis/    units, expressions, the parametric solver, live requirement checks
sim/         running activities, state machines and sequences
validate/    rules, the engine, and the worker that runs them in the background
custom/      stereotypes and view presets
interop/     ReqIF, CSV/Excel, Cameo XMI, the SysML v2 API, documents
storage/     projects (IndexedDB), project folders, zip
ui/          the shell: home, workspace, browser tree, inspector, dialogs, panels
pwa.js       the service worker registration, install prompt and files opened with the app
```

Rules of the road:

- **Every edit is a transaction.** `model.transact(label, (tx) => …)` is the only way to change
  the model; it records the inverse for undo and tells subscribers which ids changed.
- **Views derive from the model.** A view keeps no model state of its own; on a change event it
  re-renders (diagrams cache geometry by element and invalidate on change).
- **Pure modules stay pure.** `model/`, `text/`, `analysis/`, `sim/` and `validate/` never
  touch the DOM, so they run in tests, in workers and in documents alike. The validation worker
  imports the rules directly. (`interop/` reads XML with the browser's `DOMParser`, so it runs on
  the page.)
- **Text fits its box.** Labels are measured (`canvas/measure.js`) and ellipsized; panels use
  `min-width: 0` and container queries. Check narrow widths.

## The validation worker

`validate/worker.js` holds a copy of the model. `createValidator(model, { worker: true })` sends
the whole model once, then after each edit (debounced 250 ms) only the elements whose ids the
change event named, with their depth and place among their siblings; the copy applies them with
`model.patch`. Problems come back without their fix functions (they cannot be sent between
threads); `fixRun(model, problem)` finds the fix again when it is used. Without workers the same
rules run on the page.

## The offline app

`sw.js` is generated: run `python3 tools/precache.py` after adding, removing or changing files.
It lists every app file and names the cache after the version and a hash of the files. The
release tests fail if a module the app loads is missing from the list or a listed file is gone.
Edit `tools/sw.template.js`, not `sw.js`.

## Adding things

- **A rule:** add it to `RULES` in `validate/rules.js` (per kind with `check`, or model-wide
  with `all`), give it a category, help text and the rule sets it belongs to, and add a test in
  `tests/loom/custom.tests.js`. Fixes are `{ label, run(m, tx) }`.
- **An element kind:** `model/metamodel.js` (names in each notation, what may own it, its
  properties), then the printer and parser in `text/`, the diagram modules that show it, and a
  library entry in `library/entries.js`. The text round-trip tests catch most omissions.
- **A sample:** add a builder to `model/samples.js` and an entry to `SAMPLES`. The release tests
  build, validate, save, reopen and round-trip every sample through SysML text.

## Releasing

1. Set the version in `src/version.js`.
2. `python3 tools/precache.py` and `python3 desktop/stage.py` (which also sets the Tauri and
   Cargo versions).
3. Run the tests and the benchmarks; update README and PLAN.
4. Commit. Hosting is any static host serving the folder (for example GitHub Pages); exclude
   `tests/` and `desktop/` if you like, nothing in the app needs them.
