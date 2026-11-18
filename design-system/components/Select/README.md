# Select

Picks one value from a short fixed list; looks like an Input with a `slim-arrow-down` icon at the end.

**Markup:** `<span class="fh-input fh-input--select" role="combobox" tabindex="0"><span style="flex:1">Value</span><span class="fh-icon" data-icon="slim-arrow-down"></span></span>`. For a prototype that needs to work, a native `<select>` inside `.fh-input` also takes the styling. The open list is a popover: `sapBaseColor`, `sapContent_Shadow1`, `sapPopover_BorderCornerRadius`, rows at the row height.
