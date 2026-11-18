# CheckBox

Turns an option on or off in forms and selects rows in tables; the box is outlined in `sapField_BorderColor` and the tick is `sapHighlightColor`.

**Markup:** `<label class="fh-checkbox"><input type="checkbox"><span class="fh-checkbox__box"></span>Label</label>`. States: `fh-checkbox--error`, `fh-checkbox--disabled`. In tables, use the box without a visible label and give the input an `aria-label`.

Box geometry is modeled on UI5 Web Components (Horizon); colors are exact theme parameters.
