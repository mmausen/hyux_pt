# AgentCard

Shows one agent's goal, state, progress and what it needs from you, for agent overviews and the workspace side panel.

**Markup:** `<div class="fh-agent-card">` with `fh-agent-card__head` (`fh-agent-avatar`, `fh-agent-card__name`, `fh-agent-card__goal`), an ObjectStatus for the state, an `fh-progress` bar or `fh-agent-card__metrics`, and `fh-agent-card__foot` (last action, Pause, links).

**States:** Running → information with `fh-busy`; Waiting for You → warning with an emphasized action ("Review 1 Proposal"); Completed → success; Failed → error with "View Details"; Paused → neutral. Name agents by the job they do ("Invoice Matching Agent"), not by a persona.

Intentional addition.
