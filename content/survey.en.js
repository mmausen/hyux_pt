// Placeholder questionnaire shown after each task (survey.type = 'internal').
// Question types: 'scale' (min..max with labels), 'choice' (single choice), 'text' (free text).
export default {
  title: 'Questions About This Task',
  intro: 'Answer a few short questions about the task you just finished.',
  questions: [
    {
      id: 'satisfaction',
      type: 'scale',
      text: 'How satisfied are you with the result?',
      min: 1, max: 7, minLabel: 'Not satisfied', maxLabel: 'Very satisfied',
      required: true,
    },
    {
      id: 'effort',
      type: 'scale',
      text: 'How much effort did it take to get the assistant to do what you wanted?',
      min: 1, max: 7, minLabel: 'Very little', maxLabel: 'A lot',
      required: true,
    },
    {
      id: 'use_result',
      type: 'choice',
      text: 'Would you send the result to the recipient as it is?',
      options: ['Yes, as it is', 'Yes, after small edits', 'Only after major edits', 'No'],
      required: true,
    },
    {
      id: 'comment',
      type: 'text',
      text: 'Is there anything else you want to tell us about this task?',
      required: false,
    },
  ],
};
