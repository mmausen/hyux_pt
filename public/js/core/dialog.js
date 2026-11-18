// Modal dialog (fh-dialog over fh-blocklayer). Returns a handle with close().
//   openDialog({ title, content, actions: [{ label, emphasized, onClick }], onCancel, state })
// Escape and Cancel call onCancel; without onCancel the dialog cannot be dismissed by the participant.
import { h } from './dom.js';

let counter = 0;

export function openDialog({ title, content, actions = [], onCancel, state, className = '' }) {
  const id = `dlg-${++counter}`;
  const previousFocus = document.activeElement;
  const buttons = actions.map((a) => h(`button.fh-btn${a.emphasized ? '.fh-btn--emphasized' : '.fh-btn--transparent'}`,
    { type: 'button', onclick: () => a.onClick?.() }, a.label));
  const dialog = h(`div.fh-dialog${state ? `.fh-dialog--${state}` : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-t`, tabindex: '-1', class: className },
    h('div.fh-dialog__header', h('span.fh-dialog__title', { id: `${id}-t` }, title)),
    h('div.fh-dialog__content', content),
    buttons.length ? h('div.fh-dialog__footer', buttons) : null);
  const root = h('div.app-modal', h('div.fh-blocklayer'), dialog);

  const keydown = (e) => {
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  root.addEventListener('keydown', keydown);
  document.getElementById('app').inert = true;
  document.body.append(root);
  (buttons[0] ?? dialog).focus();

  return {
    el: dialog,
    close() {
      root.remove();
      document.getElementById('app').inert = false;
      if (previousFocus?.isConnected) previousFocus.focus();
    },
  };
}
