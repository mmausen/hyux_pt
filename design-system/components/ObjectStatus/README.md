# ObjectStatus

Shows the semantic state of an object as colored bold text, optionally with an icon, or as an inverted pill.

**Markup:** `<span class="fh-status fh-status--success|error|warning|information">[icon] Text</span>`; add `fh-status--inverted` for the filled variant on indication colors. Pair the state with the matching icon (`message-success`, `message-error`, `message-warning`, `message-information`) so it never relies on color alone.

**Use** in table cells, card rows and the object page title row. Map: Approved/Paid → success, Overdue/Blocked → error, Pending/Due soon → warning, In transit/New → information, Draft → neutral (no modifier). The inverted warning pill uses indication color 3, which misses 4.5:1 in Morning Horizon: keep its text bold (it is) and short.
