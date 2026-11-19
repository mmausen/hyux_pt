# Sales Workbench study prototype

This is a research prototype for a voice-driven AI task study. Participants are sales professionals. They give spoken instructions to an AI assistant and use it to complete realistic sales writing tasks. The assistant replies in text. The study then guides them through a questionnaire after each task.

- The stack is Node and Express with vanilla ES modules in the browser. There is no build step.
- Speech-to-text and the LLM run through the OpenAI API, called **only from the server**.
- The UI uses the Fiori Horizon design system (`design-system/`) in light mode with compact density.

---

## Interactions and branches

The prototype compares five ways of working with the AI on the same tasks. Every task starts from the same neutral starting draft, and every interaction keeps the task panel at the top and the time bar at the bottom. Each interaction lives on its own branch. `main` also keeps the basic `voice` mode.

| Interaction | Branch | How it works |
|---|---|---|
| **Intents** | [`main`](https://github.com/mmausen/hyux_pt/tree/main) | The participant thinks aloud. Each recording is split into intents: short change requests, each with the participant's reason. They appear as cards that can be switched on or off and changed by voice. **Send** hands the AI the intents that are on plus the latest draft, and the AI writes the next version. |
| **Highlight** | [`highlight`](https://github.com/mmausen/hyux_pt/tree/highlight) | The participant selects text in the draft. It is framed as a pill for one line or a rounded box for several lines, with icons to add a voice annotation and to send it to the AI. The AI returns targeted edits, and only the affected passages change. **Challenge Me** uses the annotation, the selection and the whole text to ask one short question that makes the participant reconsider their standpoint. It appears as a popup and needs no answer. |
| **Slider** | [`slider`](https://github.com/mmausen/hyux_pt/tree/slider) | The draft is on the left and a "slot machine" of sliders on the right. Each slider is one key decision between two contrasting poles, for example "Close fast, apply pressure" vs. "Take it slow, build trust". **Send Settings** writes a version from the combined settings. Generation is anchored on the previous version and cached per setting, so each change shows its own effect. By voice, the participant can add a slider (the AI finds the two poles) or remove one. |
| **Customer** | [`customer`](https://github.com/mmausen/hyux_pt/tree/customer) | "Customer in the Room": the AI plays the reader of the draft (the customer) and only reacts, the way that person would while reading. **Ask Customer** returns two to five short first-person reactions ("This feels pushy."), each tied to an exact passage, which is highlighted in the draft, and marked positive, neutral or negative. The participant switches reactions on or off, responds to them by voice and adds general instructions. **Send Changes** writes the next version from these. The customer never suggests wording: the participant decides what to change. A switcher picks the customer persona (for example the CFO or a sceptical buyer). |
| **Compare** | [`compare`](https://github.com/mmausen/hyux_pt/tree/compare) | Two similar but not identical versions stand side by side. The participant picks the one they prefer and says what they like most about it. This feeds a hidden preference profile. The picked version stays, and the other is replaced by a new one written from the profile. Step by step the profile gets richer and the versions converge, until the participant accepts one as final. |

The branch `all-modes` brings them together on top of `gen-ui`: every interaction is in one build (`intents` with the generative UI components, `highlight`, `slider`, `customer`, `compare`, and `voice`). To switch between them, run with `DEV_MODE=true`, start a session (**Skip ID** in the dev panel), pick the mode under **Interaction Mode** in the dev panel and jump to a task. The mode belongs to the session, and each mode keeps its own state in the round, so try each mode in its own round or start a **New Session** before switching. New sessions start in `interaction.mode` from `config.js` (`intents`). The tutorial exists only for `voice`, `intents` and `customer`; the other modes skip it.

---

## Contents

1. [Interactions and branches](#interactions-and-branches)
2. [Setup](#setup)
3. [How the study runs](#how-the-study-runs)
4. [Configuration reference](#configuration-reference) (every option in `config.js` and `.env`)
5. [Adding or changing a task](#adding-or-changing-a-task)
6. [Text, questionnaire and language](#text-questionnaire-and-language)
7. [Adding an interaction mode](#adding-an-interaction-mode)
8. [Dev mode](#dev-mode)
9. [Logging](#logging)
10. [Security and privacy](#security-and-privacy)
11. [Running a study session](#running-a-study-session)
12. [Project structure](#project-structure)

---

## Setup

You need Node.js 20.12 or later. The project was built on Node 26.

```bash
npm install
```

```bash
cp .env.example .env
```

Open `.env`, then set `OPENAI_API_KEY`. Set `DEV_MODE=true` while you build or test (see [Dev mode](#dev-mode)).

```bash
npm start
```

Open http://localhost:3000 (or the `PORT` you set).

The server checks `config.js` and `data/tasks.json` at startup. If anything is wrong, it lists every problem and does not start. To run the same check without starting the server:

```bash
npm run check:config
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Starts the server and restarts it when server files change. Browser files never need a restart, only a page reload. |
| `npm run build:tokens` | Regenerates `design-system/tokens.css` from `design-system/tokens.json`. Run it only after you replace the design-system export. |

Changes to `config.js`, `data/tasks.json` or `.env` need a server restart. Changes to `content/` and `public/` need only a page reload.

---

## How the study runs

The screen order comes from `flow` in `config.js`:

```
pre:   welcome → systemCheck → tutorial
round: briefing → task → survey → interview      (repeated flow.rounds times)
post:  end
```

| Screen | What happens |
|---|---|
| **welcome** | The participant enters their ID, and the server checks it. A small or unsupported browser gets a notice here. |
| **systemCheck** | Microphone permission, then a level meter. The participant reads the test sentence aloud, the recording is transcribed, and one short LLM call is made. Each check can be retried. After `retriesBeforeContact` failed retries, a contact text appears. |
| **tutorial** | A guided tour over a sample canvas that highlights one area at a time. Then, if `tutorial.practiceTurn` is on, a practice round with real recording. **Continue to the Tasks** sits at the bottom right and becomes available, with a light pulse, after the first recording. |
| **briefing** | A dialog over the canvas shows the full scenario (situation and task) and the recommended time limit, so reading does not count toward task time. The task text behind it is hidden. **Start Task** starts the timer. |
| **task** | The main canvas of the session's [interaction mode](#interaction-modes). The task panel starts collapsed to the task title; **Show Task** opens the task with the situation (and any materials) next to it, and **Hide Task** collapses it again. Only the assistant's latest response is shown (each new one replaces it), with how long ago it was updated. Earlier responses stay stored and logged. The participant keeps going until they select **Finish Task** or time runs out. |
| **survey** | The questionnaire about the task, either built in or a link to an external tool. |
| **interview** | "Conversation Review": a read-only view of the task and every turn with timestamps, to look at together with the interviewer. Off by default. |
| **end** | Marks the session complete and shows the completion code, if one is set. |

**Reloading** the page resumes exactly where the participant was:

- the current step
- the time limit, which counts from the stored start time
- the instruction draft
- a response that was still being written
- answers already given in the questionnaire

The session lives on the server (`sessions/`). The browser only keeps the session ID in `localStorage`. If a participant enters their ID again in another browser, the same session continues there (when `allowReuse` is false).

### Interaction modes

Each session has one interaction mode, set from `interaction.mode` in `config.js` when the session starts (stored with the session, so changing the config later does not affect sessions in progress). In dev mode the dev panel can switch the current session.

**`voice`.** The participant records one or more recordings; their transcripts form the instruction ("Current Instruction", which can be cleared but not typed into). **Send Instruction** sends it. The model gets the earlier turns of the task as history (`ai.sendHistory`).

**`intents`.** The participant thinks aloud, and what they say becomes intents: short change requests for the draft.

1. **Starting draft.** Every task starts from the same generic starting draft, the task's `scaffold` in `data/tasks.json`: a plain, neutral version of the deliverable (placeholders in square brackets where needed), without any personal flavour or strategic choice. It is shown as **Starting Draft** (no AI call; the server stores it as turn 1 with `kind: 'scaffold'`), and the first AI response is Version 1. The practice round's starting draft is `tutorial.practice.intents.task.scaffold` in the strings file. A task without a `scaffold` starts as in the voice mode instead: recordings build the first instruction, **Send Instruction** sends it as spoken, and the response is the first draft.
2. **Collect.** From then on the work goes in rounds of collect, structure and generate. Each recording is transcribed and its intents are added (`ai.intents.collectPrompt`; the call also gets the task, the situation, the groups, the latest draft and the current intents). A recording changes an existing card only when it clearly revises it (a correction, a part taken back, a replacement), and may then merge cards; it takes a card back only when the participant clearly says so. Cards that a recording added or changed light up for a moment, and a line under the groups says what the recording did, with **Undo**. Only the latest recording, or the latest change by voice, can be undone, until the next recording or version. Each intent has the request (`text`), the participant's reason (`reason`, only what they said, empty if they gave none), a qualifier when one is needed (`nuance`, for example "implicit", shown as a small label), their own words (`quotes`, one per recording that shaped it) and a `group`. A card shows a checkbox (on/off), the request, the reason under **Why**, the own words folded under **Your words**, a state (**New** = not in a version yet, **Changed** = changed since its version, **In Version n** = in an older version) and, on hover or focus, a microphone (**Hold to Change**, `ai.intents.annotatePrompt`) and a cross (**Delete**). Intents that are off are not shown to the model and stay as they are.
3. **Structure and generate.** **Write Version** first brings all intents that are on into one plan (`ai.intents.structurePrompt`, with the task and the groups): intents that do not conflict stay; intents on one spectrum are combined at the position the latest words point to (a casual and then a professional tone become "Use a professional but friendly tone"); an intent that changes how another point is made joins that point and says the concrete move ("Mention the IT department in passing", nuance "implicit", with the main arguments); the groups, their names and their order stay unless the content needs a new one. The cards change to the plan on screen, and the text is then written anew from the starting draft and the plan, by group (`ai.intents.composeInstruction`), without earlier versions or history. So the cards show what the version is built from: switching a card off or deleting it and writing a version removes what it did. The button names the version and its building blocks, for example **Write Version 3 from 5 Intents**; the version is labelled **Version 3, built from 5 intents**, and a hint under the groups says when the intents changed since. If structuring fails, the version is written from the intents as they are. The task reaches the collect and structure calls, never the call that writes the text.

**Layout (`main-split`).** The canvas has three areas.

- **Task sidebar (left).** It shows the task, the situation and any materials. The arrow in its header folds it to a narrow rail, and the rail opens it again. The edge between sidebar and work area drags to resize; dragging narrower than the minimum snaps the sidebar shut, and dragging a folded sidebar out opens it. A double click on the edge, or Enter on it, folds and opens; the arrow keys resize in steps. Width and fold are kept for the next task (`localStorage`, key `taskSidebar`). Select text and pick a colour to mark it; **Remove** unmarks the selection and **Clear All** removes every mark. Marks are only a visual help: they are not stored, not sent to the model, and the log records only that a mark was made.
- **Draft (upper half).** The latest version, as before.
- **Intents (lower half).** The microphone sits on the divider line between draft and intents. The first row holds the groups, each with a light accent colour, the number of intents on and a dot when it holds something new or changed. Selecting a group opens its cards in the second row, next to each other and in the same colour; one group is open at a time, and selecting it again closes it. The group of the latest change opens by itself. Groups are generative: the model names them (it starts from `ai.intents.suggestedGroups`), the server keeps their order (`rounds[round].groups`) and gives each a colour that stays (`rounds[round].accents`).

**Generative UI (`gen-ui`).** The structuring step at **Write Version** also chooses components for the plan, from a fixed catalog, and fills them (`rounds[round].components`). The model decides whether a component appears and what it holds; the client draws it (`public/js/modes/intents/components.js`).

- **Order of the Arguments** (`arguments`), when the plan holds two or more arguments. A grid: the columns are the order in which the text makes the arguments, the rows their level (**Main**, **Supporting**). An argument moves by dragging it to another cell, by its arrow buttons and **Make Main** / **Make Supporting**, or with the arrow keys on it (left and right: order; up and down: level).
- **Tone per Passage** (`tones`), when the intents ask for different tones in different passages, or for tones that pull apart. The passages of the text in order, each with the tones on offer; one is chosen per passage.

Components sit in the group row after the groups, with a dashed outline; selecting one opens it in place of the cards. A setting the participant changed shows in full colour until the next version, and the hint under the groups names it. Settings are saved on the server (`PUT /api/intents/components`, only within what the component offers), go into the next version ("Order and weight of the arguments", "Tone per passage" after the building blocks), and the next structuring keeps them: arguments that stay keep their order and level (a merged one follows the intent it went into), new ones come where the model puts them, and a passage of the same name keeps its tone. Log events: `gen.componentToggled`, `gen.componentChanged` (the new order and levels, or the tones), `gen.componentFailed`; `server.components.set` (before and after).

Only one recording runs at a time, and recordings are collected one after the other. While the assistant writes or a recording is collected, the cards are locked. The task end waits for running transcriptions, collections and changes. Intents are stored with the session (`rounds[round].intents`) and survive a reload; merged, taken back, deleted and undone intents move to `rounds[round].removedIntents`.

**`compare`** (branch `compare`). The participant never instructs the AI: they choose. Two similar versions stand side by side between the task (top) and the timer (bottom). No tutorial yet (the tutorial screen skips itself for a mode without `tutorialSteps`).

1. **First pair.** `POST /api/compare/start` writes two versions from the outline (`scaffold`) and the situation (if `ai.compare.includeSituation`) that are alike except for two or three writing choices (`ai.compare.initialPrompt`).
2. **Pick and say why.** The participant picks a version (**Pick This One**; they can switch), then holds the microphone in that card and says what they like most about it. **Show differences** highlights the words that differ between the two.
3. **Next.** **Keep It, Show a New One** (`POST /api/compare/next`, `ai.compare.nextPrompt`) updates a hidden preference profile from the pick, the rejected version and what was said, and writes a new version from the pick: it keeps what the profile settles and varies one or two aspects it does not settle yet, more subtly as the profile grows. The kept version stays on its side, marked *Your last pick*; the other leaves and the new one (*New*) takes its place.
4. **Accept.** **Accept as Final** marks the picked version as the result (`POST /api/compare/accept`) and asks to finish the task.

The profile is never sent to the browser. Everything is stored with the session (`rounds[round].compare`: versions with their differences, the pair, the profile, every pick with the annotation and the profile before and after, the accepted version).

**`highlight`** (branch `highlight`). The participant works directly on the draft; there is no main record or send button and no tutorial yet (the tutorial screen skips itself for a mode without `tutorialSteps`).

1. **Starting draft.** As in the intents mode (`scaffold`, stored as turn 1).
2. **Highlight.** Selecting text in the draft snaps to whole words and frames the passage: a pill for one line, a rounded outline that follows the text for several lines. A small toolbar under it has three icons: microphone (hold to annotate by voice; each recording is added to the annotation), send to the assistant (needs an annotation) and remove. A new selection replaces the old one (and its annotation); Escape removes it.
3. **Send** asks the model for targeted edits (`ai.highlight.editPrompt`): the draft with the passage marked and the annotation go in, a list of `{ find, replace }` edits comes back. The server applies them (an edit that does not match is skipped; one that matches more than once is applied nearest to the passage) and stores the new draft as a turn with `kind: 'edit'`. Only the changed words flash in the draft.
4. **Challenge Me** (in place of the send button) sends the draft, the highlighted passage and the annotation (`ai.highlight.challengePrompt`) and shows one short question in a popup above the button. It is not answered and changes nothing; the participant closes it when they want.

**`slider`** (branch `slider`). The participant does not instruct the AI in words: they set decisions. The output is on the left, a slot machine of sliders on the right, the timer at the bottom. No tutorial yet (the tutorial screen skips itself for a mode without `tutorialSteps`).

1. **Start.** The output shows the starting draft (`scaffold`). The sliders come from the task's `sliders` in `data/tasks.json`: each one decision (`theme`) with two opposite poles (`a`, `b`). Both are set up by `POST /api/slider/start` and stored with the session (`rounds[round].sliders`).
2. **Sliders.** Each slider is a reel with five stops: strongly a, leaning a, balanced, leaning b, strongly b (new sliders start balanced). It turns with its arrows, the mouse wheel, dragging, the arrow keys or a click on a stop. Reels moved since the last version get a dot.
3. **Send Settings** (at the base of the machine) writes a version from all positions (`/api/chat` with `{ sliders }`): the model gets `ai.slider.writeInstruction`, the situation (if `ai.slider.includeSituation`), the decisions, and the starting draft or, after it, the previous version with the changed decisions and `ai.slider.anchorInstruction` (keep everything the change does not affect). No history. The words that changed against the version before are highlighted (**Show changes** turns this off).
4. **Same settings, same text.** The model takes no temperature or seed, so outputs are made reproducible in another way: each version is anchored on the previous one, and the same decisions in the same positions always return the version already written for them (from `rounds[round].sliderCache`, no model call; shown as *Version n (same settings as Version m)*). Every difference therefore comes from moving a slider.
5. **By voice.** The microphone at the base adds or removes a slider (`POST /api/slider/voice`, `ai.slider.voicePrompt`): talking about an aspect to weigh up ("not sure how long this should be") creates a slider with the two extremes the AI finds ("Short, punchy note" ↔ "Full, detailed proposal"); naming a slider to drop removes it. At most `ai.slider.maxSliders`.

**`customer`** ("Customer in the Room"). The AI plays the recipient of the draft and reacts to it the way that person would while reading. It only reacts and never suggests wording or solutions; the participant decides what to change. The aim is to move the participant from specifying text to judging how the text lands with the reader.

1. **Starting draft.** As in the intents mode, the task starts from its `scaffold` (`/api/intents/start`). The practice round starts from `tutorial.practice.customer.task.scaffold`, a short finished email, so the customer has something to react to.
2. **Customer.** Above the margin, a switcher picks the customer persona: the task's `personas` in `data/tasks.json` (the first is the default), or, for a task without any, one generic busy decision-maker (`ai.customer.defaultPersona`). A change affects only reactions asked for after it. Under the switcher, a short line says who the persona is (`about`).
3. **Ask Customer.** The customer reads the latest draft (`ai.customer.reactPrompt`; the model sees the persona's `profile` and the draft, nothing else) and returns two to five reactions in the first person. Each has the exact passage it refers to (`quote`), the reaction (`text`) and a tone (`positive`, `neutral`, `negative`). The server finds each passage in the draft, also when the model changed quote marks or spacing; a passage it cannot find keeps its card but gets no highlight. The reactions appear as numbered cards in the margin, in the order of their passages, and each passage is highlighted in the draft with the same number and the tone's colour. Pointing at a card lights up its passage and the other way round; selecting the passage on a card scrolls to it, and selecting a highlight shows its card. The customer can be asked again at any time, also as another persona; new reactions join the list.
4. **Reactions.** Each card can be switched on or off. Its microphone (**Hold to Respond**) records a response; the transcript is shown on the card under **You**, and a reaction with a response is switched on. The main record button adds **general instructions** that are not tied to a reaction; they are listed under **Your Instructions** with their own on/off switch.
5. **Send Changes** hands the model the latest draft, the reactions that are on (with persona, tone, passage and the participant's responses) and the general instructions that are on (`ai.customer.reviseInstruction`), not the history. A reaction that is on but has no response asks the model to change the passage so the reaction would no longer arise; a positive one without response marks what to keep. The response is the next version. The reactions of the previous version, and the instructions sent with it, then move into a collapsed **Earlier reactions** group (read-only, each marked **Used for Version n** or **Not used**), and the customer can be asked again.

While the customer reads or the assistant writes, the cards are locked. The task end waits for a running ask, transcription or response. Everything is stored with the session (`rounds[round].customer`, see `server/routes/customer.js`) and survives a reload. An ask is stored before the LLM call and finished on the server even if the page goes away: after a reload while the customer is reacting, the margin shows "… is reading the draft" and the reactions appear when they arrive.

---

## Configuration reference

### `.env` (secrets and environment, never committed)

| Variable | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | — | Required unless every call is mocked in dev mode. It stays on the server. |
| `PORT` | `3000` | HTTP port. |
| `DEV_MODE` | `false` | `true` turns on the dev panel, the dev routes and mock mode. **Must be off for participants.** It cannot be turned on from the URL or the browser. |
| `TRUST_PROXY` | unset | Set it to `true` behind an HTTPS reverse proxy, so that rate limiting sees the real client IPs. |

### `config.js`

Each section of `config.js` is documented below. Every option is checked at startup.

#### `study`
| Option | Example | Meaning |
|---|---|---|
| `id` | `'hyux-formative-01'` | Identifies the study run. |
| `productName` | `'Sales Workbench'` | Plain text shown in the shell bar and as the page title. Don't use logos or SAP product names. |
| `locale` | `'en'` | Loads `content/strings.<locale>.js` and `content/survey.<locale>.js`, and sets the page language. |
| `completionCode` | `''` | Shown on the end screen if it is not empty, for example a panel provider's code. It reaches the browser only on the end screen. |

#### `participants`
| Option | Meaning |
|---|---|
| `validIds` | List of valid participant IDs. Matching ignores case and surrounding spaces. **This list is never sent to the browser.** |
| `allowReuse` | `false`: one session per ID. Entering the ID again resumes that session. After the session is completed, the ID is rejected. `true`: every entry starts a new session. |

#### `flow`
| Option | Meaning |
|---|---|
| `pre`, `round`, `post` | Screen order before, during (×N) and after the rounds. Screen names are the modules in `public/js/screens/index.js`. |
| `enabled` | `{ tutorial, survey, interview }`. A screen set to `false` is skipped everywhere. |
| `rounds` | Number of tasks per participant (N). It must not exceed the number of tasks available to a participant. |
| `taskSelection.mode` | `'fixed'` uses `order` as is. `'random'` shuffles `order` once per participant (and keeps it across reloads). `'perParticipant'` uses the participant's list in `perParticipant`. |
| `taskSelection.order` | Task IDs from `data/tasks.json`. |
| `taskSelection.perParticipant` | `{ P01: ['task-02', 'task-01', 'task-03'], … }`. IDs that aren't listed fall back to `order`. Every ID must be in `validIds`, and every task ID must exist. |

The tasks for a session are assigned when it starts and stored with it. Changing the selection later doesn't affect running sessions.

#### `interaction`
| Option | Meaning |
|---|---|
| `mode` | Default interaction mode for new sessions (currently `'intents'`): a folder in `public/js/modes/` (`'voice'`, `'intents'`, `'highlight'`, `'slider'`, `'customer'` or `'compare'`, see [Interaction modes](#interaction-modes)). The dev panel can switch the current session. |
| `recordingMode` | `'pushToTalk'`: hold the button or the Space key. Space works only when focus isn't in a text field. `'toggle'`: select once to start and again to stop. The tutorial text follows this setting. |
| `maxRecordingSeconds` | A recording stops automatically after this long and is transcribed. |

#### `tutorial`
| Option | Meaning |
|---|---|
| `practiceTurn` | `true`: the tutorial ends with one real recording sent to the AI. It uses real API calls unless mock mode is on. |

#### `timer`
| Option | Meaning |
|---|---|
| `mode` | `'hard'`: at the limit, a notice shows for `endNoticeSeconds`, then the task ends. `'soft'`: at the limit, a notice shows and the bar turns red, but the task goes on until the participant ends it. `'grace'`: at the limit, `graceMinutes` of extra time start. When they run out, the task ends like in `'hard'`. |
| `graceMinutes` | Extra time in `'grace'` mode. |
| `warningSecondsBeforeLimit` | The bar turns orange and a notice appears this many seconds before the limit (`0` = no warning). |
| `endNoticeSeconds` | How long the "time is up" notice shows before the study moves on. |

Participants see time only as a progress bar under the controls, with no countdown in numbers. The briefing shows the limit as the "Recommended Time Limit". The time limit per task is `timeLimitMinutes` in `data/tasks.json`. If the limit is reached during a recording, the recording stops and is transcribed, and the transcript is logged. If it is reached while the assistant is writing, the response is finished and shown before the task ends.

#### `ai`
| Option | Meaning |
|---|---|
| `assistantName` | Name shown for the assistant. Use a job-based name, not a human name. |
| `model` | OpenAI model, called through the Responses API. |
| `systemPrompt` | Instructions for the model. **The model that writes the text never sees the task or the situation.** It sees only this prompt, the earlier turns (if `sendHistory`) and the new instruction; in the intents mode, the starting draft (`scaffold`) and the active intents. Only the intent calls that collect and structure read the task, to understand and place what the participant says. It asks for the text only, without introduction or comments. As a safety net, `public/js/core/cleanResponse.js` removes a remaining introduction ("Here is the revised version:", "Shortened to five sentences:") or closing comment ("Let me know if you'd like other changes to the draft.") from every response, both while it streams and before it is stored. The removed parts are kept in `rawResponse` and logged. |
| `temperature` | `null` = not sent. Some models (for example `gpt-6.2-sol`) don't accept it. |
| `reasoningEffort` | `null` = not sent. Otherwise `'low'`, `'medium'`, `'high'`, `'xhigh'` or `'max'`. Lower effort gives faster responses. |
| `maxOutputTokens` | Upper limit for one response. |
| `sendHistory` | `true`: the earlier turns of the current task are sent with each instruction. |
| `timeoutSeconds` | A response that takes longer fails with a retry option. Also the time limit for the AI check in the system check and for intent calls. Responses always stream: they appear while they are being written. |
| `intents.suggestedGroups` | Intents mode: typical parts of the text, `{ name, about }`, offered to the model until a round has groups of its own. |
| `intents.collectPrompt` | Intents mode: instructions for collecting the intents of a recording. Returns JSON (`{ added: [{ group, text, reason, nuance, quote }], revised: [{ id, mergedFrom, … }], removed }`). |
| `intents.structurePrompt` | Intents mode: instructions for bringing all active intents into the plan of a version. Returns JSON (`{ groups, intents: [{ id, mergedFrom, group, text, reason, nuance }] }`). |
| `intents.annotatePrompt` | Intents mode: instructions for rewriting one intent from a spoken annotation. Gets the intent and its reason; returns JSON (`{ text, reason }`). |
| `intents.composeInstruction` | Intents mode: put before the plan (by group, each intent with its nuance and reason) and the starting draft when **Write Version** is selected. The text is written with `systemPrompt` as usual. |
| `intents.maxOutputTokens` | Upper limit for changing an intent by voice. |
| `intents.collectMaxOutputTokens`, `intents.structureMaxOutputTokens` | Upper limits for collecting a recording and for the plan of a version. |
| `intents.hedgeAfterSeconds` | If an intent call (collect, structure or change) has not answered after this many seconds, a second, identical request starts and the first answer is used. Intent calls usually take 2–3 s; this cuts the rare request that takes 20 s or more. `0` = off. The log shows `attempts` (requests started) and `attempt` (which one answered). |

#### `stt` (speech-to-text)
| Option | Meaning |
|---|---|
| `model` | OpenAI transcription model. |
| `languages` | Expected languages, for example `['en']` or `['en', 'de']`. |
| `prompt` | Optional vocabulary hint, such as product or customer names. |
| `timeoutSeconds` | Server-side timeout for one transcription, in the tasks and in the system check. |

#### `systemCheck`
| Option | Meaning |
|---|---|
| `testSentence` | The sentence participants read aloud. |
| `maxRecordingSeconds` | Recording limit for the test. |
| `retriesBeforeContact` | After this many failed retries, the screen shows the contact text from the strings file. |

#### `survey`
| Option | Meaning |
|---|---|
| `type` | `'internal'` shows `content/survey.<locale>.js`, and the answers go to the log. `'external'` shows an **Open Questionnaire** link and an **I Have Finished the Questionnaire** button. |
| `externalUrl` | `'external'` only. `{participantId}`, `{round}` and `{taskId}` are filled in. |

#### `limits`
| Option | Meaning |
|---|---|
| `maxAudioUploadMB` | Larger uploads are rejected (413). |
| `rateLimit.windowSeconds` | Window for the limits below. |
| `rateLimit.transcribePerWindow` | Transcriptions per session per window. |
| `rateLimit.chatPerWindow` | AI requests (and system-check calls) per session per window. |
| `rateLimit.sessionStartPerWindow` | ID entries per IP per window. This limits guessing. |

#### `logging`
| Option | Meaning |
|---|---|
| `dir` | Folder for the log files (`logs/`, gitignored). |
| `storeAudio` | `false` (default): recordings are transcribed and discarded. `true`: each recording is also saved to `logs/audio/<participantId>/`, and the `server.transcribe` event names the file. Only turn this on if the consent covers it. |

#### `dev` (used only when `DEV_MODE=true`)
| Option | Meaning |
|---|---|
| `participantId` | ID used by **Skip ID**. It doesn't need to be in `validIds`. |
| `mockByDefault` | Dev sessions start with mock speech-to-text and a mock LLM (no API cost). |
| `timerSpeeds` | Speed choices in the dev panel. |
| `mockLatencyMs` | Simulated delay of mock calls. |

---

## Adding or changing a task

Tasks are in `data/tasks.json`:

```json
{
  "id": "task-04",
  "title": "Follow up after a trade fair",
  "situation": "Background the participant needs: who, what happened, what they know.",
  "task": "The instruction: what the participant should get the assistant to produce.",
  "briefing": "Short text shown before the task starts (may be empty).",
  "scaffold": "Generic starting draft for the intents mode: an outline with [placeholders], no choices made.",
  "personas": [
    { "id": "cfo", "name": "CFO", "role": "Main contact", "about": "Shown under the switcher.", "profile": "Who the customer is, for the model: role, situation, what they care about." }
  ],
  "timeLimitMinutes": 6,
  "materials": [
    { "title": "Booth Notes", "body": "Text. Line breaks are kept." }
  ]
}
```

- `id`, `title`, `situation`, `task` and `timeLimitMinutes` are required. `briefing` may be an empty string. `materials`, `scaffold` and `personas` are optional. `scaffold` is used by the intents and customer modes, and it is the one part of the task the model sees (as the first current draft).
- `personas` is only used by the customer mode: the customers who can read the draft, the first being the default. `id`, `name` and `profile` are required; `role` and `about` are shown to the participant. The `profile` is what the model knows about the customer; it is the only other part of the task the model sees, and it is never sent to the browser. The three tasks have a CFO (the main contact), a Head of Procurement (a sceptical buyer) and a Chief Nursing Officer (a daily user).
- The briefing shows `situation` and `task` in full. During the task the task panel starts collapsed; **Show Task** opens the task, the situation and any materials.
- Use a blank line (`\n\n`) in `situation` to separate paragraphs. Line breaks are kept.
- The layout is checked for a situation of about 120 words and a task of about 40 words, at 1024×768 and larger. Much longer texts still work but scroll.
- `placeholderFields` (optional) is only a note for authors. It marks fields that still hold generated placeholder text.
- To use the new task, add its ID to `flow.taskSelection.order` (or to `perParticipant` lists) and, if needed, raise `flow.rounds`. Then restart and run `npm run check:config`.

The browser receives only the tasks assigned to the current session.

---

## Text, questionnaire and language

- **All UI text** is in `content/strings.en.js`, grouped by screen. Follow the design-system writing rules:
  - Title Case for buttons and titles, and buttons start with a verb.
  - Plain, neutral sentences, without emoji or exclamation marks.
  - The working state describes what is happening (never "Thinking…").
- **The questionnaire** is in `content/survey.en.js`. Each question has an `id`, which becomes the key in the logged answers, a `text`, and `required`. The types are:
  - `scale`: needs `min`, `max`, and optionally `minLabel` and `maxLabel`. Shown as one button per value.
  - `choice`: needs `options`. Single choice.
  - `text`: free text, up to 2000 characters.
- **Another language:** copy both files with the new locale code (for example `strings.de.js` and `survey.de.js`), translate them, set `study.locale`, and add the language to `stt.languages`. Placeholders such as `{round}` must stay unchanged.

---

## Adding an interaction mode

The core is independent of how participants give instructions. The core consists of:

- the flow controller
- the timer
- the logger
- the AI client
- the session state
- the screens

A mode is a folder `public/js/modes/<name>/` whose `index.js` exports:

```js
export const name = 'typed';
export function createCanvas(ctx, options) { … }          // the task UI
export function tutorialSteps({ recordingMode }) { … }    // the tutorial tour
```

**`createCanvas(ctx, { round, task, live, conceal, sample, showFinish, onTurn, onRecorded })`** builds the task UI and returns:

| Member | Used by | Purpose |
|---|---|---|
| `el` | all | Root element; the screen inserts it. |
| `timerSlot` | task | Element where the task screen puts the timer bar. |
| `noticeSlot` | task, tutorial | Element for notices (time warnings, practice banner). |
| `getRegion(name)` | tutorial | Returns the element for a tour step (`task`, `record`, `transcript`, `send`, `output`, `timer`, `finish` in the voice mode; the intents mode adds `intents` and `intentCard`; the customer mode adds `persona`, `ask`, `reactions`, `reactionCard` and `notes`). |
| `onFinishRequest` | task | Set by the task screen; call it when the participant selects Finish Task. |
| `isBusy()` | task | True while a recording, transcription or AI response is running. |
| `setLocked(bool)` | task | Turns input off (for example at the time limit). |
| `stopRecording(reason)` | task | Stops a running recording (the time limit uses this). |
| `whenIdle()` | task | Promise that resolves when nothing is running any more. |
| `destroy()` | all | Releases listeners and timers. |

Options:
- `live: false` renders the same layout without input. The briefing backdrop and the tutorial use it.
- `conceal` hides the task text.
- `sample` provides `{ turns, draft, intents, scaffold, customer }` for the tutorial (`tutorial.sample` in the strings file; a mode uses what it needs). The customer mode shows the first sample turn with `customer.reactions` (quotes from it) and `customer.notes`, and takes its personas from `tutorial.sample.task.personas`.
- `onTurn(turn)` is called after each finished AI response.
- `onRecorded()` is called after each recording of the main record button that was transcribed (in the customer mode also after a response to a reaction). The tutorial uses it to make **Continue to the Tasks** (bottom right) available after the first practice recording.

**Build the canvas on `core/conversation.js`.** It holds everything about talking to the assistant that doesn't depend on the input:
- sending an instruction and streaming the response
- the list of finished turns and the one being answered
- picking up a response that was still being written before a reload
- logging (`ai.sent`, `ai.received`, `ai.failed`)
- busy and idle: `isBusy()` and `whenIdle()` can be passed straight through to the canvas API

A mode then only adds its input and its layout. It marks its own work with `conv.setBusy(key, on)`, so the task end waits for it; the voice mode does this for transcription. `conv.send(text, logPayload, body)` can pass extra fields to `/api/chat` (the intents mode sends `{ intentIds }`, the customer mode `{ customer: { reactionIds, noteIds } }`).

**Shared canvas parts** in `public/js/core/canvas/`, used by both modes:
- `taskPanel.js`: the task panel with Hide/Show Situation (open by default).
- `taskSidebar.js`: the foldable, resizable task sidebar with highlighting (used by the intents mode).
- `latestResponse.js`: the latest response with "Version n" and "Updated … ago".
- `controls.js`: the bar with record button, level meter, send, finish and the timer slot.
- `voiceInput.js`: one record button from recording to transcript (`onText`), with logging and busy marking. A mode can have several (the intents mode has one per card, with `keyboard: 'focus'` so Space only works on the focused button).

See `public/js/modes/voice/canvas.js` (the smallest) and `public/js/modes/intents/canvas.js` for how they fit together. Use `logEvent` for the mode's own events. That way the server routes, logging and mock mode work unchanged.

**`tutorialSteps()`** returns `[{ region, titleKey, textKey }]`. Each region is the name passed to `getRegion`. The keys point to text in the strings file.

Set `interaction.mode: '<name>'` in `config.js`. The server checks that the folder exists, and the dev panel lists every folder.

Recording itself sits behind the `Recorder` interface (`public/js/core/recorder/`) with `pushToTalk` and `toggle` implementations. A new way of recording is a new subclass, registered in `recorder/index.js`.

---

## Dev mode

Dev mode is on only with `DEV_MODE=true` in `.env`. When it is off, the dev panel file and the `/api/dev` routes are not served at all (404).

The **Dev Mode** panel at the top right (it can be collapsed) offers:

- **Session:** shows the current participant, session and tasks.
  - **Skip ID** starts a dev session (participant `dev.participantId`).
  - **Skip System Check** and **Skip Tutorial** jump past those screens.
  - **New Session** forgets the session in this browser.
- **Interaction mode:** switches the current session to another mode and shows the current step again in it. The default for new sessions is `interaction.mode` in `config.js`. Logged as `session.modeChanged`.
- **Mock mode:** switches for Speech-to-text and the LLM.
  - Mock transcription returns the test sentence in the system check and canned instructions elsewhere.
  - The mock LLM returns canned drafts. For intents it splits the comment at sentences and "and", and appends an annotation to the intent: enough to click through, not a real rewrite. For the customer it picks three or four sentences spread over the actual draft, quotes their first words exactly and gives each a canned reaction that fits (money, opening, a request, anything else), varying from ask to ask.
  - Neither costs anything. Dev sessions start mocked when `dev.mockByDefault` is true.
- **Jump to step:** go to any step of the flow.
- **Timer speed:** 1×, 10× or 60×, to test time limits quickly. The choice is remembered in this browser.
- **Session state:** the stored browser state.
- **Logged events:** live list of events as they are logged.

To test the end of a task quickly, set a task's `timeLimitMinutes` to `1` or use 60× speed.

---

## Logging

`logEvent(type, payload)` in the browser buffers events and sends them in batches to `POST /api/log`. They are also sent when the tab is hidden or closed. The server writes them through the logger interface (`server/logger/index.js`).

Storage today is one JSON-lines file per participant: `logs/<participantId>.jsonl`. Failed ID entries go to `logs/invalid-attempts.jsonl` (only the length of what was typed). To store events elsewhere (a database or a service), replace the implementation in `server/logger/` and keep `write(event)`. No route or screen changes.

Every event has the same fields:

```json
{
  "ts": "2026-11-18T12:17:30.202Z",
  "clientTs": "2026-11-18T12:17:29.196Z",
  "participantId": "P07",
  "sessionId": "7c3e1bc8-…",
  "round": 1,
  "taskId": "task-01",
  "msSinceTaskStart": 44073,
  "type": "ai.received",
  "payload": { }
}
```

The fields mean:
- `ts`: server time.
- `clientTs`: browser time, or `null` for server events.
- `round`: 1..N for tasks, 0 for the tutorial practice turn, `null` outside a round.
- `msSinceTaskStart`: counts from **Start Task**.
- **Participant and session always come from the server-side session, never from the browser.**
- For server events, `msSinceTaskStart` is server time minus the task start the browser saved. A clock difference between the participant's computer and the server shifts it by that amount. Use `clientTs` with browser events for exact ordering within a session.

Events (`server.*` and `session.*` come from the server; all others come from the browser):

| Area | Events |
|---|---|
| Session | `session.started` (with `mode`), `session.resumed`, `session.completed`, `session.invalidId`, `session.client` (browser, viewport), `session.modeChanged` (dev panel) |
| Steps | `step.entered`, `step.left` (with reason), `step.error` |
| System check | `systemCheck.check` (each check and its result), `systemCheck.passed`, `recording.*` with `context: 'systemCheck'` |
| Tutorial | `tutorial.started`, `tutorial.step`, `tutorial.tourCompleted`, `tutorial.practiceStarted`, `tutorial.practiceUnlocked` (reason: `recording`, `turn` or `resumed`), `tutorial.practiceTurn`, `tutorial.completed` |
| Task | `task.started` (with `mode`), `taskPanel.opened`, `taskPanel.closed` (the task panel starts collapsed to its title), `task.finishRequested`, `task.finishCancelled`, `task.finished` (reason, elapsed time, turns) |
| Timer | `timer.warning`, `timer.limit`, `timer.graceEnd` |
| Recording | `recording.start`, `recording.stop` (duration, reason, size, format, peak level), `recording.error`. Intents mode: `target: 'instruction'` (first instruction), `'intents'` (new intents) or `'intent'` with `intentId` (a card's annotation). Customer mode: `target: 'note'` (a general instruction) or `'reaction'` with `reactionId` (a response). The same fields are on `transcript.*`. |
| Transcription | `transcript.received` (length, latency), `transcript.empty`, `transcript.failed`, `draft.cleared` (the discarded text), `server.transcribe` (text, latency, size, format, audio file if stored) |
| Intents | `scaffold.shown` (chars), `scaffold.failed`, `server.scaffold.shown` (**starting draft text**), `intents.collected` (added, updated, merged, removed, number on, latency), `intents.collectFailed`, `intents.undone` (kind, what it undid), `intents.undoFailed`, `intents.structured` (added, updated, merged, removed, number on), `intent.deleted` (ID, on/off, state), `intent.deleteFailed`, `intent.toggled` (ID, on/off, number on, state), `intent.toggleFailed`, `intent.quoteToggled` (ID, open), `intents.groupToggled` (group, open, count), `taskSidebar.toggled` (collapsed, via), `taskSidebar.collapsed` / `taskSidebar.expanded` / `taskSidebar.resized` (width), `taskSidebar.highlight` (colour, number of marks; no text), `taskSidebar.highlightRemoved`, `taskSidebar.highlightsCleared`, `intent.annotated` (ID, latency), `intent.annotateFailed`, `server.intents.collected` (**transcript, the intents before and after**, what changed), `server.intents.undone` (**intents restored**), `server.intents.structured` (**the plan before and after**, groups, what changed), `server.intent.deleted` (**intent text and reason**), `server.intent.annotated` (**annotation, intent and reason before and after**) |
| AI | `ai.sent` (length; intents mode: `step: 'first'` or `'intents'` with the intent IDs sent and the number switched off), `ai.received` (latency, first token; `resumed: true` if the response finished during a reload), `ai.failed`, `server.ai.request` (instruction, model, history length; intents mode: the intents sent, with their reasons), `server.ai.response` (**response text**, latency, token usage; `cleaned: true` and **`rawText`** when an introduction or closing comment of the model was removed) |
| Questionnaire | `survey.submitted` (answers), `survey.externalOpened`, `survey.externalDone` |
| End | `study.completed` |
| Problems | `client.error` (uncaught errors, failed saves), `client.saveRecovered`, `client.smallScreen`, `server.error` (route, error code, detail) |

Texts (transcripts, instructions, responses) are logged once, in the `server.*` events; the browser events carry lengths and timings. The complete conversation of each round is also stored with the session in `sessions/<sessionId>.json` (`rounds[round].turns`). It includes the instruction, response, times, latency and token usage. In the intents mode, `rounds[round].intents` holds every intent with its reason, quote, source transcript, annotations (before/after, with reasons), on/off state and the versions it was sent in. In the customer mode, `rounds[round].customer` holds every ask (persona, version, timing), every reaction (passage, text, tone, on/off, responses, the versions it was used for) and every general instruction.

---

## Security and privacy

- The OpenAI key is read from `.env` on the server. The browser never calls OpenAI, and the key never appears in any response.
- Participant IDs are checked on the server. The browser receives neither the list nor the system prompt, only a safe part of the config (`server/config/clientConfig.js`).
- Every API call after the ID entry needs the session ID that the server issued.
- Limits:
  - audio size (`maxAudioUploadMB`), with only audio formats accepted
  - recording length
  - instruction length (4000 characters)
  - request body size (256 KB)
  - rate limits per session and per IP
- Security headers include a Content Security Policy. Scripts load only from this server. Icons and the 72 font load from jsDelivr.
- Audio isn't stored by default (`logging.storeAudio: false`).
- `logs/`, `sessions/`, `.env` (and any `.env.*` except `.env.example`) and all `*.jsonl` files are gitignored. Treat `logs/` and `sessions/` as research data: they contain everything participants said to the assistant.
- A pre-commit check in `.githooks/pre-commit` blocks these files even when they are added with `git add -f`, and blocks any change that contains something that looks like an OpenAI key (`sk-…`). `npm install` turns it on for the clone (the `prepare` script sets `core.hooksPath`). If you clone without running `npm install`, run `git config core.hooksPath .githooks` once.

---

## Running a study session

Before a session:
1. Set `DEV_MODE=false` in `.env`, and check `validIds`, `rounds`, `taskSelection`, `timer` and `survey` in `config.js`.
2. Run `npm run check:config`, then `npm start`.
3. Go through the study once with a spare ID, using real calls. Then delete that ID's files in `logs/` and `sessions/`, or keep a spare ID only for this.
4. Use the latest Chrome or Edge on a laptop or desktop with a working microphone. Firefox and Safari also work.

To deploy on a server, run it behind HTTPS, because browsers allow the microphone only on HTTPS or localhost. Set `TRUST_PROXY=true` there. `logs/` and `sessions/` must be on persistent storage.

To start over with an ID, delete that participant's session file in `sessions/`. The `participantId` is inside the file. You can also set `allowReuse: true` for the test.

---

## Project structure

```
config.js                 study configuration (single source of truth)
data/tasks.json           tasks
content/                  all UI text and the questionnaire, per locale
design-system/            Fiori Horizon export (don't edit; tokens.css is generated)
server/
  index.js                Express app, security headers, static files
  config/                 load + validate config, client-safe subset
  routes/                 session, transcribe/health, chat (streaming), intents, compare, log, dev
  services/               OpenAI calls, mocks, session store, task assignment
  middleware/             session check, rate limiting
  logger/                 logger interface + JSONL implementation
public/
  index.html, css/app.css shell and prototype styles (only reads --sap… variables)
  js/main.js              bootstrap
  js/core/                flow controller, session, API client, conversation, logEvent, timer, recorder, dialogs, coach marks
  js/core/canvas/         canvas parts shared by the modes: task panel, task sidebar (intents mode), latest response, controls, voice input
  js/screens/             one module per screen: { mount(container, ctx), unmount() }
  js/modes/voice/         voice interaction mode: canvas + tutorial steps
  js/modes/intents/       intents interaction mode: canvas + tutorial steps
  js/modes/compare/       compare interaction mode: canvas (two versions) and word diff
dev-client/devPanel.js    dev panel (served only in dev mode)
scripts/build-tokens.mjs  generates design-system/tokens.css
```
