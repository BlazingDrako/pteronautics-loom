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
| Model browser (left) | Everything in the model, in four layers: **Requirements**, **Functional**, **Logical**, **Physical** (RFLP). Drag to move, F2 to rename, **+** to add |
| Stage (middle) | The open diagrams, tables and views, as tabs. **Systems V** shows how far each stage of the V is, and **Model overview** counts it all |
| Inspector (right) | The selected element: its properties, relationships, problems and where it appears. Mod+. hides it |
| Status bar | Where the project is saved, its size, its problems (click to open the problems panel) and the notation |

The **command palette** (Mod+K) runs any command and finds any element by name. Every command
with a shortcut shows it there; change shortcuts in Preferences (Mod+,).

### Notation

Loom shows the same model in three notations, chosen in Preferences: **SysML** (the v1 names
engineers know: block, part property, block definition diagram), **SysML v2** (part def, part,
general view) and **Guided** (plain words for newcomers). The notation never changes the model.

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
   export requirements to ReqIF or Excel and import them back; send the model to a SysML v2 API
   server.

## Text

Mod+E shows the model as SysML v2 text, one file per layer. Edit the text and apply it: Loom
matches what you wrote to the elements already there, so diagrams keep their layout. Project
folders are this same text, plus `.loom/` for ids and layout. The README lists the text format.

## Shortcuts

| Keys (Mac / others) | Command |
| --- | --- |
| ⌘K / Ctrl+K | Command palette: any command, any element |
| ? | The SysML library, on the selected element's kind |
| ⌘. / Ctrl+. | Show or hide the inspector |
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

On a diagram: double-click a box to rename it, scroll to pan, and pinch or Ctrl/⌘+scroll to
zoom. On an internal block diagram, drag from a port to connect it.

## Where your work is

Projects live in this browser's storage on this device (IndexedDB). Export a `.loom.json` or a
`.zip` to back one up or move it, or save the project to a folder (Chrome, Edge and Arc) to keep
it as SysML text in git. Nothing is sent anywhere unless you send it: the SysML v2 API and the
optional Pteronautics Works link are off until you use them.
