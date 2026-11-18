# AINotice

Tells people that AI contributed to what they see; mandatory wherever AI generated, changed, recommended or predicted information.

**Markup:** generalized `<span class="fh-ai-notice"><span class="fh-icon" data-icon="ai"></span>AI can make mistakes. Check for accuracy.</span>`; local (high impact) adds `fh-ai-notice--local` and sits in or beside the section title (`fh-section-title`). Interactive variants put a link or button inside ("Show details").

**Texts (SAP standard):** "AI can make mistakes. Check for accuracy." (generalized) · "Recommended with AI. Verify before use." · "Generated with AI. Verify before use." · "Predicted with AI. Verify before use." · "Created with AI. Verify before use." (copied output).

**Scale with risk:** low and medium impact: one global notice and toggleable highlights. High impact (money, people, compliance, anything an agent will execute): a local notice next to the result, highlights on.
