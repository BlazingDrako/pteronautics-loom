// M9: interop and documents. ReqIF, CSV and Excel round trips and imports from other tools,
// Cameo XMI import, the SysML v2 API client against a mock server, document generation and
// diagram pictures, and the SysML library.
import { createModel } from '../../src/model/model.js';
import { buildKestrel } from '../../src/model/sample.js';
import { requirementsIn } from '../../src/model/trace.js';
import { exportReqif, readReqif, reqifText, roleOf } from '../../src/interop/reqif.js';
import { mergeRequirements, enumValue } from '../../src/interop/reqs.js';
import { parseCsv, toCsv, writeXlsx, readXlsx, rowsToRecords, requirementRows, requirementsXlsx } from '../../src/interop/sheet.js';
import { importXmi, xmiText, layerFromName } from '../../src/interop/xmi.js';
import { exportXmi, exportLines } from '../../src/interop/xmiexport.js';
import { createApiClient, modelFromApi, apiElementsOf, uuidFor } from '../../src/interop/api.js';
import { buildDocument, SECTIONS } from '../../src/interop/docs.js';
import { diagramSvg } from '../../src/interop/snapshot.js';
import { entries, entryForKind, CATEGORIES } from '../../src/library/entries.js';
import { figureFor } from '../../src/library/figures.js';
import { ELEMENTS, RELATIONSHIPS, isDiagram as isDiagramKind } from '../../src/model/metamodel.js';
import { zip } from '../../src/storage/zip.js';
import { validate } from '../../src/validate/engine.js';
import { fileFormat } from '../../src/ui/interop.js';

