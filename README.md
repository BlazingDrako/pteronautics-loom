# Pteronautics Loom

**Pteronautics Loom** is the systems engineering program of the Pteronautics family. It is a model-based systems engineering (MBSE) tool built on SysML. You model requirements, functions, architecture and physical parts (RFLP), trace them end to end, and verify them, in a fast, good-looking app that runs in the browser.

## The Pteronautics family

| Program | What it's for |
| --- | --- |
| **Pteronautics Atlas** | Learn how the physics works, one concept at a time, each with a live visual |
| **Pteronautics Works** | Design whole vehicles on the same validated solvers, coupled together |
| **Pteronautics Loom** (this repository, in development) | Model the system: requirements, functions, logical and physical architecture, interfaces and verification, in SysML |

They are separate programs under the Pteronautics name. Loom stands on its own: linking Pteronautics Works is an optional integration, **off by default**.

## What works today (0.5.0: requirements and traceability)

- **Systems V**: the project's home. The left arm runs from stakeholder needs through system requirements and architecture to physical design, the bottom is implementation, and the right arm climbs back up through component, integration and system verification to validation. Each stage shows its progress, measured from the model, and is paired with the stage that checks it. Click a stage for its evidence: what is done and what is missing, each one click from the element. Empty stages offer to add the first element.
- **RFLP trace**: four lanes (Requirements, Functional, Logical, Physical) with a line for every trace relationship between lanes. Select a card to light up its **thread**: everything it realizes, up to the needs, and everything that realizes it, down to the physical parts. Coverage tiles (satisfied, verified, passed, functions allocated, logical realized, physical traced) filter to their gaps, and **Gaps only** shows everything missing a link.
- **Requirements table**: every requirement in a package, one per row. **Edit cells in place** (Enter or double-click, or just start typing; Tab moves on), sort by any column (IDs sort naturally), filter by ID, name or text, **Gaps only**, choose and resize columns (ID, name, text, level, priority, status, method, satisfied by, verified by, refined by, derived from and into, verification result, package, rationale), add and remove links from a cell, **Renumber**, and export to **CSV**. Duplicate IDs are flagged. Rows are virtualized, so 10,000 requirements scroll smoothly.
- **Dependency matrix**: any two sets of elements (requirements, test cases, functions, all/logical/physical blocks, parts, interface blocks) and any relationship. Presets for satisfy, verify, derive, refine and allocation. **Click a cell** (or arrow keys and Space) to add or remove a relationship; the hover tip says what it would do, or why it can't. Row and column totals flag empty ones, **Hide empty**, swap axes, CSV export. Virtualized both ways (2,000 × 10,000 is instant).
- **Requirement diagrams**: requirements with their ID and wrapped text (never spilling out of the box), test cases, blocks and functions; containment (⊕) and dashed «deriveReqt», «satisfy», «verify», «refine», «copy» and «trace» arrows. **Drag from a box's link handle** to another box to relate them: Loom offers only the relationships that are allowed, and says why when none are.
- **All requirement relationships**: satisfy, verify, derive, refine, copy and trace, plus containment. **Requirement levels** (need, system, subsystem, component), set by hand or worked out from derivation; **status** (draft, in review, approved, retired); test case **results** (not run, pass, fail).
- **ID schemes**: set an ID prefix on a package (REQ-, SN-, PRF-…) and new requirements inside it are numbered automatically; **Renumber** tidies a package in one undoable step.
- **Coverage rules**: a requirement is satisfied or verified directly or when all its sub-requirements (contained or derived) are; it has passed only when every test verifying it passed, and a failure shows all the way up. Retired requirements are left out. The inspector shows a requirement's traceability at a glance.
- The Kestrel sample now has two stakeholder needs, four test cases with results (one failed), a requirement diagram, a requirements table, a satisfy matrix and a function allocation matrix.

### 0.4.0: internal block diagrams

