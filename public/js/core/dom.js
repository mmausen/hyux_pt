// Tiny DOM helpers. Text is always set with textContent, so transcripts and AI output can never inject markup.

// h('button.fh-btn.fh-btn--emphasized', { onclick, disabled: true }, 'Start')
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const icon = (name, extra = '') => h(`span.fh-icon${extra ? `.${extra}` : ''}`, { 'data-icon': name, 'aria-hidden': 'true' });

// MessageStrip. design: information | success | warning | error
export function messageStrip(design, text, { role } = {}) {
  const iconName = { information: 'message-information', success: 'message-success', warning: 'message-warning', error: 'message-error' }[design];
  return h(`div.fh-msg.fh-msg--${design}`, { role: role ?? (design === 'error' ? 'alert' : 'status') },
    iconName && icon(iconName), h('span.fh-msg__text', text));
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}
