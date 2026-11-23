# Using Pteronautics Loom

Loom is a model-based systems engineering (MBSE) tool. You build one model of your system, in
SysML, and every diagram, table and document is a view of that model. Change a block's name on
one diagram and it changes everywhere; delete a requirement and its traces go with it.

This guide walks through a project from start to finish. Press **?** in Loom at any time for the
SysML library: an entry for every element, relationship and diagram, and short articles on MBSE.

## Start

- **In the browser:** run `python3 serve.py` (or double-click `start.command` on macOS,
  `start.bat` on Windows) and open http://localhost:8800.
- **As an app:** choose **Install app** on the Home page, or *Install Loom as an app* from the
  command palette. Loom then has its own window and works offline. See [desktop.md](desktop.md).

On the Home page, **New project** starts a blank project or one of three samples:

| Sample | What it shows |
| --- | --- |
| Kestrel UAS | The full tour: a survey drone from stakeholder needs to physical parts, with every diagram kind, live requirement checks, a failed flight test and gaps to find |
| CubeSat power system | Structure and interfaces: a solar array, battery and power unit, connected through typed ports, with an energy budget that checks the orbit-average power requirement live |
| Landing gear | Behavior: extending the gear, with a free-fall path when hydraulics fail, the gear's states and a gear-down scenario |

Projects are saved on this device as you work. **Import** brings in a Loom file (`.loom.json`,
`.zip`), a Cameo or MagicDraw model (`.mdzip`, `.xmi`) or requirements (ReqIF, Excel, CSV).
**Open folder** works on a folder of `.sysml` files, ready for git.

## The workspace

