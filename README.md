# Pteronautics Loom

**Pteronautics Loom** is the systems engineering program of the Pteronautics family. It is a model-based systems engineering (MBSE) tool built on SysML. You model requirements, functions, architecture and physical parts (RFLP), trace them end to end, and verify them, in a fast, good-looking app that runs in the browser.

## The Pteronautics family

| Program | What it's for |
| --- | --- |
| **Pteronautics Atlas** | Learn how the physics works, one concept at a time, each with a live visual |
| **Pteronautics Works** | Design whole vehicles on the same validated solvers, coupled together |
| **Pteronautics Loom** (this repository) | Model the system: requirements, functions, logical and physical architecture, interfaces and verification, in SysML |

They are separate programs under the Pteronautics name. Loom stands on its own: linking Pteronautics Works is an optional integration, **off by default**.

## What works today (1.0.0: desktop, offline and launch)

- **Install it as an app** (Chrome, Edge, Arc; Safari's *Add to Dock*): its own window, and it **works offline**, because every file it needs is kept by a service worker. While online it still fetches the newest files first, so updates arrive on the next launch. The installed app opens `.loom.json`, `.zip`, `.sysml`, Cameo and ReqIF files handed to it, and has a *New project* shortcut. See [docs/desktop.md](docs/desktop.md).
- **Desktop:** `Pteronautics Loom.app` starts Loom from this folder on macOS, like the Atlas launcher. `desktop/tauri/` is a Tauri 2 project for a native build on macOS, Windows and Linux (not built yet; it needs Rust).
- **Validation in the background:** the rules run in a worker that keeps its own copy of the model and receives only what each edit changed. Checking 50,000 elements takes about 50 ms in the worker and well under a millisecond of the page's time, so typing and dragging never wait for it. The duplicate-name and unused-block rules and the problem sorting got faster too.
- **Three samples:** besides Kestrel, a **CubeSat power system** (solar array, battery and power unit connected through typed ports, and an energy budget that checks the orbit-average power requirement live) and a **landing gear** (an extension activity with a free-fall path when hydraulics fail, the gear's states and a gear-down scenario). Each builds with no errors or warnings and round-trips through SysML v2 text.
- **Docs:** [a user guide](docs/guide.md) (a project from start to finish, the workspace, shortcuts), [the desktop options](docs/desktop.md) and [a development guide](docs/development.md) (how the code is arranged, the worker, the offline app, adding rules, kinds and samples, releasing).
- A new app icon, in every size the browsers, macOS and Windows want.

### 0.10.0: interop and documents

- **ReqIF** (`.reqif`, `.reqifz`): export a package's requirements for DOORS, Polarion, Jama, Codebeamer or a supplier (sub-packages become headings; derive, copy and trace links go too, and what satisfies and verifies each requirement rides along), and import ReqIF from those tools. Loom recognises the attribute names they use (*Object Text*, *Absolute Number*, *Object Heading*, *ReqIF.Text*…) and maps their values (*High* → Must, *Accepted* → Approved). **Importing again updates** the requirements already there (matched by Loom's own id, then by requirement ID, then by name) instead of adding duplicates, as one undoable step.
- **Excel and CSV**: export requirements one per row (ID, name, text, level, priority, status, method, rationale, parent, derived from, satisfied by, verified by, result), edit them anywhere and import them back the same way. Columns are recognised by name; *Parent ID* nests rows. The requirements table also exports the rows it shows as Excel. Workbooks are read and written by Loom itself, with no libraries.
- **Cameo / MagicDraw** (`.mdzip`, `.xmi`, SysML 1.x): Import on the Home page makes a new project with packages, requirements (ID and text), blocks, interface blocks, value types (with QUDV units), constraint blocks, parts, ports, values with defaults, connectors, generalizations, satisfy, verify, derive, refine, trace, copy and allocate, activities with swimlanes, state machines, use cases and scenarios. Each element goes to the RFLP layer of its kind, in a copy of its package. Diagram layouts are Cameo's own format and are not read; the import report counts everything left out.
- **SysML v2 API**: open a project from any server that implements the OMG Systems Modeling API (projects, commits, paged elements), or send a Loom project to one as a new project with one commit. The server must allow requests from the browser (CORS).
- **Documents**: generate the model as a report: a cover, contents, summary and coverage, requirements (with satisfied by, verified by and result), verification, functions and allocation, architecture (blocks with stereotypes, parts, ports, given and computed values), interfaces and connections, behavior, analysis, every diagram as a picture, and the validation problems. One HTML file holds everything (styles, fonts, diagrams as SVG); print it to PDF from the browser. Word (.docx) is still to come.
- **The SysML library** is complete: articles on MBSE, SysML v1 and v2, RFLP, the Systems V, traceability, coverage, writing requirements, verification, parametrics, allocation, ports, state machines, profiles and exchange, and an entry for every element, relationship and diagram kind (its names in each notation, what it contains and relates to, its properties, how it is written in SysML v2 text, and the elements of that kind in your model). Press **?** for the entry of the selected element's kind.

### 0.9.0: validation and customization

- **Validation as you work.** 37 rules check the model a moment after every edit: parts and ports without types, connectors joining incompatible ports, bad multiplicities, blocks that contain or specialize themselves, unknown units, equations that cannot be read or that conflict, requirements without IDs or text, duplicate IDs, requirements nothing satisfies or verifies, failed tests and broken live checks, test cases that verify nothing, unallocated functions, unused blocks, duplicate and placeholder names, empty diagrams, and everything **Check** finds on activities, state machines and scenarios. Requirement **wording** is checked too (after INCOSE's guide): vague words (*fast*, *adequate*, *user-friendly*), TBDs, missing "shall", two requirements in one, overlong text.
- **The problems panel** (⌘⇧M, or the counts in the status bar) lists every problem with its element and rule. Filter by severity, by text, or to the selection; click to go to the element, double-click to open a diagram showing it; **F8** / **⇧F8** step through them. Many problems have a **one-click fix** (give a requirement the next ID, a new ID for a duplicate, rename a placeholder, take off a stereotype that no longer fits), and any problem can be **ignored**.
- **Badges** mark problems where you look: a colored count on each box of every diagram (block, internal block, requirement, activity, state machine, sequence, use case, package and parametric), a dot in the model browser, and a Problems section in the inspector. Click a badge to see its problems.
- **Rule sets and your own rules.** Choose **Recommended**, **Strict** (every rule, with naming conventions and descriptions), **Requirements quality** or **Early draft** (errors only), then turn single rules off or change how severe they are. Write rules of your own without code: *every Requirement's priority must be set*, *every Block's name must match ^[A-Z]*. The project's rules are saved with it (in `.loom/project.json` for folders) and every change is undoable.
- **Profiles and stereotypes.** Make your own kinds of element: a **profile** holds **stereotypes** (Flight critical, COTS, Software), each saying which kinds it applies to, with a color, an icon and **tags** (value properties, whose values are the defaults). Apply them in the inspector and fill in the tagged values. Boxes show «block, Flight critical», the icon and the color, and a tags compartment (a view option). Stereotypes are SysML v2 text: `library package`, `metadata def`, and `@'Flight critical' { dal = "B"; }` on the element.
- **View presets.** Save a diagram's view options (compartments, labels, tags) as a named preset and apply it to any diagram of that kind from the **View** menu. Loom comes with a few (*Names only*, *Parts and ports*, *IDs and names*…), and one preset per kind can be the default for new diagrams.
- **Preferences** (⌘,): theme (same as the computer, light or dark), eight **accent colors**, **high contrast**, the diagram grid, and notation.
- **Remappable shortcuts.** Give any command a shortcut, or change its own: click it, press the keys. Loom says when a combo is taken and by what, and every change can be reset.
- The Kestrel sample now has a profile with three stereotypes, applied to the battery, the ESC and the avionics.

### 0.8.0: analysis and simulation

- **Run behavior diagrams to check them.** Activity, state machine and sequence diagrams have a **Run** (or **Play**) button that opens a run panel beside the diagram, and the diagram lights up as it runs:
  - **Activities** run as tokens. An action runs when every flow into it has a token; forks copy tokens, joins wait for all of them, decisions take the way whose guard holds (guards such as `battery > 20%` are worked out from values you type in the panel) or ask you which way. Run, step, reset, three speeds.
  - **State machines** start at their initial state and follow completion transitions by themselves. Send events from the panel, or press Run and the machine sends events itself, trying ones that lead somewhere new first. Exit actions, effects and entry actions run in the right order; composite states, regions, choice and history states work. Guards Loom cannot evaluate (`preflight ok`) are switches.
  - **Sequence diagrams** play message by message; at an alt, opt or loop the guard decides, or you choose.
  - **Check** explores every way the diagram can run and lists what is wrong, each item a link to the element: deadlocks (a join after a decision), steps that can never run, tokens lost or piling up, runs that never finish, decisions without guards, unreachable states, dead-end states, ambiguous transitions, replies with no call, empty fragments, and messages the receiver's state machine never accepts.
- **Color in behavior diagrams.** Actions, states, use cases, control nodes and pseudo-states each have their own color (initial green, final red, decisions amber, forks and joins violet); lanes and packages take their layer's color; object flows, transition labels, fragments (by operator) and messages (by kind) are colored too. Light and dark themes. Any box can be given its own fill with **Color** (blue, teal, green, amber, coral, pink, violet, slate), kept per diagram.
- **Units and value types.** Value properties understand units: SI with prefixes, compound units (`km/h`, `m/s^2`, `kg·m²`, `W/kg`), hours, minutes, percent, degrees, rpm, feet, knots, psi, °C and more. A **value type** (Energy in Wh, Duration in h) gives its values a unit. The inspector says what each value measures and flags units Loom does not know.
- **Constraint blocks and parametric diagrams.** A constraint block holds an equation (`t = E / P`); writing it creates its parameters. Use it in a block, and on the **parametric diagram** drag from a value to the equation to bind a parameter, through parts as deep as you like (`propulsion.battery.usableEnergy`).
- **The solver** works as you edit. Values without a number are computed (any one can be the unknown: give endurance and it solves for power), equations that share unknowns are solved together, and everything is checked: a value that breaks an equation, an equation that adds hours to kilograms, or a binding that joins a charge to an energy is reported, on the diagram and in a status pill, instead of giving a wrong answer.
- **Live verification.** A requirement can carry a **check**, such as `endurance >= 3 [h]`, evaluated against the values (given or computed) of what satisfies it. A met check counts as passed verification and a broken one as failed, everywhere: the inspector, the requirements table, the RFLP trace and the Systems V. Change the design and the requirement turns red at once.
- The Kestrel sample now has value types, two equations (battery energy and endurance), live checks on the endurance and usable-energy requirements, and two parametric diagrams.

### 0.7.0: behavior diagrams


- **Activity diagrams** for any function: its steps (sub-functions), initial, final and flow-final nodes, decisions, merges, forks and joins, joined by control and object flows with guards and items. Drag from a step's handle to the next to add a flow. **Swimlanes are allocation**: each lane is a block, an action in a lane is allocated to it, and dragging an action to another lane changes the allocation in the model (adding or resizing a lane never does). Moving a lane moves what is in it. Tidy layout runs the flow top to bottom from the initial node, each step in its lane.
- **State machine diagrams** for any block: states with entry / do / exit, initial, final, choice and history pseudo-states, transitions labeled *trigger [guard] / effect*, composite states and orthogonal regions. Drag a state into another to nest it in the model, out to un-nest it; moving a composite moves its states. Tidy lays composites out around their insides.
- **Sequence diagrams** for any scenario (interaction): lifelines for parts, blocks or actors; synchronous, asynchronous, reply and create messages, and self messages; combined fragments (alt, opt, loop, par, break, critical) with guarded operands. The picture is laid out from the model: drag between lifelines to add a message where you let go, drag a message up or down (into or out of fragments) to reorder it, drag a lifeline's head to reorder lifelines.
- **Use case diagrams**: actors as figures, use cases as ellipses, blocks as the system boundary (subject); associations, «include» and «extend». Drop a use case in a boundary to give it that subject.
- **Package diagrams**: packages as folders listing their members, containment and «import» dependencies.
- **Model**: control nodes, flows, states, regions, transitions, interactions, lifelines, messages, fragments, operands, actors and use cases; include, extend, association and import relationships. Deleting a step, state or lifeline deletes the flows, transitions or messages that end on it (and undo brings them back). All of it is in the SysML v2 text and in project folders.
- The Kestrel sample now has a survey-flight activity in three lanes, the air vehicle's state machine, a survey sortie sequence, its use cases, and a package diagram of the four layers.

### 0.6.0: SysML v2 text and project folders

- **SysML v2 text**: every model is also text, one package per RFLP layer (see [the text format](#the-text-format) below). The printer is canonical: the same model always prints the same text, so diffs stay small.
- **Text pane** (⌘E, or the button in the project panel): the layer's text beside any diagram, table or view, with syntax colors and line numbers. **Edit it directly**: your text is checked as you type, and applied as one undoable change when you pause (or press ⌘Enter, or click away), as long as it has no errors. Errors name the line and what is wrong ("Nothing named 'Endurace' can be used here", "A requirement cannot verify here: verify goes from a test case to a requirement"). Renaming or moving something in the text keeps it the same element, so it keeps its place on every diagram and every relationship to it. Click in the text to select that element; select an element anywhere to jump to its text.
- **Project folders, ready for git**: *Save to a folder…* writes the project as four `.sysml` files plus `.loom/` (stable ids and diagram layouts, one entry per line), and keeps the folder up to date as you work. *Open folder* on the Home page opens one (for example a git repository). When the folder changed outside Loom (a `git pull`, another editor), Loom offers to load the changes as one undoable step, or keep its own version. Loom never touches other files in the folder. Folders need Chrome, Edge or Arc (the File System Access API).
- **Zip**: export any project as a `.zip` of that same folder, and import `.zip` or `.loom.json` files, in every browser.
- Error messages for relationships the rules forbid now read properly ("cannot have a satisfy relationship to…").

### 0.5.0: requirements and traceability

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

**Not built yet:** the parametric diagram and solver, simulation, validation rules, the SysML library, and Cameo/XMI import. These are marked "soon" in the app. See [PLAN.md](PLAN.md).

## The text format

Loom writes and reads a clear subset of the SysML v2 textual notation. Loom's own properties go in a standard metadata block, `@Loom { … }`, and are written only when they differ from the defaults.

```
package Logical {
    @Loom { layer = "l"; }

    part def 'Battery Pack' :> 'Energy Storage' {
        doc /* A 12S lithium-polymer pack. */
        attribute capacity = 16 [Ah];
        out port pwrOut : 'DC Power 48 V';

        satisfy 'Usable energy';
        allocate to 'LiPo 12S 16 Ah pack';
    }
}
```

| You write | It is |
| --- | --- |
| `package Name { … }` | a package (each file is one RFLP layer, marked `@Loom { layer = "r"; }`) |
| `requirement <'REQ-001'> Name { doc /* text */ }` | a requirement: its ID is the short name, its text the doc |
| `verification def Name { verify Req; }` | a test case and the requirements it verifies |
| `action def Name { … }` | a function (nest them for sub-functions) |
| `part def Name :> General { … }` / `port def Name` | a block (specializing another) / an interface block |
| `part name : Type [4];` | a part property, with multiplicity |
| `in port name : ~Type;` | a port: direction, type, `~` for conjugated |
| `attribute name = 16 [Ah];` | a value property with a unit |
| `connect a.p to b.q;` / `connection Name connect …` | a connector, by part and port names inside the block |
| `view Name { @Loom { kind = "bdd"; } }` | a diagram, table or matrix (`bdd`, `ibd`, `req`, `act`, `stm`, `sd`, `uc`, `pkg`, `par`, `table`, `matrix`) |
| `comment Name /* text */` | a note |
| `satisfy X;` `verify X;` `refine X;` `derive X;` `copy X;` `allocate to X;` `dependency to X;` | relationships from the element they are written in |
| `start S;` `done F;` `terminate T;` `decide D;` `merge M;` `fork F;` `join J;` | an activity's control nodes |
| `succession first A then B;` / `flow from A to B;` | a control flow / an object flow (guard and item in `@Loom`) |
| `state S { … }` / `region R { … }` | a state (entry, do, exit and its kind in `@Loom`) / an orthogonal region |
| `transition first A accept "trigger" if "guard" do "effect" then B;` | a transition |
| `interaction I { lifeline a : Part; message 'call()' from a to b; fragment F { operand O { … } } }` | a scenario for a sequence diagram |
| `actor A;` `use case U { include V; extend W; }` `participate in U;` `import P::*;` | use cases and package imports |
| `attribute def Energy { @Loom { unit = "Wh"; } }` / `attribute e : Energy = 675 [Wh];` | a value type / a value property typed by it |
| `constraint def Endurance { attribute t [h]; … @Loom { expr = "t = E / P"; } }` | a constraint block: its parameters and equation |
| `constraint range : Endurance;` `bind range.E = propulsion.battery.usableEnergy;` | a constraint property, and a binding of its parameter to a value |
| `library package Safety { metadata def Critical { attribute dal = "C"; @Loom { extends = "partDef,part"; color = "coral"; } } }` | a profile, a stereotype (what it applies to, color, icon), and its tags with defaults |
| `@Critical;` / `@Critical { dal = "B"; }` | a stereotype applied to the element it is written in, with tagged values |

Names with spaces or symbols are quoted (`'Battery Pack'`). A name finds the nearest element with that name; where two share one, qualify it (`Logical::'Battery Pack'`). Line notes (`// …`) are allowed and ignored.

## Run it

- **macOS:** double-click `start.command` (first time: right-click → Open).
- **Windows:** double-click `start.bat`.
- **macOS app:** double-click `Pteronautics Loom.app` in this folder (no Terminal window; quit it from the Dock to stop the server).
- **Any system:** `python3 serve.py`, then open http://localhost:8800

Then choose **Install app** on the Home page to have Loom in its own window, offline. The same folder can be hosted as-is on any static web host, so people need nothing installed at all. New to Loom? Start with [the user guide](docs/guide.md).

Plain ES modules, no build step, no dependencies. Python 3 is the only requirement; browsers need a local server for modules. Atlas uses port 8765 and Works 8790, so all three can run side by side. `python3 serve.py 9000 --no-browser` picks another port and skips opening the browser.

## Tests

Open http://localhost:8800/tests/ with the server running. It runs the settings, commands and shortcuts, fuzzy search, model core, files/import/export/projects, diagram (placing, boxes, lines, layout) internal block diagram (connectors, connection rules, nesting, layout), requirements and traceability (IDs, levels, coverage, threads, requirement diagrams, tables, matrices, the RFLP trace and the Systems V), SysML v2 text, folders and zip (parsing, printing, round trips, editing as text, errors, folder files, zip, the project store, and a live workspace saving to a folder), behavior (activities and swimlane allocation, state nesting, sequences, use case subjects, packages, deletion cascades, behavior as text), analysis and simulation, and validation and customization (every rule, rule sets, custom rules, ignoring and fixing, stereotypes in the model, on diagrams, in text and in folders, view presets, settings and shortcut remapping), interop and documents (ReqIF, Excel and CSV round trips and files from other tools, Cameo XMI, the SysML v2 API against a mock server, documents and diagram pictures, the library), and release (the validation worker following edits and finding the same problems as the page, the offline file list and manifest, every sample building cleanly and round-tripping, the desktop files) tests. Results are also left in `window.__results`.

**Benchmarks:** http://localhost:8800/tests/bench.html checks the performance budgets in [PLAN.md](PLAN.md): opening a 50,000-element model; panning, zooming, editing and moving blocks on a 2,000-block diagram; coverage, the requirements table and the dependency matrix on 10,000 requirements; printing, parsing, building and applying 16,000 lines of SysML v2 text; a 400-step activity and a 1,000-message sequence; and validating 50,000 elements, on the page and in the worker.

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
src/model/samples.js         the samples offered on Home: Kestrel, the CubeSat power system, the landing gear
src/pwa.js                   the offline app: service worker registration, install, files opened with the app
src/validate/worker.js       the validation worker (a copy of the model that follows edits)
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
src/canvas/act.js            activity diagrams: shapes, flows, swimlanes as allocation, layout
src/canvas/stm.js            state machine diagrams: states, nesting by dragging, layout
src/canvas/uc.js             use case diagrams (subjects by dragging) and package diagrams
src/canvas/sdview.js         sequence diagrams, laid out from message order
src/canvas/req.js            what a requirement diagram shows (requirement boxes, «stereotyped» arrows)
src/canvas/par.js            parametric diagrams: equations, values by path, bindings, layout
src/analysis/units.js        units: parsing, dimensions, conversion
src/analysis/expr.js         the expression language of equations, checks and guards
src/analysis/solver.js       the parametric solver
src/analysis/verify.js       live requirement checks
src/sim/activity.js          running and checking activities (tokens)
src/sim/statemachine.js      running and checking state machines
src/sim/sequence.js          playing and checking scenarios
src/sim/adapters.js          each engine as the run panel sees it, and what lights up
src/ui/runpanel.js           the run panel
src/model/trace.js           requirement IDs, levels, coverage and the RFLP thread
src/views/vhome.js           the Systems V
src/views/trace.js           the RFLP trace lanes
src/views/table.js           the requirements table
src/views/matrix.js          the dependency matrix
src/text/lexer.js            SysML v2 tokens, name quoting, doc text
src/text/parser.js           the SysML v2 parser (text → tree)
src/text/printer.js          the canonical printer (model → text, one file per layer)
src/text/names.js            resolving names, shortest references, stable keys
src/text/build.js            text → model: matching ids, references, applying as one edit
src/ui/textpane.js           the text pane
src/storage/folder.js        the project folder format (.sysml files and .loom/)
src/storage/folderfs.js      real folders (File System Access API) and an in-memory folder
src/storage/zip.js           zip reading and writing
src/model/paths.js           diagram layout keys (part paths and ports)
src/ui/fuzzy.js              fuzzy matching and ranking
src/ui/dom.js                DOM helpers, icons, brand, theme, accent and contrast
src/validate/rules.js        the validation rules and rule sets
src/validate/engine.js       running the rules, project settings, custom rules, the live validator
src/ui/problems.js           the problems panel
src/ui/rulesdlg.js           the validation rules dialog
src/custom/stereo.js         profiles and stereotypes: applying, tags, how boxes show them
src/custom/presets.js        view presets
src/ui/prefs.js              preferences: appearance, shortcuts, presets
src/interop/reqif.js         ReqIF import and export
src/interop/sheet.js         CSV and Excel (.xlsx) reading and writing; requirements as rows
src/interop/reqs.js          merging imported requirements (update, not duplicate)
src/interop/xmi.js           Cameo / MagicDraw XMI import (SysML 1.x)
src/interop/api.js           the SysML v2 API client
src/interop/docs.js          document generation (HTML, print to PDF)
src/interop/snapshot.js      a diagram as a standalone SVG
src/interop/xml.js           XML helpers
src/ui/interop.js            the exchange dialogs
src/library/entries.js       the SysML and MBSE reference, as data
src/views/library.js         the library view
manifest.webmanifest         the installable app: name, icons, file types it opens
sw.js                        the service worker (generated by tools/precache.py; do not edit)
tools/precache.py            writes sw.js from tools/sw.template.js and the app's files
Pteronautics Loom.app        the macOS launcher
desktop/stage.py             gets a Tauri build ready (copies the app, sets the version)
desktop/tauri/               the Tauri 2 project for a native desktop build
docs/                        the user guide, desktop options and development guide
tests/                       test page, runner and Loom tests
PLAN.md                      the build plan
```

## License

Copyright (C) 2026 Andrew Aguiar. Pteronautics Loom is free software under the **GNU General Public License v3.0** (see `LICENSE` and `COPYRIGHT`), the same license as Atlas and Works. The bundled fonts are under the SIL Open Font License (see `assets/fonts/`).
