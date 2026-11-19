// Study configuration: the single source of truth for every study decision.
// Secrets and environment settings (OPENAI_API_KEY, PORT, DEV_MODE) live in .env, not here.
// The server validates this file at startup (server/config/validate.js) and sends only a
// client-safe subset to the browser (server/config/clientConfig.js). See README.md for every option.

export default {
  study: {
    id: 'hyux-formative-01',
    productName: 'Sales Workbench', // plain text in the ShellBar; no logos
    locale: 'en', // loads content/strings.<locale>.js and content/survey.<locale>.js
    completionCode: '', // shown on the end screen if not empty
  },

  participants: {
    // Valid participant IDs. Never sent to the browser. Matching ignores case and surrounding spaces.
    validIds: [
      'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10',
      'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20',
    ],
    // false: an ID can start one session. Entering it again resumes that session until it is
    // completed; after that the ID is rejected. true: every entry starts a new session.
    allowReuse: false,
  },

  flow: {
    // Screen order. Screens are modules in public/js/screens/. Reordering here reorders the study.
    pre: ['welcome', 'systemCheck', 'tutorial'],
    round: ['briefing', 'task', 'survey', 'interview'],
    post: ['end'],
    // Optional screens. A screen set to false is skipped.
    enabled: { tutorial: true, survey: true, interview: false },
    rounds: 3, // N
    taskSelection: {
      mode: 'fixed', // 'fixed' | 'random' | 'perParticipant'
      order: ['task-01', 'task-02', 'task-03'], // used by 'fixed'; 'random' shuffles this list per participant
      // used by 'perParticipant'; IDs not listed here fall back to 'order'
      perParticipant: {
        // P01: ['task-02', 'task-01', 'task-03'],
      },
    },
  },

  interaction: {
    // Default interaction mode for new sessions (a folder in public/js/modes/). In dev mode the dev panel
    // can switch the current session.
    //   'voice'   : spoken instructions build the instruction; each send goes to the AI with the history.
    //   'intents' : the task starts from its generic starting draft (`scaffold` in data/tasks.json; without
    //               one, the first instruction is sent as spoken). Each recording is split into intent
    //               cards that can be switched off or changed by voice; a send hands the AI only the
    //               active intents and the latest draft.
    mode: 'intents',
    recordingMode: 'pushToTalk', // 'pushToTalk' (hold button or Space) | 'toggle' (click to start, click to stop)
    maxRecordingSeconds: 60,
  },

  tutorial: {
    practiceTurn: true, // end the tutorial with one real recording sent to the AI
  },

  timer: {
    mode: 'grace', // 'hard' | 'soft' | 'grace'
    graceMinutes: 2, // 'grace' only
    warningSecondsBeforeLimit: 60,
    endNoticeSeconds: 5, // 'hard' and end of 'grace': how long the notice shows before the study moves on
  },

  ai: {
    assistantName: 'Sales Assistant', // job-based name, never a human name
    model: 'gpt-6.2-sol',
    systemPrompt:
      'You are a writing assistant for sales professionals. You receive spoken instructions that were ' +
      'transcribed automatically, so they may contain recognition errors; interpret them sensibly. ' +
      'Do what the instruction asks. Answer with the requested text only: no introduction (such as ' +
      '"Here is the revised version:"), no label or heading about the text, and no comment, note or ' +
      'offer after it. If an instruction is unclear, make a reasonable assumption without mentioning it. ' +
      'Write plain text without Markdown formatting; use line breaks for structure.',
    temperature: null, // null = not sent. gpt-6.2-sol and gpt-6.2-astra do not accept temperature.
    reasoningEffort: 'low', // null = not sent; otherwise 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    maxOutputTokens: 1500,
    sendHistory: true, // include earlier turns of the current task
    timeoutSeconds: 60, // also used for the AI check in the system check
    // Prompts of the 'intents' mode. The base systemPrompt above is used for writing the draft; these
    // are separate calls. Intents are the building blocks of the text, and the work goes in rounds:
    // collect (each recording adds intents; it changes existing ones only when it clearly revises them),
    // structure (Write Version brings all active intents into one plan) and generate (the text is
    // written anew from the starting draft and that plan). The task reaches the collect and structure
    // calls, never the call that writes the text.
    intents: {
      // Typical parts of the text, offered to the model until the round has groups of its own. Groups
      // are generative: the model names them, and once named they stay.
      suggestedGroups: [
        { name: 'Structure', about: 'order, length, sections, opening and closing' },
        { name: 'Tone', about: 'voice, formality, warmth, confidence and wording' },
        { name: 'Main arguments', about: 'the central points the text makes, openly or implicitly' },
        { name: 'Supporting arguments', about: 'secondary points, examples and evidence' },
        { name: 'Details', about: 'facts, figures, names, dates and the call to action' },
      ],
      collectPrompt:
        'You collect the author\'s intents for a text they write with an assistant. Intents are the building ' +
        'blocks of the text: each says what the text should do or contain, in the author\'s terms, with the ' +
        'author\'s reason. You receive the task, the groups of the text (its parts, in order), the current ' +
        'draft, the current intents (JSON, each with an id) and a new spoken comment by the author. The ' +
        'comment was transcribed automatically and may contain recognition errors. Turn the comment into ' +
        'intents. What the author says is usually new: return it in added. Change a current intent only ' +
        'when the comment clearly revises it, that is, the author corrects it, takes part of it back or ' +
        'replaces it; return such a change in revised with the intent\'s id, and if the comment clearly turns ' +
        'several current intents into one, list the other ids in mergedFrom. If the author clearly takes an ' +
        'intent back, list its id in removed. When in doubt, add. Never revise an intent only because a new ' +
        'one touches the same aspect: bringing them together comes later. For every intent: group, the part ' +
        'of the text it shapes, using a name from the groups when one fits, else a short new name in the ' +
        'language of the comment; text, what the text should do, as an imperative in at most 15 words, with ' +
        'references such as "that part" resolved from the draft; reason, why the author wants it, in at most ' +
        '15 words, only from what the author said or clearly meant, an empty string if there is none; ' +
        'nuance, a qualifier in at most three words (for example "implicit" or "in passing") only when the ' +
        'author asks for one, else an empty string; quote, the words of the comment it comes from, copied ' +
        'exactly. Use the task only to understand and place what the author says, never to add a request ' +
        'the author did not make. If the comment contains no request, return nothing.',
      structurePrompt:
        'You turn the author\'s intents into the plan for the next version of their text. Intents are the ' +
        'building blocks of the text, and the author reads the plan to see what the version is built from. ' +
        'You receive the task, the groups of the text (its parts, in order) and the intents that are on ' +
        '(JSON, each with an id; new: true marks intents collected since the last version). Return the ' +
        'groups in the order they shape the text, and every intent with its group. Keep the architecture ' +
        'stable: keep existing groups, their names and their order; add a group only for a part of the text ' +
        'none covers, and leave out a group only when no intent is left in it. Bring the intents together: ' +
        'an intent that does not conflict with others stays as it is, with its id. Intents that pull the ' +
        'same aspect in different directions on a spectrum become one intent at the position the author\'s ' +
        'latest words point to, keeping what the earlier one still adds (a casual tone and then a ' +
        'professional one become "Use a professional but friendly tone"). An intent that changes how ' +
        'another point is made joins that point, at the level the point has in the text, and says the ' +
        'concrete move (making continuity a subtle point by bringing in their IT department becomes ' +
        '"Mention the IT department in passing", nuance "implicit", in the group of the main arguments). ' +
        'Intents that say the same thing become one. A merged intent keeps the id of one of them, lists the ' +
        'other ids in mergedFrom and keeps their reasons. Never drop what the author asked for unless a ' +
        'newer intent replaces it, and never add a request the author did not make. text: an imperative in ' +
        'at most 15 words; reason: the author\'s reason in at most 15 words, an empty string if there is ' +
        'none; nuance: a qualifier in at most three words only when needed, else an empty string. Use the ' +
        'language of the intents.',
      annotatePrompt:
        'You update one intent (a short change request for a draft, with the reason the author gave for ' +
        'it) according to a spoken annotation. The annotation was transcribed automatically and may ' +
        'contain recognition errors. Return text, the updated intent as an imperative in at most 12 words, ' +
        'in the language of the intent: if the annotation replaces the intent, the new one; if it adds a ' +
        'detail, merged. Return reason in at most 15 words: the current reason, updated or extended if the ' +
        'annotation gives a new or further reason; never a reason of your own, and an empty string if ' +
        'there is none.',
      composeInstruction:
        'Write the text from the starting draft below so that it follows every building block in the ' +
        'list. The building blocks are sorted by the part of the text they shape, and together they are ' +
        'everything the author wants from the text. A qualifier in brackets says how to carry a block out ' +
        '(for example "implicit": the point is made without being stated). Some blocks give the author\'s ' +
        'reason as "why": use it to decide how to carry the block out and what to emphasise. Where the building blocks say nothing, keep the starting draft as it ' +
        'is. The starting draft may contain placeholders in square brackets: fill one only when the ' +
        'building blocks give what it needs, otherwise keep it. Answer with the full text only, starting ' +
        'with its first line: do not introduce it, describe what you changed or add notes.',
      maxOutputTokens: 600, // for changing an intent by voice
      collectMaxOutputTokens: 1200, // for collecting the intents of a recording
      structureMaxOutputTokens: 2500, // for the plan of a version, which holds every intent
      // A second, identical intent request starts if the first has not answered after this many seconds;
      // the first answer is used. Cuts the rare very slow request (seen: 21 s instead of 2–3 s). 0 = off.
      hedgeAfterSeconds: 5,
    },
  },

  stt: {
    model: 'gpt-transcribe',
    languages: ['en'], // gpt-transcribe takes a list of expected languages
    prompt: '', // optional vocabulary hint for the transcription model
    timeoutSeconds: 30,
  },

  systemCheck: {
    testSentence: 'I would like to prepare a follow-up email for my customer.',
    maxRecordingSeconds: 15,
    retriesBeforeContact: 2, // after this many failed retries of a check, show the contact text
  },

  survey: {
    type: 'internal', // 'internal' (content/survey.<locale>.js) | 'external'
    // 'external' only. {participantId}, {round} and {taskId} are replaced.
    externalUrl: 'https://example.com/survey?pid={participantId}&round={round}&task={taskId}',
  },

  limits: {
    maxAudioUploadMB: 10,
    rateLimit: {
      windowSeconds: 60,
      transcribePerWindow: 20, // per session
      chatPerWindow: 15, // per session
      sessionStartPerWindow: 10, // per IP, limits ID guessing
    },
  },

  logging: {
    dir: 'logs',
    storeAudio: false, // true stores each uploaded recording next to the log
  },

  // Only used when DEV_MODE=true in .env. Ignored otherwise.
  dev: {
    participantId: 'DEV', // used by "Skip ID"; does not need to be in validIds
    mockByDefault: true, // dev sessions start with mock speech-to-text and LLM (no API cost)
    timerSpeeds: [1, 10, 60],
    mockLatencyMs: 600,
  },
};
