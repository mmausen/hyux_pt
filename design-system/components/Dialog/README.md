# Dialog

A modal that asks for confirmation or a small amount of input, on `sapBaseColor` with `sapContent_Shadow3` over a 20% `sapBlockLayer_Background` layer.

**Markup:** `<div class="fh-blocklayer"></div><div class="fh-dialog" role="dialog" aria-labelledby="…">` with `fh-dialog__header` (`fh-dialog__title`), `fh-dialog__content` and `fh-dialog__footer` (emphasized action first, then Cancel as transparent). Message dialogs add `fh-dialog--error` or `fh-dialog--warning`. Titles are questions or the action ("Delete Purchase Order?"); the button repeats the verb ("Delete"), never "OK".
