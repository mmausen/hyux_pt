// The assistant's latest response, as every mode shows it: only the newest version (earlier ones are
// stored and logged but not shown), "Version n", and how long ago it was last updated.
//
//   const view = createLatestResponse({ assistant, scroller, latest, label });
//   label(turn) → the text next to the assistant's name (default: Version n)
//   view.render({ inflight, latest, error }) → element for the response column
//   view.delta(text)   streaming text so far (cheap partial update)
//   view.markUpdated() a response just finished
//   view.destroy()
import { h, icon, clear, messageStrip } from '../dom.js';
import { t } from '../strings.js';

const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const agentAvatar = () => h('span.fh-agent-avatar.fh-agent-avatar--xs', { 'aria-hidden': 'true' }, icon('ai'));
export const busy = (text) => h('div.fh-msg-agent__thinking', h('span.fh-busy', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), text);

export function createLatestResponse({ assistant, scroller, latest = null, label = (turn) => (turn.n ? t('canvas.versionLabel', { n: turn.n }) : null) }) {
  // When the shown response was last updated, in browser time (a finished turn's respondedAt is server
  // time, so it is only used for a response that was already there when the page loaded).
  let updatedAt = (() => {
    const at = Date.parse(latest?.respondedAt ?? '');
    return Number.isFinite(at) ? Math.min(at, Date.now()) : Date.now();
  })();
  const updatedText = h('span');
  const updatedLabel = h('span.vc-updated', icon('history'), updatedText);
  function renderUpdated() {
    const s = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
    const text = s < 5 ? t('canvas.updatedNow')
      : s < 60 ? t('canvas.updatedSeconds', { n: s })
      : s < 3600 ? t('canvas.updatedMinutes', { n: Math.floor(s / 60) })
      : t('canvas.updatedHours', { n: Math.floor(s / 3600) });
    if (updatedText.textContent !== text) updatedText.textContent = text;
    updatedLabel.title = t('canvas.updatedAt', { time: timeOf(updatedAt) });
  }
  const ticker = setInterval(renderUpdated, 1000);

  let root = null;
  let shownKey = null;

  function block(turn, { streaming = false } = {}) {
    const body = h('div.fh-msg-agent__body');
    if (streaming && !turn.response) body.append(busy(t('canvas.working')));
    else body.append(h('p.vc-response', turn.response));
    if (!streaming) renderUpdated();
    return h('div.fh-msg-agent.vc-turn__response', agentAvatar(), h('div.vc-turn__agent',
      h('div.vc-turn__meta', h('span.vc-turn__name', assistant), (() => { const l = label(turn); return l ? h('span', l) : null; })(),
        streaming ? null : updatedLabel),
      body));
  }

  return {
    render({ inflight, latest: done, error = null, placeholderKey = 'canvas.responsePlaceholder' }) {
      let main;
      if (inflight) main = block(inflight, { streaming: true });
      else if (done) main = block(done);
      else main = h('div.vc-turn__response.vc-placeholder', agentAvatar(), h('p', t(placeholderKey)));
      const errorBox = error && !inflight ? h('div.vc-chat-error', messageStrip('error', t(`canvas.errors.${error}`))) : null;
      root = h('div.vc-turn__left', main, errorBox);
      // A new response starts at the top; a re-render of the same one keeps the reading position.
      const key = inflight ? `w${inflight.n}` : done ? `d${done.n}` : 'none';
      if (scroller && key !== shownKey && !(key === `d${done?.n}` && shownKey === `w${done?.n}`)) scroller.scrollTop = 0;
      shownKey = key;
      return root;
    },
    delta(text) {
      const body = root?.querySelector('.fh-msg-agent__body');
      if (!body) return false;
      const p = body.querySelector('.vc-response');
      if (p) p.textContent = text;
      else clear(body).append(h('p.vc-response', text));
      if (scroller) {
        const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
        if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
      }
      return true;
    },
    markUpdated() { updatedAt = Date.now(); },
    destroy() { clearInterval(ticker); },
  };
}
