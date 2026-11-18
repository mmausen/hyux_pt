# Card

A container on `sapTile_Background` with a 1rem radius and `sapContent_Shadow0`, for overview pages and dashboards.

**Markup:** `<div class="fh-card [fh-card--interactive]">` with `fh-card__header` (optional avatar, `fh-card__heading` → `fh-card__title` and `fh-card__subtitle`, optional `fh-card__status` like "3 of 12"), optional `fh-card__divider`, and `fh-card__content`. A KPI number uses `fh-card__kpi`. Interactive cards lift to `sapContent_Shadow2` on hover and must be focusable.

Titles in title case, subtitles say the scope ("Q4 2026, all company codes").
