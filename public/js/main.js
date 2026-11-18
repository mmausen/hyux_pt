// App bootstrap: load config and strings, restore the session, start the flow, attach the dev panel in dev mode.
import { api } from './core/api.js';
import { loadStrings, t } from './core/strings.js';
import { createSession } from './core/session.js';
import { buildSteps, createFlow } from './core/flow.js';
import { logEvent, setLogContext, flushLog } from './core/logEvent.js';
import { watchIcons } from './core/icons.js';
import { h, clear, messageStrip } from './core/dom.js';
import { isScreenTooSmall } from './core/browserSupport.js';

const $ = (id) => document.getElementById(id);
const screenEl = $('screen');

function showFatal(text) {
  clear(screenEl).append(h('div.fh-page.app-page', h('div.fh-page__content.app-center', messageStrip('error', text))));
}

function setupSmallScreenNotice() {
  const el = $('small-screen');
  el.append(h('div.fh-card.app-card', h('div.fh-card__header', h('div.fh-card__heading', h('h1.fh-card__title.app-title', t('app.smallScreenTitle')))),
    h('div.fh-card__content', h('p.app-text', t('app.smallScreenText')))));
  let logged = false;
  const update = () => {
    const small = isScreenTooSmall();
    el.hidden = !small;
    $('app').inert = small;
    if (small && !logged) { logged = true; logEvent('client.smallScreen', { width: innerWidth, height: innerHeight }); }
    if (!small) logged = false;
  };
  addEventListener('resize', update);
  update();
}

// Status strip under the shell bar: saving problems and a lost session. Shown on every screen.
function setupStatus(session) {
  const el = $('app-status');
  session.onSaveStatus = (ok, err) => {
    logEvent(ok ? 'client.saveRecovered' : 'client.error', ok ? {} : { where: 'saveState', error: err?.code ?? err?.name });
    clear(el);
    if (!ok) el.append(messageStrip('warning', t('app.saveFailed')));
  };
  // A new session (ID entered again) clears a "session lost" notice.
  let lostId; // undefined: nothing shown
  session.onChange((data) => { if (lostId !== undefined && data && data.id !== lostId) { lostId = undefined; clear(el); } });
  session.onSessionLost = (err, { onRestore = false } = {}) => {
    lostId = session.data?.id ?? null;
    // On reload the study already starts at the ID entry, so the message is enough.
    if (onRestore) return clear(el).append(messageStrip('warning', t('app.sessionLost')));
    clear(el).append(h('div.app-status__row',
      messageStrip('error', t('app.sessionLost')),
      h('button.fh-btn', { type: 'button', onclick: () => { session.clear(); location.reload(); } }, t('app.enterIdAgain'))));
  };
}

// Uncaught errors end up in the log, so problems in a session can be traced afterwards.
function setupErrorLogging() {
  let count = 0;
  const report = (payload) => { if (++count <= 20) logEvent('client.error', payload); };
  addEventListener('error', (e) => report({ where: 'window', message: String(e.message ?? '').slice(0, 300), source: e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : null }));
  addEventListener('unhandledrejection', (e) => report({ where: 'promise', message: String(e.reason?.message ?? e.reason ?? '').slice(0, 300) }));
}

async function main() {
  watchIcons(document.body);
  setupErrorLogging();

  let config;
  try {
    config = await api.getConfig();
    await loadStrings(config.study.locale);
  } catch (e) {
    console.error(e);
    return showFatal('The study could not be loaded. Check your internet connection and reload the page.');
  }

  document.title = config.study.productName;
  document.documentElement.lang = config.study.locale;
  $('shell-title').textContent = config.study.productName;
  setupSmallScreenNotice();

  const session = createSession();
  setupStatus(session);
  const steps = buildSteps(config);

  // The interaction mode (public/js/modes/<name>/) provides the canvas and the tutorial steps.
  let mode;
  try {
    mode = await import(`/js/modes/${config.interaction.mode}/index.js`);
  } catch (e) {
    console.error(e);
    return showFatal(t('app.loadFailed'));
  }

  const ctx = {
    config,
    mode,
    t,
    api,
    session,
    logEvent,
    dev: { timerSpeed: 1 }, // set by the dev panel; the timer reads it
  };

  const flow = createFlow({
    container: screenEl,
    steps,
    ctx,
    onStepChange(step) {
      $('shell-step').textContent = t(`steps.${step.screen}`);
      $('shell-round').textContent = step.round ? t('app.roundIndicator', { round: step.round, rounds: config.flow.rounds }) : '';
    },
  });
  ctx.flow = flow;

  setLogContext(() => {
    const step = flow.step;
    // The tutorial's practice turn is round 0 (as on the server), with its own start time.
    if (step?.screen === 'tutorial' && session.state.tutorial?.practice) {
      return { round: 0, taskId: 'practice', taskStartedAt: session.progress(0).taskStartedAt ?? null };
    }
    if (!step?.round) return { round: null, taskId: null, taskStartedAt: null };
    return {
      round: step.round,
      taskId: session.task(step.round)?.id ?? null,
      taskStartedAt: session.progress(step.round).taskStartedAt ?? null,
    };
  });

  // Resume: a stored session continues at its saved step; otherwise start at the first step.
  let startAt = 0;
  try {
    if (await session.restore()) {
      const saved = session.state.flowIndex;
      startAt = session.data.completed ? steps.length - 1 : (Number.isInteger(saved) ? saved : 1);
      logEvent('session.resumed', { via: 'reload', flowIndex: startAt });
    }
  } catch (e) {
    console.error(e);
    return showFatal(t('app.loadFailed'));
  }

  if (config.devMode) {
    try {
      const { initDevPanel } = await import('/dev/devPanel.js');
      initDevPanel(ctx);
    } catch (e) {
      console.warn('Dev panel failed to load', e);
    }
  }

  await flow.goTo(startAt, { reason: startAt ? 'resume' : 'start' });

  addEventListener('pagehide', () => { session.flush(); flushLog({ keepalive: true }); });
}

main();
