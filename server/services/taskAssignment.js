// Decides which task a participant gets in each round.
import { randomInt } from 'node:crypto';
import { normalizeId } from './sessions.js';

export function assignTasks(participantId, config) {
  const { mode, order, perParticipant = {} } = config.flow.taskSelection;
  const n = config.flow.rounds;
  if (mode === 'perParticipant') {
    const pid = normalizeId(participantId);
    const entry = Object.entries(perParticipant).find(([k]) => normalizeId(k) === pid);
    return (entry ? entry[1] : order).slice(0, n);
  }
  if (mode === 'random') {
    const list = [...order];
    for (let i = list.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list.slice(0, n);
  }
  return order.slice(0, n);
}
