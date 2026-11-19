// Tutorial steps for the customer mode. The tour runs over the sample canvas with a draft that the customer
// has already reacted to, so the highlighted passages and the reaction cards are visible.
// Texts: tutorial.customer.<key> in the strings file.
export default function tutorialSteps({ recordingMode }) {
  const ptt = recordingMode === 'pushToTalk';
  return [
    { region: 'task', key: 'task' },
    { region: 'output', key: 'output' },
    { region: 'persona', key: 'persona' },
    { region: 'ask', key: 'ask' },
    { region: 'reactions', key: 'reactions' },
    { region: 'reactionCard', key: ptt ? 'cardPushToTalk' : 'cardToggle' },
    { region: 'record', key: ptt ? 'recordPushToTalk' : 'recordToggle' },
    { region: 'send', key: 'send' },
    { region: 'timer', key: 'timer' },
    { region: 'finish', key: 'finish' },
  ].map((s) => ({ ...s, titleKey: `tutorial.customer.${s.key}.title`, textKey: `tutorial.customer.${s.key}.text` }));
}
