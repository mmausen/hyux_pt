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
    // are separate calls. Intents are the building blocks of the text: each recording is brought together
    // with the current intents (and the task) into an updated, small set, sorted into topics; a send
    // writes the text anew from the starting draft and the active intents. The task reaches only the
    // synthesis call, never the call that writes the text.
    intents: {
      // Topics the intents are sorted into, in this order. key: stored with the intent (the UI label is
      // intents.topicLabels.<key> in the strings file); label and about: what the model reads. The model
      // may add a topic of its own only when the participant clearly names another aspect.
      topics: [
        { key: 'structure', label: 'Structure', about: 'order, length, sections, opening and closing' },
        { key: 'tone', label: 'Tone', about: 'voice, formality, warmth, confidence and wording' },
        { key: 'mainArguments', label: 'Main arguments', about: 'the central points and claims the text makes' },
        { key: 'secondaryArguments', label: 'Secondary arguments', about: 'supporting points, examples and evidence' },
        { key: 'details', label: 'Details', about: 'facts, figures, names, dates and the call to action' },
      ],
      maxPerTopic: 3, // "a few main points": the synthesis merges intents to stay within these
      maxIntents: 12,
      synthesizePrompt:
        'You keep the author\'s intents for a text they write with an assistant. Intents are the building ' +
        'blocks of the text: each one says what the text should do or contain, in the author\'s terms, with ' +
        'the author\'s reason. You receive the task the author works on, the topics intents are sorted into, ' +
        'the current draft, the current intents (JSON, each with an id) and a new spoken comment by the ' +
        'author. The comment was transcribed automatically and may contain recognition errors. Return the ' +
        'complete updated set of intents. Bring the comment together with the current intents: a request ' +
        'that refines, extends or corrects a current intent updates it and keeps its id; intents that ' +
        'overlap are merged into one, which keeps the id of one of them and lists the ids of the others in ' +
        'mergedFrom; a new request becomes a new intent with an empty id; intents the comment does not ' +
        'touch are returned unchanged with their id. If the author takes a request back, update the intent, ' +
        'or list its id in removed when nothing of it is left. Keep the set small: at most {maxPerTopic} ' +
        'intents per topic and {maxIntents} in all, so prefer one broader intent to several narrow ones on ' +
        'the same point. Sort each intent into the topic it shapes in the text, using a topic key; use a ' +
        'name of your own in at most three words only when the author clearly names another aspect. text: ' +
        'what the text should do, as an imperative in at most 15 words, in the language of the comment, ' +
        'with references such as "that part" resolved from the draft. reason: why the author wants it, in ' +
        'at most 15 words, only from what the author said or clearly meant and never a reason of your own; ' +
        'merged intents keep their reasons; an empty string if there is none. quote: the words of the new ' +
        'comment this intent comes from, copied exactly; an empty string for intents the comment does not ' +
        'touch. Use the task only to understand, word and sort what the author asks for, never to add a ' +
        'request the author did not make. If the comment contains no request, return the current intents ' +
        'unchanged.',
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
        'list. The building blocks are sorted by topic, and together they are everything the author wants ' +
        'from the text. Some give the author\'s reason in brackets: use it to decide how to carry the block ' +
        'out and what to emphasise. Where the building blocks say nothing, keep the starting draft as it ' +
        'is. The starting draft may contain placeholders in square brackets: fill one only when the ' +
        'building blocks give what it needs, otherwise keep it. Answer with the full text only, starting ' +
        'with its first line: do not introduce it, describe what you changed or add notes.',
      maxOutputTokens: 600, // for annotating an intent
      synthesizeMaxOutputTokens: 2000, // for the synthesis, which returns the whole set
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
