# Pteronautics Loom: build plan

Loom is the systems engineering program of the Pteronautics family. It is a model-based systems engineering (MBSE) tool built on SysML. It runs in the browser, works offline, and can be installed as a desktop app. It aims to do the core work people use Cameo for, but faster, better looking and easier to learn.

| Program | What it's for |
| --- | --- |
| Pteronautics Atlas | Learn the physics, one concept at a time |
| Pteronautics Works | Design whole vehicles on coupled solvers |
| **Pteronautics Loom** | Model the system: requirements, functions, architecture, interfaces and verification |

Design mockup (five screens: workspace, Systems V, RFLP trace, requirements, library): https://claude.ai/artifact/GucPyhafgDe8fZ8u8V2uLD

---

## 1. Principles

1. **Loom stands on its own.** Pteronautics Works is an optional integration, **off by default**, turned on per project under Integrations. With it off, nothing in Loom depends on, mentions or loads Works.
2. **The model is the truth; diagrams are views.** Every diagram, table, matrix and text file shows the same model. Removing something from a view never deletes it from the model unless you ask.
3. **Cameo-level depth.** Nested parts several levels deep, compartments, proxy and full ports, conjugation, item flows, all the SysML diagram types, matrices and tables, and models with tens of thousands of elements.
4. **Easy for newcomers, quick for experts.** Two notations over one model:
   - **SysML**: «stereotypes», `: Type`, strict vocabulary.
   - **Guided**: plain words ("Part", "is a…", "Properties").

   Context help (`?`) and a built-in SysML/MBSE library are always one keystroke away. Experts get a command palette, keyboard shortcuts and the text notation.
5. **Connections feel fluid.** Drag from a port and compatible ports light up. The route is drawn orthogonally for you, labels place themselves, and moving a block re-routes its lines.
6. **Highly customizable.**
   - View options per diagram, saved as reusable presets.
   - Profiles and stereotypes with your own icons, colors and tagged values.
   - Custom table and matrix columns.
   - Validation rule sets, themes and remappable shortcuts.
7. **Fast, with numbers to hold it to.** See the performance budgets in section 6.
8. **The Pteronautics design language**: Space Grotesk and JetBrains Mono, the shared color tokens, light and dark themes, and the same brand mark with the product name LOOM.

## 2. Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Language | Plain ES modules, **no build step**. Types written as JSDoc and checked with `tsc --noEmit` (a dev-only check that needs Node; it is never needed to run Loom). | Same as Atlas and Works: host the folder as-is, nothing to install. Type checking keeps a large codebase safe. |
| UI | No framework. A small keyed DOM/SVG renderer of our own (as Works does with `h()`). | Full control over performance, no dependencies, no build. |
| Diagram rendering | **SVG**, with viewport culling and level-of-detail. Canvas/WebGL only if benchmarks demand it. | Crisp text and easy hit-testing and accessibility. A real SysML diagram has hundreds to low thousands of shapes, which SVG handles at 60 fps with culling. |
| Heavy work | A Web Worker handles validation, text parsing, layout, import and search indexing. | Keeps the canvas at 60 fps. |
| Model standard | **SysML v2 semantics internally**, with SysML v1 diagram vocabulary on top. | v2 is the current OMG standard (adopted 2025) and has a textual notation. v1 vocabulary keeps Cameo users at home. |
| Save format | A project is a **folder**: `.sysml` text files (the model) plus `.loom/` (diagram layouts as JSON, settings). | Readable diffs and merges in git. The model stays portable to other v2 tools. |
| Storage | Autosave to IndexedDB/OPFS. Open and save real folders with the File System Access API (Chromium); zip import/export elsewhere. | Works offline in any browser. |
| Desktop | 1) A **PWA** (manifest and service worker: installable and offline). 2) A **Tauri** wrapper later, for native files and git. | A PWA costs almost nothing. Tauri is about 10 MB versus Electron's 150 MB. |
| Layout engine | Our own layered (Sugiyama) layout and orthogonal router. dagre (MIT) is a fallback. **Not elkjs**: it is EPL-2.0, and its GPL compatibility needs checking first. | License cleanliness under GPLv3. |
| License | **GPLv3**, free, like Atlas and Works. Copyright (C) 2026 Andrew Aguiar. | Family consistency. |
| Repository | A new repo, `pteronautics-loom`, developed in `Pteronautics/Loom/`. Local server on port **8800** (Atlas 8765, Works 8790). | Separate program, like Works. |
| Commits | Authored by Andrew only. **No co-author or "generated with" lines.** | Owner's instruction. |
| Name | Pteronautics **Loom** (it weaves the digital thread). | Matches the one-word family names. |

