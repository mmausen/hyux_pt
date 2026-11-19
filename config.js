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
    //   'customer': the task starts from its starting draft; the AI plays the reader (a persona of the task)
    //               and reacts to passages of the draft; the participant responds by voice and sends the
    //               changes, which gives the next version.
    mode: 'customer',
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
    // are separate calls. The model never sees the task here either.
    intents: {
      extractPrompt:
        'You turn a spoken comment about a draft into intents: short, self-contained change requests for ' +
        'the draft, each with the reason the speaker gave for it. The comment was transcribed ' +
        'automatically and may contain recognition errors. Split the comment into one intent per distinct ' +
        'request; most comments contain one or two. For each intent return: text, the request as an ' +
        'imperative in at most 12 words, in the language of the comment (for example "Mention the six-week ' +
        'rollout"), resolving references such as "that part" using the draft; reason, why the speaker ' +
        'wants it, in at most 15 words and in their terms (for example "The CFO cares about the cost of ' +
        'turnover"), taken only from what they said or clearly meant, never a reason of your own, and an ' +
        'empty string if they gave none; quote, the words of the comment the intent comes from, copied ' +
        'exactly. Leave out filler. If the comment contains no request, return no intents.',
      annotatePrompt:
        'You update one intent (a short change request for a draft, with the reason the author gave for ' +
        'it) according to a spoken annotation. The annotation was transcribed automatically and may ' +
        'contain recognition errors. Return text, the updated intent as an imperative in at most 12 words, ' +
        'in the language of the intent: if the annotation replaces the intent, the new one; if it adds a ' +
        'detail, merged. Return reason in at most 15 words: the current reason, updated or extended if the ' +
        'annotation gives a new or further reason; never a reason of your own, and an empty string if ' +
        'there is none.',
      reviseInstruction:
        'Revise the current draft below so that it follows every intent in the list. Some intents give ' +
        'the author\'s reason in brackets: use it to decide how to carry the intent out and what to ' +
        'emphasise, since it shows what the author has in mind. Keep everything the intents do not ask to ' +
        'change. The draft may contain placeholders in square brackets: fill one only when the intents ' +
        'give what it needs, otherwise keep it as it is. Answer with the full revised draft only, starting ' +
        'with its first line: do not introduce it, describe what you changed or add notes.',
      maxOutputTokens: 600, // for extracting and annotating intents
      // A second, identical intent request starts if the first has not answered after this many seconds;
      // the first answer is used. Cuts the rare very slow request (seen: 21 s instead of 2–3 s). 0 = off.
      hedgeAfterSeconds: 5,
    },
    // Prompts of the 'customer' mode. The AI plays the reader of the draft (a persona of the task, see
    // `personas` in data/tasks.json) and only reacts; the participant decides what to change. The persona
    // is the one thing about the task the model sees here.
    customer: {
      reactPrompt:
        'You play the reader of a draft that was written to you. Who you are is described below. Read the ' +
        'draft as this person would and react to it the way they would while reading: in the first person, ' +
        'honestly and briefly, in your own voice (for example "This feels pushy." or "You lost me at the ' +
        'pricing part."). Give 2 to 5 reactions to the passages that matter most to you, what works for you ' +
        'as well as what does not. Only say how the text lands with you: what you feel, doubt, miss, wonder ' +
        'about or like. Never suggest wording, changes or solutions, never say what the writer should do, ' +
        'add or write, and never rewrite anything. Do not react to placeholders in square brackets. For ' +
        'each reaction return: quote, the passage it is about, copied exactly from the draft, character for ' +
        'character, from a few words up to one sentence; text, your reaction in at most 15 words; tone, ' +
        '"positive", "neutral" or "negative". Order the reactions as their passages appear in the draft.',
      reviseInstruction:
        'Revise the current draft below. Its reader read it and reacted to passages of it (quoted). The ' +
        'author has responded to some reactions and may have given general instructions. The author ' +
        'decides: carry out the author\'s responses and general instructions. Where a reaction has no ' +
        'response, change the passage so that this reaction would no longer arise; a positive reaction with ' +
        'no response marks something that works, so keep it. Keep everything that nothing here asks to ' +
        'change. The draft may contain placeholders in square brackets: fill one only when the author gives ' +
        'what it needs, otherwise keep it as it is. Answer with the full revised draft only, starting with ' +
        'its first line: do not introduce it, describe what you changed or add notes.',
      // Used for a task without personas: one generic busy decision-maker.
      defaultPersona: {
        id: 'decision-maker',
        name: 'Decision-Maker',
        role: 'Busy decision-maker',
        about: 'Senior, short on time, reads many vendor letters a week.',
        profile:
          'You are a senior decision-maker at the customer. You get many letters from vendors every week and ' +
          'give each one a minute. You want to know quickly what is in it for your organisation, what it ' +
          'costs and what you are asked to do. Vague claims, filler and sales talk lose you.',
      },
      maxReactions: 5,
      maxOutputTokens: 800,
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
