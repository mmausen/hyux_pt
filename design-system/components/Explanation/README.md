# Explanation

A "Why?" popover that shows the reasoning and sources behind a recommendation or an agent's action.

**Markup:** a transparent button `<span data-icon="ai">Why?` opening `<div class="fh-popover">` with `fh-popover__header`, and `fh-popover__content` blocks (`fh-popover__label` "Reasoning", "Based On" with `fh-source` rows linking to documents and objects) and the generalized AI notice. One short paragraph of reasoning; every source is a link. Intentional addition.
