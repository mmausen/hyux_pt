import { PushToTalkRecorder } from './pushToTalk.js';
import { ToggleRecorder } from './toggle.js';

export { getMicStream, releaseMic, MicError, micLabel } from './micStream.js';
export { createLevelMeter, SPEECH_LEVEL } from './levelMeter.js';

const MODES = { pushToTalk: PushToTalkRecorder, toggle: ToggleRecorder };

export function createRecorder(mode, options) {
  const Impl = MODES[mode];
  if (!Impl) throw new Error(`Unknown recording mode: ${mode}`);
  return new Impl(options);
}
