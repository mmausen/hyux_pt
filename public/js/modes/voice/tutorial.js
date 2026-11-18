// Tutorial steps for the voice mode. Each step highlights one canvas region (see canvas.getRegion) and
// points to its text in the strings file (tutorial.voice.<key>). Another interaction mode ships its own
// list, so switching interaction.mode switches the tutorial too.
export default function tutorialSteps({ recordingMode }) {
  return [
    { region: 'task', key: 'task' },
    { region: 'record', key: recordingMode === 'pushToTalk' ? 'recordPushToTalk' : 'recordToggle' },
    { region: 'transcript', key: 'transcript' },
    { region: 'send', key: 'send' },
    { region: 'output', key: 'output' },
    { region: 'timer', key: 'timer' },
    { region: 'finish', key: 'finish' },
  ].map((s) => ({ ...s, titleKey: `tutorial.voice.${s.key}.title`, textKey: `tutorial.voice.${s.key}.text` }));
}