## 3. Architecture

```
index.html, css/loom.css         app shell and styles (tokens shared with Atlas/Works)
src/app.js                       routing (#/ home, #/p/<project>/…) and startup
src/model/                       the semantic model
  metamodel.js                   element kinds, allowed owners, properties, v1/v2/guided display names
  store.js                       element graph with indices (by kind, owner, relationship ends)
  tx.js                          transactions, undo/redo, change events
  units.js                       quantities and SI units, dimension checking
  ids.js                         stable ids (so git diffs stay small)
src/text/                        SysML v2 textual notation
  lexer.js, parser.js            recursive-descent parser for the supported subset
  printer.js                     canonical, stable formatter (round-trips with the parser)
src/views/                       diagrams, tables, matrices: views onto the model
  diagram.js                     a diagram = shown elements + layout, kept apart from semantics
  kinds/bdd.js, ibd.js, req.js, act.js, stm.js, sd.js, par.js, uc.js, pkg.js
  table.js, matrix.js            generic tables and dependency matrices
  trace.js, vhome.js             RFLP trace lanes, Systems V home
src/canvas/                      the diagram engine
  render.js                      retained SVG scene, keyed diffing, culling, level-of-detail
  spatial.js                     spatial index for hit-testing and culling
  tools.js                       tool state machine: select, create, connect, pan, lasso
  connect.js                     smart connect: which ports are compatible, and why
  route.js                       orthogonal routing (visibility graph + A*), bundling, label placement
  layout.js                      layered auto-layout, nesting-aware
  snap.js                        grid, alignment guides, equal spacing
src/validate/                    rule engine, built-in rule sets, problems list (runs in the worker)
src/sim/                         parametric solver, activity token simulation, state machine execution
src/interop/                     XMI (Cameo/MagicDraw SysML 1.x) import, ReqIF, CSV, SysML v2 API client, document export
src/integrations/works.js        OPTIONAL, off by default; loaded only when turned on
src/library/                     the SysML/MBSE reference (entries as data) and context help
src/custom/                      profiles, stereotypes, view presets, themes, shortcuts
src/ui/                          shell, model browser, inspector, command palette, panels
src/worker/                      worker entry and message protocol
tests/                           browser test page (same pattern as Works) and benchmarks
samples/                         example projects (Kestrel UAS and a few small ones)
docs/                            user docs, one page per feature
```

### Key ideas

- **Element graph.** Every element has `{ id, kind, name, owner, …props }`. Relationships (satisfy, verify, allocate, connection, flow, …) are elements too, with typed ends. The store keeps indices, so "everything that satisfies REQ-12" or "every port typed by DCPower" is a constant-time lookup.
- **Transactions.** Every edit is a command with an inverse, giving unlimited undo/redo. Edits are grouped, so dragging ten blocks is one undo step. Change events drive the views, validation and autosave incrementally.
- **Notation is presentation only.** SysML, SysML v2 and Guided rename and restyle things; they never change the model.
- **Diagram kinds are plugins.** Each kind declares its allowed elements, palette, shape renderers, connection rules and layout defaults. Adding a new view type does not touch the engine.
- **Smart connect** uses port types, flow direction, conjugation and interface compatibility to rank candidate ports. The hint says why one is compatible or not ("direction mismatch: both are out").
- **Works integration** is an adapter behind the Integrations switch. It can bind Loom value properties to Works document paths, and record Works analysis runs as verification evidence. Loom never imports Works code, and Works stays unaware of Loom.

