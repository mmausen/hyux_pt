# AIButton

Triggers an AI action, following SAP's AI Button guideline: the sparkles icon `ai` leads, and the button moves through Generate, Stop Generating and Revise.

**Markup:** `<button class="fh-btn fh-ai-btn"><span class="fh-icon" data-icon="ai"></span>Generate</button>`. While generating: add `is-generating`, replace the icon with `<span class="fh-busy"><i></i><i></i><i></i></span>` and the label with "Stop Generating". When done or stopped it becomes a menu button: label "Revise" plus `<span class="fh-icon fh-btn__arrow" data-icon="slim-arrow-down">`, opening QuickPrompts. Split button: wrap two buttons in `fh-splitbtn`. Types: secondary (default `fh-btn`), `fh-btn--emphasized` only for the main action of the page or panel, `fh-btn--transparent` as tertiary.

**Use**
- Labels are short verbs about the result, without the word "AI": "Generate", "Summarize", "Draft Reply". The sparkles icon tells people AI is involved.
- While generating, disable the area's primary actions (Save, Submit) so nobody acts on partial content.
- On error, show "An error occurred during generation. Try again." in a MessageStrip.
