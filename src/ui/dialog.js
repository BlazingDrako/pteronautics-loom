// Small modal dialogs: prompt, confirm and a custom form. Focus is trapped inside and
// returned afterwards; Esc cancels; Enter submits.
import { h } from './dom.js';

/**
 * Open a modal. `build` returns the body and a function that produces the result.
 * @template T
 * @param {{ title: string, ok?: string, danger?: boolean, build: (close: (v: T | null) => void) => { body: HTMLElement, value: () => T | null, focus?: HTMLElement } }} o
 * @returns {Promise<T | null>} null when cancelled
 */
export function modal(o) {
  return new Promise((resolve) => {
    const returnFocus = /** @type {HTMLElement | null} */ (document.activeElement);
    const done = (/** @type {T | null} */ v) => { back.remove(); returnFocus?.focus?.(); resolve(v); };
    const parts = o.build(done);
    const okBtn = h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary'), type: 'submit' }, o.ok || 'OK');
    const form = h('form', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title' }, o.title),
      parts.body,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), okBtn));
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = parts.value(); if (v !== null) done(v); });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      if (e.key === 'Tab') { // keep focus inside
        const f = /** @type {HTMLElement[]} */ ([...form.querySelectorAll('button, input, textarea, select, [tabindex]')]).filter((x) => !x.hasAttribute('disabled'));
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    const back = h('div', { class: 'dialog-back' }, form);
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
    document.body.append(back);
    (parts.focus || okBtn).focus();
    if (parts.focus instanceof HTMLInputElement) parts.focus.select();
  });
}

/** Ask for a line of text. @param {{ title: string, label: string, value?: string, ok?: string, hint?: string }} o */
export function prompt(o) {
  return modal({
    title: o.title, ok: o.ok,
    build: () => {
      const input = h('input', { class: 'field', type: 'text', value: o.value || '', 'aria-label': o.label, maxlength: 200 });
      const err = h('div', { class: 'field-error', role: 'alert' });
      return {
        body: h('label', { class: 'field-label' }, o.label, input, o.hint ? h('small', {}, o.hint) : null, err),
        focus: input,
        value: () => { const v = input.value.trim(); if (!v) { err.textContent = 'Please enter a name.'; input.focus(); return null; } return v; },
      };
    },
  });
}

/** Ask yes or no. @param {{ title: string, body: string, ok?: string, danger?: boolean }} o @returns {Promise<boolean>} */
export async function confirm(o) {
  const r = await modal({ title: o.title, ok: o.ok, danger: o.danger, build: () => ({ body: h('p', { class: 'dialog-text' }, o.body), value: () => true }) });
  return r === true;
}
