// Dev panel. Served from /dev only when DEV_MODE=true; participants never receive this file.
// Researcher-facing, so its labels live here rather than in the participant strings file.
import { h, clear } from '/js/core/dom.js';
import { onLogEvent } from '/js/core/logEvent.js';

const STORE = 'hyux.dev';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(STORE)) ?? {}; } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* ignore */ } };

export function initDevPanel(ctx) {
  const { flow, session, api, config, t } = ctx;
  const prefs = { collapsed: false, timerSpeed: 1, ...loadPrefs() };
  ctx.dev.timerSpeed = prefs.timerSpeed;

  const stepLabel = (s) => `${s.index + 1}. ${t(`steps.${s.screen}`)}${s.round ? ` (round ${s.round})` : ''}`;

  // ----- session -----
  const sessionInfo = h('div.dev-panel__meta');
  const mockStt = h('input', { type: 'checkbox', role: 'switch' });
  const mockLlm = h('input', { type: 'checkbox', role: 'switch' });
  const sw = (input, label) => h('label.fh-switch', input, h('span.fh-switch__track'), label);

  async function ensureSession() {
    if (session.active) return;
    session.set(await api.dev.startSession());
  }

  async function setMock() {
    try {
      await ensureSession();
      const res = await api.dev.setMock({ stt: mockStt.checked, llm: mockLlm.checked });
      session.data.dev = { ...(session.data.dev ?? {}), mock: res.mock };
      render();
    } catch (e) { alert(`Could not set mock mode: ${e.code ?? e.message}`); }
  }
  mockStt.addEventListener('change', setMock);
  mockLlm.addEventListener('change', setMock);

  // ----- navigation -----
  const jumpSelect = h('select', { 'aria-label': 'Jump to step' }, flow.steps.map((s) => h('option', { value: String(s.index) }, stepLabel(s))));
  const jump = async (index) => { await ensureSession(); flow.goTo(index, { reason: 'dev' }); };
  const after = (screen) => {
    const i = flow.indexOf(screen);
    return i === -1 ? null : i + 1;
  };

  const btn = (label, onclick, extra = '') => h(`button.fh-btn${extra}`, { type: 'button', onclick }, label);

  async function skipId() {
    session.set(await api.dev.startSession());
    const i = after('welcome') ?? 1;
    flow.goTo(i, { reason: 'dev.skipId' });
  }
  const skipTo = (screen) => async () => {
    const i = after(screen);
    if (i === null) return alert(`${screen} is not part of the flow (disabled in config).`);
    await jump(Math.max(i, flow.index + (flow.step?.screen === screen ? 1 : 0)));
  };

  // ----- timer speed -----
  const speedSelect = h('select', { 'aria-label': 'Timer speed' },
    config.dev.timerSpeeds.map((s) => h('option', { value: String(s), selected: s === prefs.timerSpeed }, `${s}×`)));
  speedSelect.addEventListener('change', () => {
    prefs.timerSpeed = Number(speedSelect.value);
    ctx.dev.timerSpeed = prefs.timerSpeed;
    savePrefs(prefs);
    ctx.dev.onTimerSpeed?.(prefs.timerSpeed);
  });

  // ----- state + events -----
  const statePre = h('pre.dev-panel__pre');
  const events = h('ol.dev-panel__events');
  onLogEvent((e) => {
    const time = e.clientTs.slice(11, 19);
    const payload = Object.keys(e.payload ?? {}).length ? ` ${JSON.stringify(e.payload)}` : '';
    events.prepend(h('li', h('span.dev-panel__meta', `${time} `), h('span.dev-panel__event-type', e.type), payload));
    while (events.children.length > 60) events.lastChild.remove();
  });

  async function newSession() {
    if (!confirm('Start over? This forgets the current session in this browser.')) return;
    session.clear();
    location.reload();
  }

  // ----- layout -----
  const toggle = h('button.fh-btn.fh-btn--transparent.fh-btn--icon', { type: 'button', 'aria-label': 'Collapse dev panel' }, h('span.fh-icon', { 'data-icon': 'slim-arrow-down' }));
  const body = h('div.dev-panel__body',
    h('section.dev-panel__section', h('div.dev-panel__label', 'Session'), sessionInfo,
      h('div.dev-panel__row', btn('Skip ID', skipId), btn('Skip System Check', skipTo('systemCheck')), btn('Skip Tutorial', skipTo('tutorial'))),
      h('div.dev-panel__row', btn('New Session', newSession, '.fh-btn--transparent'))),
    h('section.dev-panel__section', h('div.dev-panel__label', 'Mock Mode'),
      h('div.dev-panel__row', sw(mockStt, 'Speech-to-text'), sw(mockLlm, 'LLM'))),
    h('section.dev-panel__section', h('div.dev-panel__label', 'Jump To Step'),
      h('div.dev-panel__row', h('span.fh-input.fh-input--select', jumpSelect), btn('Go', () => jump(Number(jumpSelect.value))))),
    h('section.dev-panel__section', h('div.dev-panel__label', 'Timer Speed'),
      h('div.dev-panel__row', h('span.fh-input.fh-input--select', speedSelect))),
    h('section.dev-panel__section', h('div.dev-panel__label', 'Session State'), statePre),
    h('section.dev-panel__section', h('div.dev-panel__label', 'Logged Events'), events),
  );
  const panel = h('aside.dev-panel', { 'aria-label': 'Dev panel' },
    h('div.dev-panel__head', h('span.dev-panel__title', 'Dev Mode'), toggle), body);

  function setCollapsed(c) {
    prefs.collapsed = c;
    savePrefs(prefs);
    panel.classList.toggle('is-collapsed', c);
    toggle.firstChild.dataset.icon = c ? 'slim-arrow-up' : 'slim-arrow-down';
    toggle.setAttribute('aria-label', c ? 'Expand dev panel' : 'Collapse dev panel');
  }
  toggle.addEventListener('click', () => setCollapsed(!prefs.collapsed));
  setCollapsed(prefs.collapsed);

  function render() {
    const d = session.data;
    clear(sessionInfo).append(d
      ? `${d.participantId}${d.isDev ? ' (dev)' : ''} · ${d.id.slice(0, 8)} · tasks: ${d.tasks.map((x) => x.id).join(', ')}`
      : 'No session yet');
    mockStt.checked = Boolean(d?.dev?.mock?.stt);
    mockLlm.checked = Boolean(d?.dev?.mock?.llm);
    if (flow.index >= 0) jumpSelect.value = String(flow.index);
    statePre.textContent = JSON.stringify({ step: flow.step && stepLabel(flow.step), state: d?.state ?? null, rounds: d?.rounds ?? null }, null, 2);
  }
  session.onChange(render);
  flow.onChange(render);
  render();

  document.body.append(panel);
}
