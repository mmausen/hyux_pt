# Floorplans

Fiori apps are built from a few page types. Pick the floorplan first, then fill it with components.

## List Report

For finding, filtering and acting on many objects of one type ("Manage Purchase Orders").

1. ShellBar with the app title.
2. Page title: the variant name in `sapFontHeader4` with the count after it in `sapContent_LabelColor` ("Standard (24)").
3. Filter bar on `sapObjectHeader_Background`: 3–6 filter fields with title-case labels, then **Go** (emphasized) and **Adapt Filters** (transparent).
4. Table in an `fh-table-wrap` with a toolbar: title with count, then transparent actions (Create, Delete), a separator, and icon buttons (sort, export, settings).
5. Rows navigate to the object page (`is-interactive`, `slim-arrow-right`). Multi-select checkboxes only when there are mass actions.

The `ListReport` component is this layout, ready to copy.

## Object Page

For displaying and editing one object.

1. ShellBar.
2. `ObjectPageHeader`: breadcrumb back to the list, title "<Type> <ID>" in 72 Black, the main status, header actions (Edit emphasized, Delete, overflow), subtitle, and up to five key attributes.
3. Anchor bar (`Tabs`) naming the sections: General Information, Items, …
4. Sections on `sapBackgroundColor`, each a `sapGroup_ContentBackground` container (`sapGroup_BorderCornerRadius`) with a `sapFontHeader5` title. Forms show label above value; tables follow the Table rules.
5. Edit mode: fields become Inputs and the floating footer appears (`fh-footer`: Save emphasized, Cancel transparent). The header's Edit button disappears.

## Overview Page

For a role-based entry point with KPIs and to-dos.

1. ShellBar.
2. A responsive grid of `Card`s (`minmax(17rem, 1fr)`, gap `sapContent_Space_Small`) on `sapBackgroundColor`.
3. Each card: title, scope subtitle, optional count ("3 of 12") top-right; content is one KPI (`fh-card__kpi` with an ObjectStatus trend), a short list (3–5 rows), or a small chart in `sapAccentColor` hues.
4. Cards navigate to the matching list report or object page.

## Agent Workspace

For agent-first prototypes in the spirit of SAP Joule Work: people state intents, agents do the work, and the workspace shows results and decisions instead of apps.

1. ShellBar: product title, context ("Procurement · Company Code 1010"), search across apps, objects and agents, notifications, user.
2. Navigation rail (`fh-rail`, 4.5rem): Home, Spaces, Agents, Approvals (with count), Activity.
3. Main area (`fh-workspace__main`, padding `sapContent_Space_Medium`):
   - IntentPrompt: greeting with one sentence on what needs attention, the large prompt, 3–5 intent chips.
   - The generated space for the current intent: a `fh-section-title` with a local or generalized AI notice, then a grid of Cards (KPIs, short lists) and text cards with an AI Revise menu. Highlight AI-derived values with `fh-ai-mark`.
4. Attention panel (`fh-workspace__side`, 22rem, on `sapShell_Background`): "Needs Your Attention" with compact ApprovalRequests first, then "Running Agents" as compact AgentCards.
5. The AgentConversation panel opens docked right, over the attention panel, when the person asks a follow-up or opens an agent.
6. Below 1024px the attention panel moves under the main area.

The `AgentWorkspace` component is this layout, ready to copy.

## Dialogs and messages

- Confirm destructive actions in a `Dialog` whose button repeats the verb.
- Report results of an action with a `MessageStrip` at the top of the page or section, or inline value states on fields.
- Never stack more than one MessageStrip of the same type; merge them.
