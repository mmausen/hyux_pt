# Input

Single-line text entry; a Horizon field has no full border, only the inset `sapField_Shadow` outline, a bottom border in `sapField_BorderColor` and a .25rem radius.

**Markup:** `<label class="fh-field"><span class="fh-label [fh-label--required]">Label</span><span class="fh-input [state]"><input …></span></label>`. Put a trailing icon (search, calendar, value help) as an `fh-icon` after the `<input>`. Value states: `fh-input--error`, `--warning`, `--success`, `--information`; add the message below as `<div class="fh-valuestate fh-valuestate--error">`. Read-only: `fh-input--readonly` plus `readonly`; disabled: `fh-input--disabled` plus `disabled`.

**Use**
- Labels sit above the field in forms and filter bars, in title case, no colon ("Company Code").
- Placeholders show the expected format ("MMM d, y"), never the label.
- Error text says what to do: "Enter a quantity greater than 0."
- In display mode of an object page, show plain text (`fh-attr`) instead of read-only fields.

The required asterisk is drawn in `sapNegativeTextColor`; SAP uses its own required-color parameter, which this system does not carry.
