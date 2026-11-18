// End: marks the session complete on the server, then thanks the participant and shows the
// completion code if study.completionCode is set (the code only reaches the browser here).
import { h } from '../core/dom.js';
import { t } from '../core/strings.js';
import { api } from '../core/api.js';
import { logEvent, flushLog } from '../core/logEvent.js';
import { releaseMic } from '../core/recorder/index.js';

export default function create() {
  return {
    async mount(container, ctx) {
      releaseMic();
      let code = null;
      try {
        code = (await api.complete()).completionCode;
      } catch { /* the thank-you text still shows; completion is retried on reload */ }
      logEvent('study.completed', {});
      flushLog();

      container.append(h('div.fh-page.app-page', h('div.fh-page__content.app-center',
        h('section.fh-card.app-card',
          h('div.fh-card__header', h('div.fh-card__heading', h('h1.fh-card__title.app-title', t('end.title')))),
          h('div.fh-card__content.app-form',
            h('p.app-text', t('end.text')),
            code ? h('div.app-sentence',
              h('div.app-sentence__label', t('end.codeLabel')),
              h('p.app-sentence__text.app-code', code),
              h('p.app-hint', t('end.codeHint'))) : null,
            h('p.app-hint', t('end.close')))))));
    },
    unmount() {},
  };
}
