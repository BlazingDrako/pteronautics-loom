// The validation worker: keeps its own copy of the project's model, follows the app's edits
// (only the elements each edit touched are sent), and runs every rule that is on when asked,
// so checking a large project never takes time away from typing or dragging.
//
// Messages in:  { t: 'load', elements }        the whole model, owners before children
//               { t: 'patch', changes }         elements changed since: [{ id, el | null, d, i }]
//               { t: 'run', seq, version }      validate now
// Messages out: { t: 'report', seq, version, problems, ignored, ms }
import { createModel } from '../model/model.js';
import { validate, portable } from './engine.js';

/** @type {import('../model/model.js').Model | null} */
let model = null;

self.onmessage = (ev) => {
  const d = ev.data;
  if (d.t === 'load') {
    model = createModel({ empty: true });
    model.loadRaw(d.elements);
  } else if (d.t === 'patch') {
    model?.patch(d.changes);
  } else if (d.t === 'run') {
    if (!model) return;
    const r = validate(model);
    self.postMessage({ t: 'report', seq: d.seq, version: d.version, problems: portable(r.problems), ignored: r.ignored, ms: r.ms });
  }
};
