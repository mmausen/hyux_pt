# Button

Triggers an action; the Horizon button is 2.25rem high (cozy) or 1.625rem (compact) with a .5rem radius and 72 Semibold Duplex text.

**Markup:** `<button class="fh-btn [modifier]">[icon] Label</button>`. Modifiers: `fh-btn--emphasized`, `fh-btn--transparent`, `fh-btn--positive`, `fh-btn--negative`, `fh-btn--attention`, `fh-btn--icon` (square, icon only; give it `aria-label`). Toggle buttons set `aria-pressed="true"`. Disabled: the `disabled` attribute (renders at `sapContent_DisabledOpacity`).

**Use**
- One `fh-btn--emphasized` per area for the primary action (Save, Create, Go). In footers it comes first, at the right edge group.
- Toolbars, the ShellBar and table headers use `fh-btn--transparent`.
- `positive` / `negative` only for Approve / Reject style decisions, not for Save or Delete. Delete is a default button, confirmed in a Dialog.
- Labels are verbs in title case, one or two words: "Create", "Adapt Filters".

**Don't** put two emphasized buttons side by side, or color a button only to decorate.
