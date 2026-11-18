// Flow controller: a simple state machine over the step list built from config.
// Steps: flow.pre, then flow.round × N (each step tagged with its round), then flow.post.
// Every screen module exports a factory returning { mount(container, ctx), unmount() }.
import { h, clear, messageStrip } from './dom.js';
import { t } from './strings.js';
import { logEvent } from './logEvent.js';
import { loadScreen } from '../screens/index.js';

export function buildSteps(cfg) {
  const steps = [];
  for (const screen of cfg.flow.pre) steps.push({ screen, round: null });
  for (let round = 1; round <= cfg.flow.rounds; round++) {
    for (const screen of cfg.flow.round) steps.push({ screen, round });
  }
  for (const screen of cfg.flow.post) steps.push({ screen, round: null });
  return steps.map((s, index) => ({ ...s, index }));
}

export function createFlow({ container, steps, ctx, onStepChange }) {
  let index = -1;
  let current = null;
  let token = 0;
  const listeners = new Set();

  const flow = {
    steps,
    get index() { return index; },
    get step() { return steps[index] ?? null; },

    indexOf(screen, round = null) {
      return steps.findIndex((s) => s.screen === screen && (round === null || s.round === round));
    },

    async goTo(target, { reason = 'next' } = {}) {
      const i = Math.max(0, Math.min(steps.length - 1, target));
      const my = ++token;
      const prev = steps[index];
      if (current) {
        logEvent('step.left', { screen: prev.screen, index, reason });
        try { await current.unmount(); } catch (e) { console.error(e); }
        current = null;
      }
      index = i;
      const step = steps[i];
      if (ctx.session.active) ctx.session.update({ flowIndex: i }, { immediate: true });
      onStepChange?.(step);
      listeners.forEach((fn) => fn(step));
      clear(container);

      try {
        const factory = await loadScreen(step.screen);
        if (my !== token) return; // another goTo started meanwhile
        current = factory();
        logEvent('step.entered', { screen: step.screen, index: i, reason });
        await current.mount(container, { ...ctx, step, flow });
      } catch (e) {
        // A screen that fails to load or mount shows a message instead of a blank page.
        console.error(e);
        logEvent('step.error', { screen: step.screen, index: i, message: String(e?.message ?? e) });
        if (my !== token) return;
        clear(container).append(h('div.fh-page.app-page', h('div.fh-page__content.app-center',
          messageStrip('error', t('app.screenError')),
          h('div.app-actions', h('button.fh-btn', { type: 'button', onclick: () => location.reload() }, t('app.reload'))))));
      }
      container.focus({ preventScroll: true });
    },

    next() {
      return flow.goTo(index + 1);
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return flow;
}
