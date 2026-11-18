// Tutorial steps for the intents mode. The tour runs over the sample canvas after a first draft, so the
// intent cards are visible. Texts: tutorial.intents.<key> in the strings file.
export default function tutorialSteps({ recordingMode }) {
  return [
    { region: 'task', key: 'task' },
    { region: 'record', key: recordingMode === 'pushToTalk' ? 'recordPushToTalk' : 'recordToggle' },
    { region: 'output', key: 'output' },
    { region: 'intents', key: 'intents' },
    { region: 'intentCard', key: recordingMode === 'pushToTalk' ? 'cardPushToTalk' : 'cardToggle' },
    { region: 'send', key: 'send' },
    { region: 'timer', key: 'timer' },
    { region: 'finish', key: 'finish' },
  ].map((s) => ({ ...s, titleKey: `tutorial.intents.${s.key}.title`, textKey: `tutorial.intents.${s.key}.text` }));
}