- **Internal block diagrams** (ibd), one per block, showing its inside:
  - **Nested parts** as deep as you like (`propulsion : Propulsion System` containing `battery`, `esc`, `motor`). Moving a part moves everything inside it; containers grow to fit; the chevron **collapses** a part to a single box.
  - **Ports** on part edges, with direction arrows (out points away, in points in), **proxy and full** ports, **conjugated** (~) ports, and the block's own ports on the diagram frame. ⌥-drag slides a port along its edge.
  - **Smart connect**: drag from any port. Compatible ports glow green, the rest fade, and the reason shows by the cursor ("Different interfaces: Three-Phase AC and DC Power 48 V", "Both ports receive", delegation rules for the block's own ports). Drop on a part to give it a matching port and connect in one move.
  - **Connectors** routed at right angles around parts, with **item flows**: an arrow for the direction and a label for what flows (it defaults to the interface name).
  - Drag a part **into another part** to move it there in the model. Drop blocks from the browser to add parts typed by them; drop an interface block on a port to type it.
  - **Part** and **Port** buttons, **Show all** (adds what is in the model but not on the diagram) and **Tidy layout**, which lays parts out left to right along their connections.
  - View options: types, port names, item flows, snapping.
- **Model:** connectors (owned by a block, with ends that follow parts down to a port), item flow and flow direction, full/proxy ports. Deleting a part or port deletes its connectors; undo brings them back.
- The Kestrel sample now has an ESC, three interfaces, connectors with item flows, and two internal block diagrams (Propulsion internals, Air vehicle internals).

### 0.3.0: block definition diagrams

- **Block definition diagrams** (bdd), drawn by Loom's own diagram engine:
  - Blocks and interface blocks with **parts, values and ports compartments**, in SysML, SysML v2 or Guided wording. Text that doesn't fit is cut with an ellipsis, never spilled.
  - **Composition** lines (filled diamond, role name and multiplicity) from typed parts, and **generalization** lines (hollow triangle), routed orthogonally around other blocks. Lines sharing a side are spread out; generalizations into one block meet at a point.
  - **Drag** blocks (they snap to other blocks' edges and centers, with guides, then to the grid; hold ⌥ to move freely), **resize** with the handles, **lasso** to select several, ⇧-click to add to a selection, arrow keys to nudge.
  - **Pan** with the wheel, space-drag or middle button; **zoom** with pinch, ⌘/Ctrl+wheel, + and −; 0 fits the diagram.
  - **Drag elements from the model browser** onto a diagram; **Block** and **Interface** buttons create new ones in place; **Add related** shows the types of the selected blocks' parts and their generalizations; **Tidy layout** (⇧L) lays the diagram out automatically.
  - Delete removes a block **from the diagram only**; ⌘Delete deletes it from the model. Every change undoes.
  - Per-diagram **View options**: each compartment, role names, snapping.
  - A new diagram starts with the blocks in its package, already laid out. The Kestrel sample comes with one.
  - Fast on big diagrams: only what is in view is drawn, far-out zoom drops compartment text, and lines are re-routed only when geometry changes. See the benchmark page below.

### Earlier (0.2.0: Home and the model core)

- **Home page**: your projects as cards (elements per RFLP layer, traces, last edit), **New project** (blank, or the Kestrel UAS sample), **Import** and **Export** `.loom.json` files, rename, duplicate and delete. Projects are saved on this device (IndexedDB); if the browser blocks storage, Loom still works for the session and says so.
- **The model core**: the SysML element kinds (package, requirement, test case, function, block, interface block, part, port, value property, comment) and relationships (satisfy, verify, derive, refine, allocate, generalization, trace), with the ownership and relationship rules enforced. Every edit is a transaction with **unlimited undo and redo** (⌘Z / ⌘⇧Z). Deleting an element removes everything inside it and every relationship touching it, and undo brings it all back.
- **Model browser**: the four RFLP layers as a tree. Click to select, double-click or F2 to rename, Delete to delete, **drag onto another element to move it** (illegal moves are refused), + to add inside, arrow keys to move around.
- **Inspector**: name, description and every property of the selected element (requirement ID, text, priority and verification method; part and port types; port direction and conjugation; values and units), its location, what it contains, and its relationships. You can add or remove relationships from here.
- **Command palette** (⌘K): every command, plus jump-to-element by name.
- **Notation**: SysML (Block, Part property…), SysML v2 (part def, part…) or Guided (Part type, Part…), switched live.
- **Autosave** a moment after every change, plus the Pteronautics Works switch (off by default) and light and dark themes.

**Not built yet:** the activity, state machine, sequence, parametric, use case and package diagrams, the SysML library and SysML v2 text files. These are marked "soon" in the app. See [PLAN.md](PLAN.md).

## Run it

- **macOS:** double-click `start.command` (first time: right-click → Open).
- **Windows:** double-click `start.bat`.
- **Any system:** `python3 serve.py`, then open http://localhost:8800

Plain ES modules, no build step, no dependencies. Python 3 is the only requirement; browsers need a local server for modules. Atlas uses port 8765 and Works 8790, so all three can run side by side. `python3 serve.py 9000 --no-browser` picks another port and skips opening the browser.

## Tests

Open http://localhost:8800/tests/ with the server running. It runs the settings, commands and shortcuts, fuzzy search, model core, files/import/export/projects, diagram (placing, boxes, lines, layout) internal block diagram (connectors, connection rules, nesting, layout), and requirements and traceability (IDs, levels, coverage, threads, requirement diagrams, tables, matrices, the RFLP trace and the Systems V) tests. Results are also left in `window.__results`.

**Benchmarks:** http://localhost:8800/tests/bench.html checks the performance budgets in [PLAN.md](PLAN.md): opening a 50,000-element model; panning, zooming, editing and moving blocks on a 2,000-block diagram; and coverage, the requirements table and the dependency matrix on 10,000 requirements.

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
src/canvas/view.js           the diagram canvas: rendering, camera, selection, editing
src/canvas/bdd.js            what a block definition diagram shows (boxes, compartments, lines)
src/canvas/route.js          orthogonal line routing
src/canvas/layout.js         automatic layered layout
src/canvas/measure.js        text measurement and ellipsis
src/canvas/populate.js       filling a new diagram
src/canvas/ibd.js            what an internal block diagram shows, nested layout, connector routing
src/canvas/ibdview.js        the internal block diagram canvas
src/canvas/connect.js        connection rules: which ports may connect, and why not
src/canvas/req.js            what a requirement diagram shows (requirement boxes, «stereotyped» arrows)
src/model/trace.js           requirement IDs, levels, coverage and the RFLP thread
src/views/vhome.js           the Systems V
src/views/trace.js           the RFLP trace lanes
src/views/table.js           the requirements table
src/views/matrix.js          the dependency matrix
src/model/paths.js           diagram layout keys (part paths and ports)
src/ui/fuzzy.js              fuzzy matching and ranking
src/ui/dom.js                DOM helpers, icons, brand, theme
tests/                       test page, runner and Loom tests
PLAN.md                      the build plan
```

## License

Copyright (C) 2026 Andrew Aguiar. Pteronautics Loom is free software under the **GNU General Public License v3.0** (see `LICENSE` and `COPYRIGHT`), the same license as Atlas and Works. The bundled fonts are under the SIL Open Font License (see `assets/fonts/`).