/** @param {() => unknown} fn */
const err = (fn) => { try { fn(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
/** @param {import('../../src/model/model.js').Model} m */
const R = (m) => /** @type {string} */ (m.layers().find((l) => l.layer === 'r')?.id);
/** Requirements as comparable text. @param {import('../../src/model/model.js').Model} m */
const reqSig = (m) => requirementsIn(m, R(m)).map(({ el, depth }) => `${depth}|${el.props.reqId}|${el.name}|${el.props.text}|${el.props.priority}|${el.props.status}|${el.props.method}`).sort().join('\n');

/** @param {import('../run.js').Log} log */
export async function interopTests(log) {
  const k = buildKestrel(createModel());
  const kr = R(k);

  // ---------- ReqIF ----------
  const xml = exportReqif(k, kr, { now: '2026-01-01T00:00:00Z' });
  log('ReqIF export is well-formed XML with the ReqIF 1.2 namespace', !new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror').length && xml.includes('http://www.omg.org/spec/ReqIF/20110401/reqif.xsd'));
  const rd = readReqif(xml);
  const nReq = k.byKind('requirement').length;
  log('Every requirement is a SPEC-OBJECT; packages are headings', rd.records.filter((r) => !r.heading).length === nReq && rd.records.some((r) => r.heading && r.name === 'System requirements'));
  log('Derive, copy and trace links between requirements are SPEC-RELATIONs', rd.rels.length === k.all().filter((r) => ['derive', 'copy', 'trace'].includes(r.kind) && k.get(/** @type {string} */ (r.source))?.kind === 'requirement' && k.get(/** @type {string} */ (r.target))?.kind === 'requirement').length);
  const fresh = createModel();
  let st = /** @type {any} */ (null);
  fresh.transact('Import', (tx) => { st = mergeRequirements(fresh, tx, R(fresh), rd.records, rd.rels); });
  log('ReqIF → a new project gives the same requirements (IDs, text, priority, status, method, nesting)', reqSig(fresh) === reqSig(k), `${st.created} created, ${st.warnings.join('; ')}`);
  log('Headings become packages with the same names', fresh.byKind('package').some((p) => p.name === 'Stakeholder needs') && fresh.byKind('package').some((p) => p.name === 'System requirements'));
  log('Relationships come back', fresh.all().filter((r) => r.kind === 'derive').length === k.all().filter((r) => r.kind === 'derive').length);
  // importing Loom's own file back updates the same requirements
  const edited = xml.replace('The air vehicle shall fly for at least 3.0 h at survey speed.', 'The air vehicle shall fly for at least 3.5 h at survey speed.');
  const rd2 = readReqif(edited, { isLoomId: (id) => !!k.get(id) });
  let st2 = /** @type {any} */ (null);
  k.transact('Reimport', (tx) => { st2 = mergeRequirements(k, tx, kr, rd2.records, rd2.rels); });
  log('Importing Loom\'s ReqIF again updates the changed requirement and adds nothing', st2.created === 0 && st2.updated === 1 && st2.unchanged === nReq - 1 && k.byKind('requirement').some((r) => /3\.5 h/.test(r.props.text)), JSON.stringify({ ...st2, warnings: st2.warnings.slice(0, 2) }));
  k.undo();

  // a file from another tool, with its own attribute names
  const doors = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<THE-HEADER><REQ-IF-HEADER IDENTIFIER="h1"><TITLE>Supplier spec</TITLE></REQ-IF-HEADER></THE-HEADER>
<CORE-CONTENT><REQ-IF-CONTENT>
<DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="dts" LONG-NAME="T" MAX-LENGTH="1000"/><DATATYPE-DEFINITION-XHTML IDENTIFIER="dtx"/>
<DATATYPE-DEFINITION-ENUMERATION IDENTIFIER="dtp"><SPECIFIED-VALUES><ENUM-VALUE IDENTIFIER="p1" LONG-NAME="High"/><ENUM-VALUE IDENTIFIER="p2" LONG-NAME="Low"/></SPECIFIED-VALUES></DATATYPE-DEFINITION-ENUMERATION></DATATYPES>
<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="t1"><SPEC-ATTRIBUTES>
<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="aid" LONG-NAME="Absolute Number"><TYPE><DATATYPE-DEFINITION-STRING-REF>dts</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>
<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="ahd" LONG-NAME="Object Heading"><TYPE><DATATYPE-DEFINITION-STRING-REF>dts</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>
<ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="atx" LONG-NAME="Object Text"><TYPE><DATATYPE-DEFINITION-XHTML-REF>dtx</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>
<ATTRIBUTE-DEFINITION-ENUMERATION IDENTIFIER="apr" LONG-NAME="Priority"><TYPE><DATATYPE-DEFINITION-ENUMERATION-REF>dtp</DATATYPE-DEFINITION-ENUMERATION-REF></TYPE></ATTRIBUTE-DEFINITION-ENUMERATION>
</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE><SPEC-RELATION-TYPE IDENTIFIER="rt" LONG-NAME="Derived from"/></SPEC-TYPES>
<SPEC-OBJECTS>
<SPEC-OBJECT IDENTIFIER="o1"><VALUES><ATTRIBUTE-VALUE-STRING THE-VALUE="Power"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>ahd</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING></VALUES></SPEC-OBJECT>
<SPEC-OBJECT IDENTIFIER="o2"><VALUES><ATTRIBUTE-VALUE-STRING THE-VALUE="SUP-7"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>aid</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>atx</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div><xhtml:p>The pack shall deliver <xhtml:b>48 V</xhtml:b>.</xhtml:p><xhtml:p>Second line.</xhtml:p></xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML>
<ATTRIBUTE-VALUE-ENUMERATION><DEFINITION><ATTRIBUTE-DEFINITION-ENUMERATION-REF>apr</ATTRIBUTE-DEFINITION-ENUMERATION-REF></DEFINITION><VALUES><ENUM-VALUE-REF>p1</ENUM-VALUE-REF></VALUES></ATTRIBUTE-VALUE-ENUMERATION></VALUES></SPEC-OBJECT>
<SPEC-OBJECT IDENTIFIER="o3"><VALUES><ATTRIBUTE-VALUE-STRING THE-VALUE="SUP-8"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>aid</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>
<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>atx</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE><xhtml:div>The pack shall weigh under 4 kg.</xhtml:div></THE-VALUE></ATTRIBUTE-VALUE-XHTML></VALUES></SPEC-OBJECT>
</SPEC-OBJECTS>
<SPEC-RELATIONS><SPEC-RELATION IDENTIFIER="r1"><TYPE><SPEC-RELATION-TYPE-REF>rt</SPEC-RELATION-TYPE-REF></TYPE><SOURCE><SPEC-OBJECT-REF>o3</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>o2</SPEC-OBJECT-REF></TARGET></SPEC-RELATION></SPEC-RELATIONS>
<SPECIFICATIONS><SPECIFICATION IDENTIFIER="s1"><CHILDREN><SPEC-HIERARCHY IDENTIFIER="hh1"><OBJECT><SPEC-OBJECT-REF>o1</SPEC-OBJECT-REF></OBJECT><CHILDREN>
<SPEC-HIERARCHY IDENTIFIER="hh2"><OBJECT><SPEC-OBJECT-REF>o2</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY><SPEC-HIERARCHY IDENTIFIER="hh3"><OBJECT><SPEC-OBJECT-REF>o3</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>
</CHILDREN></SPEC-HIERARCHY></CHILDREN></SPECIFICATION></SPECIFICATIONS>
</REQ-IF-CONTENT></CORE-CONTENT></REQ-IF>`;
  const sup = readReqif(doors);
  const dm = createModel();
  dm.transact('Import', (tx) => mergeRequirements(dm, tx, R(dm), sup.records, sup.rels));
  const s7 = dm.byKind('requirement').find((r) => r.props.reqId === 'SUP-7');
  log('DOORS-style attribute names are understood (Absolute Number, Object Heading, Object Text)', !!s7 && s7.props.text === 'The pack shall deliver 48 V.\nSecond line.' && dm.get(/** @type {string} */ (s7.owner))?.name === 'Power', s7 ? JSON.stringify(s7.props.text) : 'missing');
  log('Enumerations are mapped (High → Must) and relations by type name (Derived → derive)', s7?.props.priority === 'Must' && dm.all().some((r) => r.kind === 'derive'));
  log('A requirement with no name is named from its ID', s7?.name === 'SUP-7');
  log('Attribute names are recognised loosely', roleOf('ReqIF.Text') === 'text' && roleOf('object_text') === 'text' && roleOf('Verification Method') === 'method' && roleOf('Colour') === null);
  log('Enum values from other tools: High, medium, Accepted, T', enumValue('priority', 'High') === 'Must' && enumValue('priority', 'medium') === 'Should' && enumValue('status', 'Accepted') === 'Approved' && enumValue('method', 'T') === 'Test' && enumValue('status', 'weird') === null);
  log('A file that is not ReqIF is refused with a clear message', /not a ReqIF file/.test(err(() => readReqif('<x/>'))) && /not well-formed/.test(err(() => readReqif('<REQ-IF>'))));
  const reqifz = await zip({ 'spec/supplier.reqif': doors });
  log('.reqifz archives are read', (await reqifText(reqifz)).includes('SUP-7'));

  // ---------- CSV and Excel ----------
  const csv = parseCsv('﻿ID;Name;Text;Priority;Parent ID\r\nR-1;Top;"The system shall do ""this"";\nand more";High;\nR-2;Child;The thing shall be small.;low;R-1\n');
  log('CSV: separator found, quotes, doubled quotes and line breaks inside cells', csv.length === 3 && csv[1][2] === 'The system shall do "this";\nand more' && csv[2][4] === 'R-1');
  const cr = rowsToRecords(csv);
  const cm = createModel();
  cm.transact('CSV', (tx) => mergeRequirements(cm, tx, R(cm), cr.records, cr.rels));
  const r2 = cm.byKind('requirement').find((r) => r.props.reqId === 'R-2');
  log('CSV rows become requirements, nested by Parent ID', !!r2 && cm.get(/** @type {string} */ (r2.owner))?.props.reqId === 'R-1' && r2.props.priority === 'Could');
  log('A sheet without requirement columns is explained', /Name them ID, Name and Text/.test(err(() => rowsToRecords([['Foo', 'Bar'], ['1', '2']]))));
  const rows = requirementRows(k, kr);
  log('Requirements as rows: a header and one row per requirement', rows.length === nReq + 1 && rows[0][0] === 'ID');
  log('CSV out is Excel-friendly (byte-order mark, CRLF, quoting)', toCsv([['a,b', 'c"d']]) === '﻿"a,b","c""d"\r\n');
  const book = await requirementsXlsx(k, kr);
  const back = await readXlsx(book);
  log('Excel: Loom\'s workbook reads back cell for cell', back[0].name === 'Requirements' && back[0].rows.length === rows.length && back[0].rows[3].join('|') === rows[3].map(String).join('|'), back[0].rows[3]?.join('|'));
  const xm = createModel();
  const xr = rowsToRecords(back[0].rows);
  xm.transact('Excel', (tx) => mergeRequirements(xm, tx, R(xm), xr.records, xr.rels));
  log('Excel → a new project keeps IDs, text, priority, status, method and nesting', reqSig(xm).split('\n').map((l) => l.slice(2)).sort().join('\n') === reqSig(k).split('\n').map((l) => l.slice(2)).sort().join('\n'));
  const twoSheets = await readXlsx(await writeXlsx([{ name: 'A/B?', rows: [['x', 1.5], ['', 'y']] }, { name: 'Two', rows: [['z']] }]));
  log('Excel: numbers, empty cells, sheet names made safe', twoSheets.length === 2 && twoSheets[0].name === 'A B' && twoSheets[0].rows[0][1] === '1.5' && twoSheets[0].rows[1][0] === '' && twoSheets[1].rows[0][0] === 'z');
  log('File formats from names', fileFormat('a.reqifz') === 'reqif' && fileFormat('m.mdzip') === 'xmi' && fileFormat('x.XLSX') === 'xlsx' && fileFormat('p.loom.json') === 'loom' && fileFormat('p.zip') === 'loom');

  // ---------- Cameo XMI ----------
  const cameo = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20161101" xmlns:Blocks="http://www.omg.org/spec/SysML/20181001/Blocks" xmlns:Requirements="http://www.omg.org/spec/SysML/20181001/Requirements" xmlns:PortsAndFlows="http://www.omg.org/spec/SysML/20181001/PortsAndFlows" xmlns:Allocations="http://www.omg.org/spec/SysML/20181001/Allocations">
<uml:Model xmi:id="m1" name="Drone">
  <packagedElement xmi:type="uml:Package" xmi:id="pReq" name="Reqs">
    <packagedElement xmi:type="uml:Class" xmi:id="r1" name="Endurance">
      <nestedClassifier xmi:type="uml:Class" xmi:id="r2" name="Battery life"/>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="r3" name="Payload"/>
    <packagedElement xmi:type="uml:Abstraction" xmi:id="d1" client="r3" supplier="r1"/>
  </packagedElement>
  <packagedElement xmi:type="uml:Package" xmi:id="pArch" name="Architecture">
    <packagedElement xmi:type="uml:DataType" xmi:id="vtE" name="Energy"/>
    <packagedElement xmi:type="uml:InstanceSpecification" xmi:id="uWh" name="watt hour"/>
    <packagedElement xmi:type="uml:Class" xmi:id="ifP" name="Power">
      <ownedComment xmi:id="c0" body="DC power."/>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="bDrone" name="Drone">
      <ownedComment xmi:id="c1" body="The whole air vehicle."/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="pBatt" name="battery" type="bBatt" aggregation="composite"><upperValue xmi:type="uml:LiteralUnlimitedNatural" xmi:id="uv" value="2"/><lowerValue xmi:type="uml:LiteralInteger" xmi:id="lv" value="2"/></ownedAttribute>
      <ownedAttribute xmi:type="uml:Property" xmi:id="pMot" name="motor" type="bMot" aggregation="composite"/>
      <ownedConnector xmi:id="con1" name="">
        <end xmi:id="e1" role="ptOut" partWithPort="pBatt"/>
        <end xmi:id="e2" role="ptIn" partWithPort="pMot"/>
      </ownedConnector>
      <ownedBehavior xmi:type="uml:StateMachine" xmi:id="sm" name="Modes">
        <region xmi:id="rg" name="">
          <subvertex xmi:type="uml:Pseudostate" xmi:id="s0" kind="initial"/>
          <subvertex xmi:type="uml:State" xmi:id="s1" name="Idle"/>
          <subvertex xmi:type="uml:State" xmi:id="s2" name="Flying"><entry xmi:type="uml:Activity" xmi:id="en" name="arm"/></subvertex>
          <transition xmi:id="t0" source="s0" target="s1"/>
          <transition xmi:id="t1" source="s1" target="s2"><trigger xmi:id="tr1" name="takeoff"/><guard xmi:id="g1"><specification xmi:type="uml:OpaqueExpression" xmi:id="ge" body="battery &gt; 30%"/></guard></transition>
        </region>
      </ownedBehavior>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="bBatt" name="Battery">
      <ownedAttribute xmi:type="uml:Property" xmi:id="aCap" name="capacity" type="vtE"><defaultValue xmi:type="uml:LiteralReal" xmi:id="dv" value="650"/></ownedAttribute>
      <ownedAttribute xmi:type="uml:Port" xmi:id="ptOut" name="pwrOut" type="ifP"/>
      <generalization xmi:id="gen1" general="bStore"/>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="bStore" name="Energy Storage"/>
    <packagedElement xmi:type="uml:Class" xmi:id="bMot" name="Motor">
      <ownedAttribute xmi:type="uml:Port" xmi:id="ptIn" name="pwrIn" type="ifP" isConjugated="true"/>
    </packagedElement>
    <packagedElement xmi:type="uml:Abstraction" xmi:id="sat1"><client xmi:idref="bBatt"/><supplier xmi:idref="r2"/></packagedElement>
  </packagedElement>
  <packagedElement xmi:type="uml:Package" xmi:id="pOps" name="Operational Analysis">
    <packagedElement xmi:type="uml:Actor" xmi:id="ac1" name="Pilot"/>
    <packagedElement xmi:type="uml:UseCase" xmi:id="uc1" name="Fly a mission"/>
    <packagedElement xmi:type="uml:Package" xmi:id="pOpsSub" name="Detail">
      <packagedElement xmi:type="uml:Class" xmi:id="bOps" name="Ground Station"/>
    </packagedElement>
  </packagedElement>
  <packagedElement xmi:type="uml:Package" xmi:id="pMisc" name="Work in progress">
    <packagedElement xmi:type="uml:Activity" xmi:id="w1" name="Land"/>
    <packagedElement xmi:type="uml:Activity" xmi:id="w2" name="Charge"/>
    <packagedElement xmi:type="uml:UseCase" xmi:id="w3" name="Recharge between flights"/>
  </packagedElement>
  <packagedElement xmi:type="uml:Package" xmi:id="pHw" name="Physical Architecture">
    <packagedElement xmi:type="uml:Class" xmi:id="bCell" name="Li-ion cell"/>
  </packagedElement>
  <packagedElement xmi:type="uml:Package" xmi:id="pFn" name="Functions">
    <packagedElement xmi:type="uml:Activity" xmi:id="act" name="Fly">
      <node xmi:type="uml:InitialNode" xmi:id="n0"/>
      <node xmi:type="uml:OpaqueAction" xmi:id="n1" name="Take off"><outputValue xmi:type="uml:OutputPin" xmi:id="pin1"/></node>
      <node xmi:type="uml:CallBehaviorAction" xmi:id="n2" behavior="act2"/>
      <node xmi:type="uml:ActivityFinalNode" xmi:id="n3"/>
      <edge xmi:type="uml:ControlFlow" xmi:id="f1" source="n0" target="n1"/>
      <edge xmi:type="uml:ControlFlow" xmi:id="f2" source="pin1" target="n2"><guard xmi:type="uml:LiteralString" xmi:id="gg" value="ok"/></edge>
      <edge xmi:type="uml:ControlFlow" xmi:id="f3" source="n2" target="n3"/>
      <group xmi:type="uml:ActivityPartition" xmi:id="lane" name="Drone" represents="pMot" node="n1"/>
    </packagedElement>
    <packagedElement xmi:type="uml:Activity" xmi:id="act2" name="Survey"/>
  </packagedElement>
</uml:Model>
<Requirements:Requirement xmi:id="sr1" base_Class="r1" Id="REQ-1" Text="The drone shall fly 3 h."/>
<Requirements:Requirement xmi:id="sr2" base_Class="r2"><Id>REQ-1.1</Id><Text>The battery shall last.</Text></Requirements:Requirement>
<Requirements:Requirement xmi:id="sr3" base_Class="r3" Id="REQ-2" Text="Carry 2 kg."/>
<Requirements:DeriveReqt xmi:id="sd1" base_Abstraction="d1"/>
<Requirements:Satisfy xmi:id="ss1" base_Abstraction="sat1"/>
<Blocks:Block xmi:id="b1" base_Class="bDrone"/><Blocks:Block xmi:id="b2" base_Class="bBatt"/><Blocks:Block xmi:id="b3" base_Class="bMot"/><Blocks:Block xmi:id="b4" base_Class="bStore"/>
<PortsAndFlows:InterfaceBlock xmi:id="ib" base_Class="ifP"/>
<PortsAndFlows:ProxyPort xmi:id="pp" base_Port="ptOut"/>
<Blocks:ValueType xmi:id="vt" base_DataType="vtE" unit="uWh"/>
<xmi:Extension extender="MagicDraw UML 2021x"><modelExtension><ownedDiagram xmi:type="uml:Diagram" xmi:id="dg" name="Drone bdd"/></modelExtension></xmi:Extension>
</xmi:XMI>`;
  const xi = importXmi(cameo);
  const xmo = xi.model;
  const find = (/** @type {string} */ kind, /** @type {string} */ name) => xmo.byKind(kind).find((e) => e.name === name);
  log('XMI: the model is named, and requirements keep ID and text', xi.name === 'Drone' && find('requirement', 'Endurance')?.props.reqId === 'REQ-1' && find('requirement', 'Endurance')?.props.text === 'The drone shall fly 3 h.' && find('requirement', 'Battery life')?.props.text === 'The battery shall last.');
  log('XMI: nested requirements stay nested, in the Requirements layer, in their package', find('requirement', 'Battery life')?.owner === find('requirement', 'Endurance')?.id && xmo.layerOf(/** @type {string} */ (find('requirement', 'Endurance')?.id)) === 'r' && xmo.get(/** @type {string} */ (find('requirement', 'Endurance')?.owner))?.name === 'Reqs');
  log('XMI: blocks, interface blocks and value types (with QUDV unit) go to Logical', find('partDef', 'Drone')?.props.doc === 'The whole air vehicle.' && !!find('interfaceDef', 'Power') && find('valueType', 'Energy')?.props.unit === 'Wh' && xmo.layerOf(/** @type {string} */ (find('partDef', 'Drone')?.id)) === 'l');
  const batt = xmo.byKind('part').find((p) => p.name === 'battery');
  log('XMI: parts with type and multiplicity; values with defaults and value types', batt?.props.type === find('partDef', 'Battery')?.id && batt?.props.multiplicity === '2' && xmo.byKind('attribute').find((a) => a.name === 'capacity')?.props.value === '650' && xmo.byKind('attribute').find((a) => a.name === 'capacity')?.props.type === find('valueType', 'Energy')?.id);
  const pin = xmo.byKind('port').find((p) => p.name === 'pwrIn');
  log('XMI: ports typed by interface blocks, conjugation, proxy', pin?.props.type === find('interfaceDef', 'Power')?.id && pin?.props.conjugated === true);
  const conn = xmo.byKind('connector')[0];
  log('XMI: connectors through parts to ports', !!conn && conn.props.end1.path[0] === batt?.id && xmo.get(conn.props.end1.port)?.name === 'pwrOut' && conn.name === 'battery.pwrOut → motor.pwrIn');
  log('XMI: generalization, «satisfy» and «deriveReqt»', xmo.relsFrom(/** @type {string} */ (find('partDef', 'Battery')?.id)).some((r) => r.kind === 'generalize') && xmo.relsFrom(/** @type {string} */ (find('partDef', 'Battery')?.id)).some((r) => r.kind === 'satisfy' && r.target === find('requirement', 'Battery life')?.id) && xmo.relsFrom(/** @type {string} */ (find('requirement', 'Payload')?.id)).some((r) => r.kind === 'derive'));
  const fly = find('action', 'Fly');
  log('XMI: activities in Functional with actions, control nodes and flows (pins resolved)', !!fly && xmo.layerOf(fly.id) === 'f' && xmo.children(fly.id).filter((c) => c.kind === 'action').map((c) => c.name).sort().join() === 'Survey,Take off' && xmo.children(fly.id).filter((c) => c.kind === 'flow').length === 3 && xmo.children(fly.id).some((c) => c.kind === 'flow' && c.props.guard === 'ok'));
  log('XMI: a swimlane allocates its actions', xmo.relsFrom(/** @type {string} */ (xmo.byKind('action').find((a) => a.name === 'Take off')?.id)).some((r) => r.kind === 'allocate'));
  const fl = xmo.byKind('state').find((s) => s.name === 'Flying');
  log('XMI: state machines: states, initial, entry, transitions with trigger and guard', !!fl && fl.props.entry === 'arm' && xmo.byKind('state').some((s) => s.props.stateKind === 'initial') && xmo.byKind('transition').some((t) => t.props.trigger === 'takeoff' && t.props.guard === 'battery > 30%'));
  log('XMI: what is left out is counted (diagram layouts)', (xi.skipped['diagram layouts (Cameo\'s own format: open the elements on new Loom diagrams)'] || 0) === 1 && !!xi.skipped['InstanceSpecification elements'], JSON.stringify(xi.skipped));
  log('XMI: the imported model validates with no errors', validate(xmo).problems.filter((p) => p.severity === 'error').length === 0, validate(xmo).problems.filter((p) => p.severity === 'error').map((p) => p.message).join('; '));
  const mdzip = await zip({ 'com.nomagic.magicdraw.uml_model.model': cameo, 'com.nomagic.magicdraw.uml_model.snapshot': 'binary' });
  log('XMI: .mdzip project files are read', (await xmiText(mdzip)).includes('Drone'));
  const layerName = (/** @type {string} */ kind, /** @type {string} */ name) => { const e = find(kind, name); return e ? xmo.layerOf(e.id) : null; };
  log('XMI: a package named for a layer keeps all it holds there (use cases, actors, a sub-package with a block)', layerName('useCase', 'Fly a mission') === 'f' && layerName('actor', 'Pilot') === 'f' && layerName('partDef', 'Ground Station') === 'f' && xmo.byKind('package').filter((p) => p.name === 'Operational Analysis').length === 1, `${layerName('useCase', 'Fly a mission')} ${layerName('actor', 'Pilot')} ${layerName('partDef', 'Ground Station')}`);
  log('XMI: a package with no telling name goes where most of it belongs, whole', layerName('useCase', 'Recharge between flights') === 'f' && layerName('action', 'Land') === 'f' && xmo.byKind('package').filter((p) => p.name === 'Work in progress').length === 1);
  log('XMI: "Physical Architecture" is physical, not logical', layerName('partDef', 'Li-ion cell') === 'p');
  log('XMI: the report says where packages went and why', xi.notes.some((n) => /Operational Analysis.*Functional, by its name/.test(n)) && xi.notes.some((n) => /Work in progress.*Functional, by what it holds/.test(n)));
  log('XMI: layer words in names', layerFromName('Functional Requirements') === 'r' && layerFromName('Physical Architecture') === 'p' && layerFromName('Functional Architecture') === 'f' && layerFromName('System Architecture') === 'l' && layerFromName('Drone') === null);
  log('XMI: a file without a UML model is refused', /no UML model/.test(err(() => importXmi('<xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001"/>'))));

  // ---------- XMI export (to Cameo) ----------
  {
  const ex = exportXmi(k);
  const exDoc = new DOMParser().parseFromString(ex.text, 'application/xml');
  log('XMI export is well-formed XML with the XMI 2.5.1, UML 2.5.1 and SysML 1.6 namespaces', !exDoc.getElementsByTagName('parsererror').length && ex.text.includes('http://www.omg.org/spec/XMI/20131001') && ex.text.includes('http://www.omg.org/spec/UML/20161101') && ex.text.includes('http://www.omg.org/spec/SysML/20181001/SysML'));
  const ids = [...exDoc.getElementsByTagName('*')].map((e) => e.getAttributeNS('http://www.omg.org/spec/XMI/20131001', 'id')).filter(Boolean);
  log('XMI export: every xmi:id is unique and starts with a letter or underscore', ids.length > 100 && new Set(ids).size === ids.length && ids.every((i) => /^[A-Za-z_][\w.-]*$/.test(/** @type {string} */ (i))), `${ids.length} ids, ${new Set(ids).size} distinct`);
  const idSet = new Set(ids);
  const dangling = [...exDoc.getElementsByTagName('*')].flatMap((e) => ['type', 'general', 'client', 'supplier', 'role', 'partWithPort', 'source', 'target', 'covered', 'sendEvent', 'receiveEvent', 'message', 'represents', 'addition', 'extendedCase', 'importedPackage', 'event', 'signal', 'unit', 'propertyPath', 'memberEnd', 'subject', 'behavior', 'idref'].flatMap((a) => (e.getAttribute(a) || (a === 'idref' ? e.getAttributeNS('http://www.omg.org/spec/XMI/20131001', 'idref') : '') || '').split(/\s+/).filter(Boolean)).filter((r) => !idSet.has(r)).map((r) => `${e.localName}→${r}`));
  log('XMI export: every reference points at an element in the file', !dangling.length, dangling.slice(0, 5).join(', '));
  log('XMI export: every Loom element is written or counted as left out', Object.values(ex.counts).reduce((a, b) => a + b, 0) > 0 && exportLines(ex).made.length > 5);
  const back = importXmi(ex.text).model;
  const kinds = ['requirement', 'testCase', 'partDef', 'interfaceDef', 'constraintDef', 'part', 'port', 'constraint', 'connector', 'actor', 'useCase', 'interaction', 'lifeline', 'message', 'state', 'transition', 'controlNode', 'flow', 'action'];
  const diff = kinds.filter((kd) => k.byKind(kd).length !== back.byKind(kd).length).map((kd) => `${kd} ${k.byKind(kd).length}→${back.byKind(kd).length}`);
  log('XMI round trip: the Kestrel sample comes back with the same number of each kind', !diff.length, diff.join(', '));
  const inStereo = (/** @type {import('../../src/model/model.js').Model} */ mm) => mm.byKind('attribute').filter((a) => mm.get(/** @type {string} */ (a.owner))?.kind !== 'stereotype');
  log('XMI round trip: every value property comes back (stereotype tags are left out)', inStereo(k).length === back.byKind('attribute').length, `${inStereo(k).length} → ${back.byKind('attribute').length}`);
  /** Each value's effective unit (its own, or its value type's). @param {import('../../src/model/model.js').Model} mm */
  const units = (mm) => inStereo(mm).map((a) => `${mm.get(/** @type {string} */ (a.owner))?.name}.${a.name}=${a.props.value || ''}[${a.props.unit || (a.props.type ? mm.get(a.props.type)?.props.unit : '') || ''}]`).sort().join(',');
  log('XMI round trip: values keep their unit (on a value type made for it when they have none)', units(k) === units(back), `${units(k)} vs ${units(back)}`);
  log('XMI export: a value type is made for each unit used without one', ex.text.includes('name="Real[Ah]"') || ex.text.includes('name="Real[') );
  const relKinds = ['satisfy', 'verify', 'derive', 'refine', 'trace', 'copy', 'allocate', 'generalize', 'include', 'extend', 'participate'];
  const relDiff = relKinds.filter((kd) => k.byKind(kd).length !== back.byKind(kd).length).map((kd) => `${kd} ${k.byKind(kd).length}→${back.byKind(kd).length}`);
  log('XMI round trip: the same relationships of each kind', !relDiff.length, relDiff.join(', '));
  log('XMI round trip: requirements keep their ID, text and nesting', reqSig(k).split('\n').map((l) => l.split('|').slice(0, 4).join('|')).join('\n') === requirementsIn(back, R(back)).map(({ el, depth }) => `${depth}|${el.props.reqId}|${el.name}|${el.props.text}`).sort().join('\n'));
  const sig = (/** @type {import('../../src/model/model.js').Model} */ mm) => mm.byKind('partDef').map((b) => `${b.name}:${mm.children(b.id).filter((c) => ['part', 'port', 'attribute'].includes(c.kind)).map((c) => `${c.kind}/${c.name}/${c.props.type && !/^Real\[/.test(mm.get(c.props.type)?.name || '') ? mm.get(c.props.type)?.name : ''}/${c.props.multiplicity || ''}/${c.props.value || ''}/${c.props.conjugated ? '~' : ''}/${c.props.portKind || ''}`).sort().join(',')}`).sort().join('\n');
  log('XMI round trip: blocks keep their parts, ports and values (types, multiplicities, defaults, conjugation)', sig(k) === sig(back));
  const vts = (/** @type {import('../../src/model/model.js').Model} */ mm) => mm.byKind('valueType').filter((v) => !/^Real\[/.test(v.name)).map((v) => `${v.name}/${v.props.unit || ''}`).sort().join(',');
  log('XMI round trip: value types keep their units', vts(k) === vts(back), `${vts(k)} vs ${vts(back)}`);
  /** Messages of each interaction in reading order (through fragments). @param {import('../../src/model/model.js').Model} mm */
  const msgs = (mm) => mm.byKind('interaction').map((i) => { const out = []; const walk = (/** @type {string} */ id) => { for (const c of mm.children(id)) { if (c.kind === 'message') out.push(`${c.name}/${c.props.msgKind}/${mm.get(c.props.from)?.name}>${mm.get(c.props.to)?.name}`); else walk(c.id); } }; walk(i.id); return `${i.name}: ${out.join('; ')}`; }).sort().join('\n');
  log('XMI round trip: messages keep their order, kind and lifelines', msgs(k) === msgs(back), `${msgs(k)} vs ${msgs(back)}`);
  const lls = (/** @type {import('../../src/model/model.js').Model} */ mm) => mm.byKind('lifeline').map((l) => `${l.name}/${l.props.represents ? mm.get(l.props.represents)?.name : ''}`).sort().join(',');
  log('XMI round trip: lifelines keep what they represent', lls(k) === lls(back), `${lls(k)} vs ${lls(back)}`);
  const trs = (/** @type {import('../../src/model/model.js').Model} */ mm) => mm.byKind('transition').map((t) => `${mm.get(t.props.from)?.name}>${mm.get(t.props.to)?.name}/${t.props.trigger}/${t.props.guard}/${t.props.effect}`).sort().join(',');
  log('XMI round trip: transitions keep trigger, guard and effect', trs(k) === trs(back), `${trs(k)} vs ${trs(back)}`);
  const cons = (/** @type {import('../../src/model/model.js').Model} */ mm) => mm.byKind('constraintDef').map((c) => `${c.name}/${c.props.expr}`).sort().join(',');
  log('XMI round trip: constraint blocks keep their equation', cons(k) === cons(back), `${cons(k)} vs ${cons(back)}`);
  log('XMI round trip: the sets come back as the sets, not as packages of the same name inside them', back.layers().every((l) => !back.children(l.id).some((c) => c.kind === 'package' && c.name === l.name)) && k.layers().every((l) => back.children(/** @type {string} */ (back.layers().find((b) => b.layer === l.layer)?.id)).length >= k.children(l.id).filter((c) => !isDiagramKind(c.kind)).length));
  log('XMI export: diagrams are counted as left out', Object.keys(ex.skipped).some((x) => /^diagrams/.test(x)));
  const tiny = createModel({ name: 'A & B <test>' });
  tiny.transact('x', (tx) => { const L = tiny.layers()[2].id; tx.create('partDef', { owner: L, name: 'Ω "block"', props: { doc: 'line 1\nline 2' } }); });
  const tinyBack = importXmi(exportXmi(tiny).text).model;
  log('XMI round trip: names and multi-line descriptions with special characters survive', tinyBack.root().name === 'A & B <test>' && tinyBack.byKind('partDef')[0]?.name === 'Ω "block"' && tinyBack.byKind('partDef')[0]?.props.doc === 'line 1\nline 2');
  }

  // ---------- SysML v2 API ----------
  const server = mockApi();
  const client = createApiClient('http://example.test/api', { fetch: server.fetch, pageSize: 50 });
  const { elements, left } = apiElementsOf(k);
  const proj = await client.createProject('Kestrel', 'test');
  await client.commit(proj['@id'], elements, proj.defaultBranch?.['@id']);
  log('API: a project is created and the model committed', server.count() === elements.length && (await client.projects()).length === 1);
  log('API: ids are stable UUIDs', uuidFor('abc', 's') === uuidFor('abc', 's') && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuidFor('abc', 's')));
  const head = await client.headCommit(proj['@id']);
  let pages = 0;
  const got = await client.elements(proj['@id'], head, () => { pages++; });
  log('API: elements are read page by page (Link headers)', got.length === elements.length && pages > 1, `${got.length} in ${pages} pages`);
  const am = modelFromApi(got, 'Kestrel').model;
  const cnt = (/** @type {any} */ m, /** @type {string} */ kind) => m.byKind(kind).filter((/** @type {any} */ e) => m.get(e.owner)?.kind !== 'stereotype').length;
  log('API: requirements, blocks, parts, ports, values and functions come back', ['requirement', 'partDef', 'part', 'port', 'attribute', 'action', 'interfaceDef', 'testCase'].every((kk) => cnt(am, kk) === cnt(k, kk)), ['requirement', 'partDef', 'part', 'port', 'attribute', 'action', 'interfaceDef', 'testCase'].map((kk) => `${kk} ${cnt(am, kk)}/${cnt(k, kk)}`).join(', '));
  log('API: requirement IDs and text, and layers, are kept (priority and status have no SysML v2 form)', reqSig(am).replace(/\|[^|\n]*\|[^|\n]*\|[^|\n]*$/gm, '') === reqSig(k).replace(/\|[^|\n]*\|[^|\n]*\|[^|\n]*$/gm, '') && am.byKind('partDef').every((b) => am.layerOf(b.id) === k.layerOf(/** @type {string} */ (k.byKind('partDef').find((x) => x.name === b.name)?.id))));
  log('API: typing, satisfy, verify and generalization come back', am.byKind('part').every((p) => !!p.props.type) && cnt(am, 'satisfy') === cnt(k, 'satisfy') && cnt(am, 'verify') === cnt(k, 'verify') && cnt(am, 'generalize') === cnt(k, 'generalize'), `satisfy ${cnt(am, 'satisfy')}/${cnt(k, 'satisfy')} verify ${cnt(am, 'verify')}/${cnt(k, 'verify')}`);
  log('API: what has no SysML v2 form yet is counted', left > 0);
  log('API: a bad address and server errors are explained', /http/.test(err(() => createApiClient('ftp://x'))) && /answered 404/.test(await createApiClient('http://example.test/api', { fetch: server.fetch }).headCommit('nope').then(() => '', (e) => e.message)));
  const unreachable = createApiClient('http://example.test', { fetch: async () => { throw new TypeError('Failed to fetch'); } });
  log('API: an unreachable server mentions CORS', /CORS/.test(await unreachable.projects().then(() => '', (e) => e.message)));

  // ---------- documents ----------
  const doc = buildDocument(k, { date: '2026-01-01', author: 'A. Engineer' });
  log('A document has a cover, contents and every section', doc.startsWith('<!doctype html>') && doc.includes('A. Engineer') && SECTIONS.filter(([id]) => id !== 'diagrams').every(([, t]) => doc.includes(`>${t.split(' (')[0].replace(' and coverage', '')}<`) || doc.includes(t.split(' ')[0])) && doc.includes('<nav class="toc">'));
  log('Requirements appear with ID, text, satisfied by and verification result', doc.includes('REQ-PRF-001') && doc.includes('The air vehicle shall fly for at least 3.0 h') && doc.includes('class="res failed"'));
  log('Blocks with stereotypes, parts, ports and computed values', doc.includes('«Flight critical»') && doc.includes('Parts of Kestrel Air Vehicle') && doc.includes('Ports of Battery Pack'));
  log('Links point at entries in the document', /<a href="#e-[\w-]+">/.test(doc));
  const only = buildDocument(k, { sections: ['requirements'] });
  log('Sections can be chosen', !only.includes('Architecture') && only.includes('Requirements'));
  const tricky = createModel({ name: '<script>alert(1)</script>' });
  tricky.transact('x', (tx) => tx.create('requirement', { owner: R(tricky), name: 'A & B <b>', props: { text: '"quoted" <tag>' } }));
  const td = buildDocument(tricky);
  log('Names and text are escaped', !td.includes('<script>alert') && td.includes('A &amp; B &lt;b&gt;'));
  const bddId = /** @type {string} */ (k.byKind('bdd')[0]?.id);
  const pic = await diagramSvg(k, bddId, 'sysml');
  log('A diagram is drawn as a standalone SVG (inline styles, no classes, no mouse targets)', !!pic && pic.svg.startsWith('<svg') && pic.svg.includes('Battery Pack') && !/ class="/.test(pic.svg) && !pic.svg.includes('data-id') && pic.w > 100 && pic.h > 100, pic ? `${pic.w}×${pic.h}, ${pic.svg.length} chars` : 'none');
  const ibdPic = await diagramSvg(k, /** @type {string} */ (k.byKind('ibd')[0]?.id), 'sysml');
  const sdPic = await diagramSvg(k, /** @type {string} */ (k.byKind('sd')[0]?.id), 'sysml');
  log('Internal block and sequence diagrams are drawn too', !!ibdPic && ibdPic.svg.includes('<path') && !!sdPic && sdPic.svg.includes('<text'));
  const withPics = buildDocument(k, { sections: ['diagrams'], diagrams: new Map([[bddId, /** @type {any} */ (pic)]]) });
  log('Pictures go into the document as figures', withPics.includes('<figure') && withPics.includes('Figure 1.') && withPics.includes('<svg'));

  // ---------- library ----------
  const all = entries();
  log('The library has an entry for every element and relationship kind', Object.keys(ELEMENTS).every((kk) => all.some((e) => e.id === entryForKind(kk))) && Object.keys(RELATIONSHIPS).every((kk) => all.some((e) => e.id === entryForKind(kk))));
  log('Every "see also" link leads somewhere', all.every((e) => (e.see || []).every((s) => all.some((x) => x.id === s))), all.flatMap((e) => (e.see || []).filter((s) => !all.some((x) => x.id === s)).map((s) => `${e.id}→${s}`)).join(', '));
  log('Every entry has a category, a summary and a body; ids are unique', all.every((e) => CATEGORIES.includes(e.category) && e.summary && e.body) && new Set(all.map((e) => e.id)).size === all.length);
  const figs = all.map((e) => ({ e, f: figureFor(e) }));
  log('Every library entry has a picture with a caption', figs.every((x) => x.f && x.f.caption && x.f.svg.querySelector('text, path, rect')), figs.filter((x) => !x.f).map((x) => x.e.id).join(', '));
  log('Library pictures keep their arrowheads to themselves', (() => { const ids = figs.flatMap((x) => [...(x.f?.svg.querySelectorAll('marker') || [])].map((mm) => mm.id)); return new Set(ids).size === ids.length; })());
  log('Concept articles cover the basics', ['mbse', 'rflp', 'traceability', 'writing-requirements', 'profiles', 'exchange'].every((id) => all.some((e) => e.id === id)));
}

/** A small in-memory server for the Systems Modeling API (projects, branches, commits, paged elements). */
function mockApi() {
  /** @type {Map<string, any>} */
  const projects = new Map();
  /** @type {Map<string, any[]>} commit id → elements */
  const commits = new Map();
  let n = 0;
  const reply = (/** @type {any} */ body, status = 200, /** @type {Record<string, string>} */ headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  return {
    count: () => [...commits.values()].reduce((a, b) => a + b.length, 0),
    /** @param {any} input @param {any} [init] */
    async fetch(input, init = {}) {
      const url = new URL(String(input));
      const p = url.pathname.replace(/^\/api/, '');
      const method = init.method || 'GET';
      let mm;
      if (p === '/projects' && method === 'GET') return reply([...projects.values()]);
      if (p === '/projects' && method === 'POST') { const body = JSON.parse(init.body); const id = `p${++n}`; const pr = { '@id': id, '@type': 'Project', name: body.name, description: body.description, defaultBranch: { '@id': `b${id}` }, head: null }; projects.set(id, pr); return reply(pr, 201); }
      if ((mm = p.match(/^\/projects\/([^/]+)$/))) return projects.has(mm[1]) ? reply(projects.get(mm[1])) : reply({ error: 'not found' }, 404);
      if ((mm = p.match(/^\/projects\/([^/]+)\/branches\/([^/]+)$/))) { const pr = projects.get(mm[1]); return pr ? reply({ '@id': mm[2], '@type': 'Branch', head: pr.head ? { '@id': pr.head } : null }) : reply({}, 404); }
      if ((mm = p.match(/^\/projects\/([^/]+)\/commits$/)) && method === 'POST') {
        const pr = projects.get(mm[1]); if (!pr) return reply({}, 404);
        const body = JSON.parse(init.body); const cid = `c${++n}`;
        commits.set(cid, body.change.map((/** @type {any} */ c) => c.payload)); pr.head = cid;
        return reply({ '@id': cid, '@type': 'Commit' }, 201);
      }
      if ((mm = p.match(/^\/projects\/([^/]+)\/commits\/([^/]+)\/elements$/))) {
        const all = commits.get(mm[2]); if (!all) return reply({}, 404);
        const size = Number(url.searchParams.get('page[size]') || 100), after = Number(url.searchParams.get('page[after]') || 0);
        const page = all.slice(after, after + size);
        const next = after + size < all.length ? `<${url.origin}/api${p}?page[size]=${size}&page[after]=${after + size}>; rel="next"` : '';
        return reply(page, 200, next ? { Link: next } : {});
      }
      return reply({ error: `no route ${method} ${p}` }, 404);
    },
  };
}