## 4. Diagrams and views (target for v1.0)

| View | SysML v1 name | v2 view | Must support |
| --- | --- | --- | --- |
| Block definition | bdd | General | blocks, value types, enumerations, interface blocks, composition, aggregation, generalization, associations, compartments, multiplicities |
| Internal block | ibd | Interconnection | nested parts (any depth), proxy/full ports, conjugation, connectors, item flows, binding connectors, collapse/expand, drag-into to nest |
| Requirement | req | General | requirements, derive, satisfy, verify, refine, trace, copy, containment, rationale |
| Activity | act | Action Flow | actions, call behaviors, pins, control/object flow, decisions, forks/joins, partitions (allocation), interrupts |
| State machine | stm | State Transition | states, composite and orthogonal regions, transitions (trigger [guard] / effect), entry/do/exit, history |
| Sequence | sd | Sequence | lifelines, sync/async messages, fragments (alt, opt, loop, par), gates |
| Parametric | par | General | constraint blocks, parameters, binding connectors, live evaluation with units |
| Use case | uc | General | actors, use cases, include/extend, subject boundary |
| Package | pkg | General / Browser | packages, imports, dependencies, profiles |
| Tables & matrices | generic table, dependency matrix | Grid | custom columns with expressions, filters, inline editing, CSV/Excel export |
| RFLP trace | (Loom) | | four lanes, thread highlighting, gaps-only mode, coverage |
| Systems V | (Loom) | | stage progress, left/right pairing, evidence drill-down |

## 5. Milestones

Each milestone ends in something usable and committed. Sizes are relative: S = days, M = 1–2 weeks, L = several weeks.

| # | Milestone | Size | Done when |
| --- | --- | --- | --- |
| M0 ✓ | **Skeleton** (done in 0.1.0) | S | The repo, `serve.py` (8800), shell (sidebar, workspace, inspector), tokens and brand, theme switch, test page, `jsconfig.json` with type checking, LICENSE/COPYRIGHT, README. |
| M1 ✓ | **Model core** (done in 0.2.0, with the Home page) | M | Metamodel, store, transactions and undo, autosave, JSON snapshot. Model browser (create, rename, delete, drag to re-parent), inspector editing, command palette. Tests for all of it. |
| M2 ✓ | **Diagram engine + bdd** (done in 0.3.0; benchmarks in `tests/bench.html`) | L | SVG renderer with pan, zoom and culling. Select, move, resize, lasso, snapping and guides. Blocks with compartments, composition and generalization edges, orthogonal routing, auto-layout. View options, SysML/Guided notation. Benchmarks pass. |
| M3 | **ibd and interfaces** | L | Nested parts, proxy/full/conjugated ports, interface blocks, smart connect, item flows, drag-into nesting, collapse/expand, port compatibility checks. |
| M4 | **Requirements and traceability** | M | Requirement diagram, requirements table, dependency matrix. All requirement relationships, ID schemes, the RFLP trace view, coverage metrics, the Systems V home. |
| M5 | **SysML v2 text and projects** | L | Parser and printer for everything in M1–M4, with round-trip tests. Text pane beside diagrams, both editable. Folder projects with the File System Access API, zip import/export, git-friendly output. |
| M6 | **Behavior diagrams** | L | Activity, state machine, sequence, use case and package diagrams. Allocation via swimlanes and allocate relationships. |
| M7 | **Analysis and simulation** | L | Units and value types, constraint blocks, the parametric diagram and solver. Verification evidence on requirements with live pass/fail. Activity token simulation and state machine execution. |
| M8 | **Validation and customization** | M | Rule engine and rule sets, problems panel, canvas badges. Profiles and stereotypes, view presets, themes, shortcut remapping. |
| M9 | **Interop and documents** | L | Cameo/MagicDraw XMI import (SysML 1.x), ReqIF import/export, CSV/Excel, SysML v2 API client, document generation (HTML/PDF; .docx later). The library reference completed. |
| M10 | **Desktop, polish, launch** | M | PWA (installable, offline), Tauri build, performance hardening, sample models, docs. Loom added to the Pteronautics family table and site alongside Atlas and Works. |
| opt | **Works integration** | S–M | After M7: the Integrations switch, value bindings, Works runs as evidence. Off by default. |
| later | **Collaboration** | L | Model-aware diff and merge (by element id), in-app git history (isomorphic-git, MIT), then optional real-time editing. After v1.0. |

