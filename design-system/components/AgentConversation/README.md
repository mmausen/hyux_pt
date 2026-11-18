# AgentConversation

The assistant side panel for an agent-first workspace: a conversation with the agent, rich responses with embedded business objects, follow-up suggestions and a visible working state.

**Markup:** `<section class="fh-convo">` with `fh-convo__header` (agent avatar, title, history, overflow, close), `fh-convo__body` (`fh-msg-user` bubbles right; `fh-msg-agent` responses left with an `fh-agent-avatar--xs`) and `fh-convo__footer` holding an AIPromptInput. Inside a response: plain sentences, an `fh-embed` list of objects with ObjectStatus, `fh-response-actions`, and `fh-chips` with follow-ups. Working state: `fh-msg-agent__thinking` with `fh-busy` and a sentence saying what the agent is doing right now.

**Use**
- Lead with the answer in one or two sentences, then the objects. Every object in a response links to its object page.
- Say what the agent is doing in plain words ("Checking 14 qualified suppliers for steel coils"), never "Thinking…".
- Width 22–26rem, docked right; it keeps the page visible behind it.

Intentional addition, modeled on SAP's Joule panel (header, conversation area, fixed input) for the web. In SAP products this panel is Joule; outside SAP, name it after your own assistant.
