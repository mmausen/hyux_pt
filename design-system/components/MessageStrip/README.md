# MessageStrip

Shows a page- or section-level message inline, tinted by type, with the type icon in its element color.

**Markup:** `<div class="fh-msg fh-msg--information|success|warning|error" role="status"><span class="fh-icon" data-icon="message-information"></span><span class="fh-msg__text">…</span><button class="fh-msg__close" aria-label="Close">…</button></div>`. Use `role="alert"` for errors. Place it at the top of the content it is about. One sentence, ending with a period.