**v1.0 = M0–M10.** M0–M4 alone already make a usable tool for structure, interfaces and requirements, which is the core of most MBSE work.

## 6. Performance budgets

These are checked by a benchmark page (`tests/bench.html`) on generated models.

| Measure | Budget |
| --- | --- |
| Open a 50,000-element project | < 1 s to first paint, < 2 s fully indexed |
| Edit → repaint | < 16 ms (one frame) |
| Pan or zoom a 2,000-shape diagram | 60 fps |
| Re-route after moving a block with 40 connectors | < 16 ms |
| Incremental validation after an edit | < 50 ms, off the main thread |
| Autosave | < 100 ms, never blocks typing |
| Parse or print a 10,000-line `.sysml` file | < 300 ms in the worker |

## 7. Testing

- The same pattern as Works: `tests/index.html` runs every suite in the browser, and results land in `window.__results`. `?only=<suite>` runs one.
- Suites:
  - model and transactions
  - metamodel rules
  - text round-trip (parse → print → parse gives an identical model)
  - routing and layout (no overlaps, no crossings through shapes)
  - smart connect
  - validation rules
  - units
  - parametric solver
  - importers (fixture files)
- Type check: `npx tsc --noEmit -p jsconfig.json` before each commit. It needs Node, as a dev tool only.
- Sample models (Kestrel and a few small ones) open without errors in every release.

## 8. Risks

| Risk | How we handle it |
| --- | --- |
| Scope: Cameo is decades of work | Go deep on structure, interfaces, requirements, traceability and speed first (M0–M5). Add breadth later. |
| SysML v2 conformance | Support a clear subset well. Publish which constructs are supported. Grow it with tests against public v2 examples (check their licenses before copying any into the repo). |
| Cameo XMI is messy (vendor extensions, diagram data) | Import semantics first, diagram layouts as best effort. Report what was skipped. |
| A large no-build codebase gets hard to manage | Strict module boundaries, JSDoc types on every public function, `tsc` checking, and small modules. |
| SVG performance at scale | Culling, level-of-detail and benchmarks from M2. Canvas/WebGL kept as a fallback. |
| Third-party licenses under GPLv3 | MIT/BSD/Apache-2.0 only, vendored with their license files. Nothing EPL or proprietary without a check. |

## 9. First steps (M0 → M1)

1. Create `Loom/` with LICENSE (GPLv3), COPYRIGHT, README (with the family table), `serve.py` (port 8800), `start.command`/`start.bat`, `jsconfig.json`, fonts and tokens from Works.
2. App shell: brand lockup "Pteronautics LOOM", sidebar (model browser placeholder), canvas area, inspector, light/dark theme, command palette stub.
3. Test page and runner, copied from the Works pattern.
4. `src/model/metamodel.js`: element kinds for M1–M4 (package, part def/part, port def/port, interface def, connection, flow, attribute, requirement def/requirement, satisfy, verify, derive, refine, trace, allocate, comment), with v1, v2 and Guided display names.
5. `src/model/store.js` + `tx.js`: the element graph, indices, transactions, undo/redo, change events, with tests.
6. The model browser and inspector wired to the store, plus autosave to IndexedDB.
7. `git init`, a first commit authored by Andrew only, then the `pteronautics-loom` GitHub repo when you're ready to push.