| Area | What it is for |
| --- | --- |
| Model browser (left) | Everything in the model, in four layers: **Requirements**, **Functional**, **Logical**, **Physical** (RFLP). Drag its edge to make it wider or narrower; Mod+B hides it to give diagrams the whole window |
| Stage (middle) | The open diagrams, tables and views, as tabs. **Systems V** shows how far each stage of the V is, and **Model overview** counts it all |
| Properties (floating) | Double-click any element, on a diagram or in the browser, to see and edit everything about it: name, properties, relationships, problems, where it appears. While open it follows the selection. Drag it by its title, resize it from its corner; Esc closes it. Mod+. opens it for the selection |
| Project menu (the project's name, top left) | Project settings, saving to a folder, export, import and export of requirements, documents, the SysML v2 server, the text, validation rules and profiles |
| Status bar | Where the project is saved, its size, its problems (click to open the problems panel) and the notation (click to change it) |

The **command palette** (Mod+K) runs any command and finds any element by name. Every command
with a shortcut shows it there; change shortcuts in Preferences (Mod+,). Preferences also have a
**compact** density that fits more on the screen.

### Frameworks and sets

The top of the model is organized by a **framework**. **RFLP** (requirements, functional,
logical, physical) is the default; **Arcadia (Capella)**, **MagicGrid (Cameo)**, **OOSEM** and
the **SysML pillars** are the others. Pick one for a new project, or change it any time from the
project menu (**Framework…**); switching is one step you can undo.

Every framework has the same four **core sets** underneath (what is needed, what it must do,
how it is organized, what gets built), so traces, the Systems V and coverage work the same; it
names them in its own words, and some add sets of their own (Arcadia's End-Product Breakdown,
MagicGrid's Parameters). You can rename any set, and add **sets of your own** from the model
browser's **⋯** menu or the project menu (**New set**): top-level folders with a color (right-click
one to change it), saved as their own `.sysml` files. What you put in your own sets works
everywhere, but is not part of the trace between the core sets.

### The model browser

- **Click** to select, **double-click** for properties (a diagram opens instead), **F2** to rename.
- **Drag** a row onto another to put it inside, or between two rows to reorder; drag it onto a
  diagram to show it there. Hover over a closed folder while dragging and it opens. Esc cancels.
- **Right-click** for a menu: properties, rename, add inside, expand or collapse everything inside,
  delete. The **+** on a row adds inside it.
- **Filter by name** at the top narrows the browser to matching elements and their packages.
- Lines (activity flows, transitions, connectors, bindings) are hidden from the browser unless you
  turn them on in its options menu (**⋯**); they are always on the diagrams.
- Alt+↑ and Alt+↓ move the selection among its siblings.

### Diagram palettes

Every diagram has a palette down its left side with a tool for each element and relationship it
can hold, drawn as its SysML symbol. Hover a tool for its name and what it does.

- Click an element tool, then click on the diagram to place it there. Double-click a tool to
  place several; Esc or the Select tool puts it down.
- Click a relationship tool, then click the source and the target (or drag from one to the
  other). Loom only makes relationships SysML allows, and says why when it cannot.
- The arrow at the palette's foot shows the tools' names beside their icons.

## A project, step by step

1. **Requirements.** Add requirements to a package in the Requirements layer. Give each an ID
   (the package's prefix fills in the next one), its text with *shall*, a priority and a
   verification method. **Derive** system requirements from stakeholder needs. The requirements
   table edits them like a spreadsheet; the requirement diagram shows them with their traces.
2. **Functions.** In the Functional layer, add actions and break them down. An **activity
   diagram** orders them with flows, decisions, forks and joins; swimlanes are allocations, so
   dragging an action into a lane allocates it.
3. **Logical architecture.** Blocks (part defs), their parts, values and ports. A **block
   definition diagram** shows what each block contains and specializes; an **internal block
   diagram** shows how its parts connect. Loom only lets ports connect when their interfaces and
   directions match, and says why when they do not.
4. **Physical architecture.** The parts you build or buy, with the logical blocks **allocated**
   to them.
5. **Traces.** **Satisfy** a requirement from the block that meets it, **verify** it with a test
   case, **refine** it with a function. The RFLP trace, the dependency matrix and the Systems V
   show where the threads are broken.
6. **Analysis.** Give values units, write equations in constraint blocks and bind them on a
   **parametric diagram**: Loom solves them as you type. A requirement's *check*
   (`endurance >= 3 [h]`) is then checked live against the design that satisfies it.
7. **Behavior.** State machines, sequence diagrams and activities can be **run**: step through
   them, see which transitions fire, and find dead ends.
8. **Validation.** The problems panel (Mod+Shift+M) lists what the rules find: untyped parts,
   unverified requirements, vague wording, unconnected ports and more. Many problems have a fix.
   Choose rule sets, change severities, write your own rules or ignore a problem in **Rules**.
   Checking runs in the background, so even very large models never slow typing down.
9. **Documents and exchange.** Generate a document (HTML, print to PDF) with every diagram;
   export requirements to ReqIF or Excel and import them back; export the whole model to Cameo or
   MagicDraw as SysML 1.6 XMI (project menu, **Export to Cameo (XMI)**; in Cameo use File ▸
   Import From and its UML XMI importer); send the model to a SysML v2 API server.

## Text

Mod+E shows the model as SysML v2 text, one file per layer. Edit the text and apply it: Loom
matches what you wrote to the elements already there, so diagrams keep their layout. Project
folders are this same text, plus `.loom/` for ids and layout. The README lists the text format.

## Shortcuts

| Keys (Mac / others) | Command |
| --- | --- |
| ⌘K / Ctrl+K | Command palette: any command, any element |
| ? | The SysML library, on the selected element's kind |
| ⌘. / Ctrl+. | Properties of the selection (or double-click it) |
| ⌘B / Ctrl+B | Show or hide the model browser |
| ⌘E / Ctrl+E | Show or hide the SysML v2 text |
| ⇧⌘M / Ctrl+Shift+M | Show or hide the problems panel |
| F8 / Shift+F8 | Next / previous problem |
| ⌘Z, ⇧⌘Z / Ctrl+Z, Ctrl+Shift+Z | Undo, redo |
| F2 | Rename |
| Delete | Delete the selection |
| Escape | Clear the selection |
| ⇧⌘H / Ctrl+Shift+H | All projects |
| ⌘, / Ctrl+, | Preferences |
| ⇧⌘E / Ctrl+Shift+E | Export the project (.loom.json) |

On a diagram: double-click a box for its properties, F2 or Enter to rename it, scroll to pan,
and pinch or Ctrl/⌘+scroll to zoom. On an internal block diagram, drag from a port to connect it.

Lines (relationships, flows, transitions, connectors) route themselves, but you can shape them:
**drag a segment** of a line to move it sideways (the line stays square and its ends stay on
their boxes), and **drag a line's label** to move it. Double-click a line or its label to make it
automatic again; *View → Make every line automatic again* and **Tidy layout** do that for the
whole diagram. Shaped lines are kept with the diagram, in project folders too.

## Where your work is

Projects live in this browser's storage on this device (IndexedDB). Export a `.loom.json` or a
`.zip` to back one up or move it, or save the project to a folder (Chrome, Edge and Arc) to keep
it as SysML text in git. Nothing is sent anywhere unless you send it: the SysML v2 API and the
optional Pteronautics Works link are off until you use them.
