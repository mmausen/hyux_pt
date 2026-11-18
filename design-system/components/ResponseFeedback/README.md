# ResponseFeedback

The action bar under every AI response: helpful, not helpful, copy, regenerate, and the AI notice; not helpful opens a short category form.

**Markup:** `<div class="fh-response-actions">` with transparent icon buttons (`thumb-up`, `thumb-down`, `copy`, `refresh`) and an `fh-ai-notice` pushed right. Selected thumb: `aria-pressed="true"`. The negative-feedback form is `fh-feedback` with single-select `fh-chip`s (Incorrect, Incomplete, Not relevant, "Not specified" always last), an optional text Input, and Submit / Cancel.

Thumbs up submits at once and confirms with a short toast. Show the bar on every response, in the same place. Pattern adapted from SAP's Joule feedback guideline (mobile) to the web.
