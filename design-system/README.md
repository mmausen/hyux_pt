Fiori Horizon styles prototypes so they read as SAP Fiori apps in the Horizon theme: Morning Horizon (light) and Evening Horizon (dark), cozy and compact density. Every token keeps SAP's own theming parameter name (`sapBrandColor`, `sapButton_Background`, `sapList_HeaderBorderColor` …), so `var(--sapX)` in a prototype means exactly what it means in SAPUI5 and UI5 Web Components.

## Setting up a prototype

- Load `tokens.css`, then `components/bundle.css`. Put `data-theme="light"` (or `"dark"`) on `<html>` and `class="fh-app"` on `<body>`.
- Desktop prototypes set `data-density="compact"` on `<body>` (SAP's default for mouse and keyboard). Touch prototypes leave it off (cozy).
- Build with the `fh-` classes documented per component; never hard-code a color, size or shadow: use the `--sap…` variables.
- Include the icon loader (Iconography, below) once at the end of `<body>`.
- Need real, behaving controls instead of styled HTML? Use UI5 Web Components (`@ui5/webcomponents`); their default theme is `sap_horizon` and they read the same variables.

## Content fundamentals

SAP UI text is plain, neutral and task-focused. Write for a professional who wants to finish a task.

- **Title case** for page and card titles, buttons, field labels, column headers, tabs and status values: "Create Purchase Order", "Net Amount", "Pending Approval".
- **Sentence case** for messages, descriptions, placeholders and tooltips: "Purchase order 4500017823 was created."
- Buttons are verbs: "Create", "Save", "Delete", "Adapt Filters". Never "OK" when a verb fits; "Cancel" closes without saving.
- Messages say what happened and what to do: "Enter a quantity greater than 0." No exclamation marks, no blame, no jokes, no emoji.
- Address the user as "you" only when needed; prefer the object ("The supplier is blocked for posting.").
- Show counts in titles: "Purchase Orders (24)". Show amounts with the currency code after the number, right-aligned: "12,480.00 EUR". Dates in medium format: "Oct 14, 2026".
- Identifiers (order numbers, IDs) come first in a row and in a title: "Purchase Order 4500017823".

## Visual foundations

**Color.** Neutral surfaces carry almost everything; color is reserved for actions, selection and meaning.
- Page: `sapBackgroundColor`. Containers (cards, tables, headers, bars, dialogs): `sapBaseColor` or the matching component token (`sapTile_Background`, `sapList_Background`, `sapObjectHeader_Background`).
- Text: `sapTextColor` / `sapTitleColor`; secondary text and labels `sapContent_LabelColor`; links `sapLinkColor`.
- Actions: `sapButton_TextColor` on default buttons; one emphasized button in `sapButton_Emphasized_Background` per area. `sapBrandColor` is a fill, not a text color.
- Selection and current item: `sapHighlightColor` (tab underline, CheckBox tick), `sapList_SelectionBackgroundColor` for selected rows.
- Semantics: success, error, warning and information each come as a text color (`sapPositiveTextColor` …), an element color for icons (`sapPositiveElementColor` …), a background (`sapSuccessBackground` …) and a border (`sapSuccessBorderColor` …). Always pair a semantic color with a word and the matching `message-*` icon.
- Categorical marks (legends, card icons): `sapAccentColor1`–`10`, never semantic.
- Evening Horizon swaps every value; never write a light-only color. The inverted warning status on `sapIndicationColor_3_Background` is 3.4:1 in Morning Horizon (SAP's own pair): keep it bold and short.

**Type.** SAP's 72 typeface (`font-sans`), falling back to Arial.
- All control and body text: `sapFont` (0.875rem, 400). Secondary info: `sapFontSmall` (0.75rem). Multi-line text: `sapFontText` (line height 1.5).
- Titles are 72 Bold (`font-bold`): card and table titles `sapFontHeader5` (1rem), page titles `sapFontHeader4` (1.25rem), section titles `sapFontHeader3` (1.5rem). The object page title is the key title: `objectTitle`, 72 Black (`font-black`) 1.5rem.
- Buttons use 72 Semibold Duplex (`font-semibold`); emphasized buttons 72 Bold.
- Light weight only for large numbers (KPIs in cards), never for small text or labels.

**Spacing and layout.**
- Page content padding is responsive: `sapContent_Space_Small` (1rem) below 600px, `sapContent_Space_Medium` (2rem) up to 1439px, `sapContent_Space_Large` (3rem) from 1440px. `.fh-page__content` does this.
- Card padding and gaps between cards: `sapContent_Space_Small`. Gaps between controls in a row: `sapContent_Space_Tiny`.
- Control height: `sapElement_Height` (cozy) or `sapElement_Compact_Height`; rows: `sapElement_LineHeight` or `sapElement_Compact_LineHeight`.
- Pages follow a floorplan (List Report, Object Page, Overview Page, Agent Workspace; see Floorplans). Content is left-aligned; actions sit top-right in headers and toolbars and bottom-right in the footer.

**Shape.** Fields and tags `sapField_BorderCornerRadius` (.25rem); buttons, message strips, popovers and dialogs `sapButton_BorderCornerRadius` / `sapPopover_BorderCornerRadius` (.5rem); object images and groups `sapElement_BorderCornerRadius` (.75rem); cards and tiles `sapTile_BorderCornerRadius` (1rem).

**Borders and depth.** Fields have no full border: the inset `sapField_Shadow` outline plus a bottom border in `sapField_BorderColor`. Cards and tables float on `sapContent_Shadow0`; dropdowns and the footer on `sapContent_Shadow1`; popovers and hovered cards on `sapContent_Shadow2`; dialogs on `sapContent_Shadow3` over `sapBlockLayer_Background` at 20%. Rows separate with `sapList_BorderColor` hairlines; no zebra stripes in responsive tables.

**States.** Hover darkens to the `…_Hover_Background` token; pressed uses `sapButton_Active_*` (emphasized buttons invert to an outline); disabled controls render at `sapContent_DisabledOpacity`. Keyboard focus is always visible: a `sapContent_FocusWidth` solid `sapContent_FocusColor` outline (10.5:1 on white, 9.9:1 on Evening Horizon base).

**Imagery and motion.** Business data first: no decorative photography, gradients or illustrations in work screens. Product and person images appear only inside Avatars. Motion is short and functional (switch handle, hover); no entrance animations.

## Iconography

SAP's icon font in the Horizon style (collection "SAP-icons-v5"), rendered as inline SVG from the path data in `@ui5/webcomponents-icons`, pinned to 2.9.0. Icons are monochrome, outline style, sized 1rem in controls, and inherit `color`. Browse names in the UI5 Icon Explorer.

Markup: `<span class="fh-icon" data-icon="search"></span>` (`fh-icon--l` 1.5rem, `fh-icon--xl` 2rem). Add this once at the end of `<body>`:

```html
<script type="module">
const V = "2.9.0";
await Promise.all([...document.querySelectorAll("[data-icon]")].map(async (el) => {
  const m = await import(`https://cdn.jsdelivr.net/npm/@ui5/webcomponents-icons@${V}/dist/v5/${el.dataset.icon}.js/+esm`);
  const d = Array.isArray(m.pathData) ? m.pathData : [m.pathData];
  el.innerHTML = `<svg viewBox="0 0 512 512" aria-hidden="true">${d.map((p) => `<path d="${p}"/>`).join("")}</svg>`;
}));
</script>
```

Common names: `ai` (sparkles: AI only), `paper-plane` (submit prompt), `stop`, `thumb-up`, `thumb-down`, `copy`, `refresh`, `search`, `add`, `edit`, `delete`, `decline` (close), `accept`, `filter`, `sort`, `overflow`, `action-settings`, `bell`, `sys-help`, `grid` (app switcher), `menu2`, `slim-arrow-right` (row navigation), `slim-arrow-down` (dropdown), `calendar`, `employee`, `product`, `excel-attachment`, `message-success`, `message-error`, `message-warning`, `message-information`. Colors: interactive icons `sapContent_IconColor`, decorative `sapContent_NonInteractiveIconColor`, state icons the semantic element colors. No emoji, no other icon sets.

## AI and agents

Two layers. **SAP's AI elements** (AIButton, AIPromptInput, QuickPrompts, AINotice, AIHighlight, ResponseFeedback) follow the Fiori "AI and Joule Design" guidelines. **Agent patterns** (AgentConversation, AgentCard, AgentSteps, ApprovalRequest, Explanation, IntentPrompt, AgentWorkspace) are intentional additions for agent-first, Joule Work-style prototypes, built only from Horizon tokens; SAP has not published specs for them.

**Marking AI**
- The sparkles icon `ai` is the only AI symbol. It leads every AI button and every AI notice. No robots, brains, magic wands or gradients.
- AI-created or AI-changed values use the information state: `sapInformationBackground` with a `sapInformationBorderColor` underline (`fh-ai-mark`, `fh-input--ai`). Remove the highlight once a person confirms or edits the value.
- Every screen with AI output carries an AI notice (AINotice). High-impact results get a local notice beside them.

**Agents**
- An agent is shown as a square `fh-agent-avatar` in the `sapAvatar_5` scheme with the `ai` icon; people stay round with initials. Never give an agent a human face or name.
- Name agents by their job: "Invoice Matching Agent", "Supplier Risk Agent".
- Agent states map to semantics: Running = information (with `fh-busy`), Waiting for You = warning, Completed = success, Failed = error, Paused = neutral.

**Human in the loop**
- Agents propose; people decide. Anything that moves money, changes master data, affects people, or can't be undone goes through an ApprovalRequest with impact, reasons and sources.
- Show the work: AgentSteps for what happened, Explanation ("Why?") for any recommendation. Every claim links to its source object.
- People can always stop (Stop Generating, `stop` in the prompt, Pause on an agent) and always edit a proposal before approving it.
- While AI is generating, disable the area's primary actions.

**Writing for AI**
- AI button labels are verbs about the result, without "AI": "Generate", "Summarize", "Draft Reply". Use SAP's standard quick-prompt labels: Generate, Regenerate, Revise, Simplify, Expand, Shorten, Change Tone, Translate.
- Use SAP's notice texts exactly: "AI can make mistakes. Check for accuracy." · "Generated with AI. Verify before use." · "Recommended with AI. Verify before use." · "Predicted with AI. Verify before use."
- Agents answer first, then show objects. Working states say what is happening ("Checking 14 qualified suppliers"), never "Thinking…". No first-person chit-chat, no apologies, no emoji.
- Approval titles state the exact action with numbers: "Order 400 steel coils from Nordstahl AG as a bridging delivery".

**Joule**
- Joule is SAP's assistant and a trademark. In prototypes for SAP products, the AgentConversation panel is Joule. Outside SAP, call it by your own assistant's name and do not use the Joule logo.

## Logos

This system ships no logo. Set the product name in plain type in the ShellBar (`fh-shellbar__title`). In your own prototypes, place your company's logo before the title; do not use SAP's logo unless you are building for SAP products.
