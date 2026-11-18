// Push-to-talk: record while the button (or the Space key) is held down.
import { Recorder } from './Recorder.js';

// Space starts recording unless focus is in a text field or on another control that uses Space.
function spaceIsFree(target, button) {
  if (target === button || target === document.body || target?.id === 'screen') return true;
  if (!(target instanceof Element)) return true;
  if (target.closest('input, textarea, select, [contenteditable="true"], .dev-panel')) return false;
  if (target.closest('button, a, [role="button"], [role="switch"], [role="checkbox"], [role="dialog"]')) return false;
  return true;
}

export class PushToTalkRecorder extends Recorder {
  get mode() { return 'pushToTalk'; }

  attach(button) {
    super.attach(button);
    const down = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      button.setPointerCapture?.(e.pointerId);
      this.start();
    };
    const up = () => this.stop('release');
    const keydown = (e) => {
      if (e.code !== 'Space' || e.repeat || !this.button || !spaceIsFree(e.target, button)) return;
      if (button.disabled || !this.enabled) return;
      e.preventDefault();
      this.start();
    };
    const keyup = (e) => {
      if (e.code !== 'Space') return;
      if (this.recording || this._starting) { e.preventDefault(); this.stop('release'); }
    };
    // Space on the focused button would also fire a click; swallow it.
    const click = (e) => e.preventDefault();
    const blur = () => this.stop('release'); // window lost focus while holding

    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('click', click);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    this._unbind = () => {
      button.removeEventListener('pointerdown', down);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', up);
      button.removeEventListener('click', click);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }

  detach() {
    this._unbind?.();
    this._unbind = null;
    super.detach();
  }
}
