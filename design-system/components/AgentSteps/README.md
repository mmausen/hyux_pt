# AgentSteps

A vertical trace of what an agent did, is doing and will do, so people can follow and trust its work.

**Markup:** `<ol class="fh-steps">` of `<li class="fh-step fh-step--done|running|waiting|failed|pending">` each with `fh-step__mark` (icon `accept` for done, `fh-busy` for running, `employee` for waiting on a person), `fh-step__body` (`fh-step__title`, `fh-step__detail`) and an optional `fh-step__time`.

Write steps as short past-tense facts for done steps and present-tense for the running one. A step that needs a person always says so ("Your approval: place bridging order") and links to the ApprovalRequest. Intentional addition.
