# Table

The responsive table for lists of business objects: bold header row over a `sapList_HeaderBorderColor` line, rows at the row height (2.75rem cozy, 2rem compact), hover, selection and a navigation chevron.

**Markup:** `<div class="fh-table-wrap"><table class="fh-table">…`. Row classes: `is-interactive` (clickable, navigates), `is-selected`. Cells: `fh-sel` (selection checkbox), `fh-num` (right-aligned numbers with unit), `fh-nav` (`slim-arrow-right` chevron), `fh-cell-title` / `fh-cell-sub` for two-line identifier cells, `tr.fh-group` for group headers. Put an `fh-toolbar` with the title and count above the table inside the wrap.

**Use** the identifier first (bold), amounts right-aligned with currency, status as ObjectStatus. Desktop prototypes use compact density.
