# ApprovalRequest

The human-in-the-loop moment: an agent proposes an action with its impact, reasons and sources, and a person approves, rejects, edits or asks.

**Markup:** `<article class="fh-approval">` with `fh-approval__head` (agent avatar, `fh-approval__eyebrow` "<Agent> proposes · time", `fh-approval__title` the action as a sentence, ObjectStatus "Approval Needed"), `fh-approval__attrs` (amount, date, impact), `fh-approval__why` (2–4 reasons and `fh-approval__sources` links), and `fh-approval__actions` (a local AI notice, Approve `fh-btn--positive`, Reject `fh-btn--negative`, Edit, Ask Agent).

**Rules**
- Agents never execute money, people, legal or irreversible actions without this step.
- The title states exactly what will happen, with numbers. Reasons are facts with sources, not adjectives.
- Always offer Edit: a person can change the proposal before approving it.

Intentional addition, applying SAP's AI notice rule for high-impact results (local notice, mandatory).
