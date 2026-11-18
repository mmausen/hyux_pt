// Toggle: click (or Enter/Space on the focused button) to start, click again to stop.
import { Recorder } from './Recorder.js';

export class ToggleRecorder extends Recorder {
  get mode() { return 'toggle'; }

  attach(button) {
    super.attach(button);
    const click = () => (this.recording || this._starting ? this.stop('user') : this.start());
    button.addEventListener('click', click);
    this._unbind = () => button.removeEventListener('click', click);
  }

  detach() {
    this._unbind?.();
    this._unbind = null;
    super.detach();
  }
}
