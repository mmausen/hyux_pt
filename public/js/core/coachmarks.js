// Coach marks: a guided tour that highlights one region at a time with a short explanation and
// Back / Next buttons. Mode-independent: the steps and their target elements come from the caller.
//
//   const tour = runCoachmarks({ steps, resolveTarget, labels, onStep });
//   await tour.done;   // resolves after Next on the last step
//   tour.destroy();
// steps: [{ title, text }], resolveTarget(step, index) → Element, labels: { back, next, last, progress(i, n) }
import { h } from './dom.js';

const GAP = 12;
const PAD = 6;

export function runCoachmarks({ steps, resolveTarget, labels, onStep }) {
  let index = 0;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const spot = h('div.app-coach__spot');
  const title = h('span.app-coach__title', { id: 'coach-title' });
  const progress = h('span.app-coach__progress');
  const text = h('p.app-coach__text', { id: 'coach-text' });
  const back = h('button.fh-btn.fh-btn--transparent', { type: 'button' }, labels.back);
  const next = h('button.fh-btn.fh-btn--emphasized', { type: 'button' });
  const pop = h('div.fh-popover.app-coach__pop', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'coach-title', 'aria-describedby': 'coach-text' },
    h('div.fh-popover__header', title, progress),
    h('div.fh-popover__content', text, h('div.app-coach__actions', back, next)));
  const root = h('div.app-coach', spot, pop);

  function position() {
    const target = resolveTarget(steps[index], index);
    if (!target) return;
    target.scrollIntoView?.({ block: 'nearest' });
    const r = target.getBoundingClientRect();
    Object.assign(spot.style, { left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px` });

    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top;
    let left = r.left + r.width / 2 - pw / 2;
    if (vh - r.bottom - PAD >= ph + GAP) top = r.bottom + PAD + GAP; // below
    else if (r.top - PAD >= ph + GAP) top = r.top - PAD - GAP - ph; // above
    else { // beside
      top = Math.min(Math.max(GAP, r.top), vh - ph - GAP);
      left = r.right + PAD + GAP + pw <= vw ? r.right + PAD + GAP : r.left - PAD - GAP - pw;
    }
    left = Math.min(Math.max(GAP, left), vw - pw - GAP);
    Object.assign(pop.style, { left: `${left}px`, top: `${Math.max(GAP, top)}px` });
  }

  function show(i) {
    index = i;
    const step = steps[i];
    title.textContent = step.title;
    text.textContent = step.text;
    progress.textContent = labels.progress(i + 1, steps.length);
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? labels.last : labels.next;
    onStep?.(i, step);
    // Focus Next so Enter walks through the tour; the dialog's label and description are announced with it.
    requestAnimationFrame(() => { position(); next.focus(); });
  }

  back.addEventListener('click', () => index > 0 && show(index - 1));
  next.addEventListener('click', () => (index < steps.length - 1 ? show(index + 1) : resolveDone()));
  const onResize = () => position();
  // Keep keyboard focus inside the popover (the page behind it is inert), and let the arrow keys page.
  const onKey = (e) => {
    if (e.key === 'ArrowRight' && !next.disabled) { e.preventDefault(); next.click(); }
    else if (e.key === 'ArrowLeft' && !back.disabled) { e.preventDefault(); back.click(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const order = [back, next].filter((b) => !b.disabled);
      const at = order.indexOf(document.activeElement);
      order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
    }
  };
  // Pull focus back if it lands on the page behind the tour (other overlays, such as the dev panel, keep it).
  const onFocusOut = () => setTimeout(() => {
    const el = document.activeElement;
    if (!el || el === document.body || document.getElementById('app').contains(el)) next.focus();
  });
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  pop.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusOut);
  root.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target)) { e.preventDefault(); next.focus(); } });

  document.body.append(root);
  document.getElementById('app').inert = true;
  show(0);

  return {
    done,
    destroy() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      document.removeEventListener('focusin', onFocusOut);
      root.remove();
      document.getElementById('app').inert = false;
    },
  };
}
