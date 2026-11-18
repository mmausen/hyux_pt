# AIPromptInput

Lets people write their own instruction to AI; the submit button stays disabled until there is valid input.

**Markup:** `<div class="fh-prompt"><div class="fh-prompt__box"><textarea placeholder="Ask or describe a task"></textarea><button class="fh-btn fh-btn--emphasized fh-btn--icon" aria-label="Submit" disabled><span class="fh-icon" data-icon="paper-plane"></span></button></div><div class="fh-prompt__meta">AI notice · character count</div></div>`. Add a Clear button (`decline` icon) once there is text. `fh-prompt--large` is the workspace version (bigger type, raised with `sapContent_Shadow1`). While an agent is working, the submit button turns into Stop (`stop` icon).

Put the generalized AI notice under the prompt. Use QuickPrompts instead when the task is predictable.
