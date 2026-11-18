// Appends events as JSON lines to logs/<participantId>.jsonl. Writes per file are queued so lines never interleave.
import { mkdirSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const safe = (s) => String(s ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

export function createJsonlLogger({ dir }) {
  mkdirSync(dir, { recursive: true });
  const queues = new Map();

  function enqueue(file, fn) {
    const next = (queues.get(file) ?? Promise.resolve()).then(fn)
      .catch((e) => console.error(`Logger could not write ${file}: ${e.message}`));
    queues.set(file, next);
    return next;
  }

  return {
    write(event) {
      const file = path.join(dir, `${safe(event.participantId)}.jsonl`);
      return enqueue(file, () => appendFile(file, `${JSON.stringify(event)}\n`));
    },
    storeAudio({ participantId, sessionId, buffer, ext }) {
      const audioDir = path.join(dir, 'audio', safe(participantId));
      mkdirSync(audioDir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe(sessionId).slice(0, 8)}.${safe(ext)}`;
      return writeFile(path.join(audioDir, name), buffer).then(() => name);
    },
  };
}
