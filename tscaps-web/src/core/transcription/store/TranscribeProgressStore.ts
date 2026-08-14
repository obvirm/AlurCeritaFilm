import type { TranscribePhase, TranscribeStatus } from '@core/transcription/domain/TranscribeStatus';

/**
 * Observable container for the raw progress of an in-flight transcription.
 *
 * Holds facts only — `active`, `initialPhase`, current `phase`, and the raw
 * `rawProgress` of that phase in `[0, 1]`. No timing curves, no smoothing.
 * Visual smoothing for the user-facing progress bar lives downstream;
 * this store is independent of the editor store so per-tick writes do
 * not invalidate the editor snapshot.
 *
 * Subscribers listen for the `'change'` event and read `status`.
 */
export class TranscribeProgressStore extends EventTarget {
  private static readonly IDLE: TranscribeStatus = {
    active: false,
    initialPhase: null,
    phase: null,
    rawProgress: 0,
    detail: null,
  };

  private _status: TranscribeStatus = TranscribeProgressStore.IDLE;

  get status(): TranscribeStatus {
    return this._status;
  }

  /** Marks the start of a run. `initialPhase` is the first phase the transcriber will enter. */
  start(initialPhase: TranscribePhase): void {
    this.publish({ active: true, initialPhase, phase: initialPhase, rawProgress: 0, detail: null });
  }

  setModelDownloadProgress(progress: number): void {
    if (!this._status.active) return;
    this.publish({ phase: 'model-download', rawProgress: this.clamp01(progress) });
  }

  setAudioExtractProgress(progress: number): void {
    if (!this._status.active) return;
    this.publish({ phase: 'audio-extract', rawProgress: this.clamp01(progress) });
  }

  enterInferringPhase(): void {
    if (!this._status.active) return;
    if (this._status.phase === 'inferring') return;
    this.publish({ phase: 'inferring', rawProgress: 0 });
  }

  /**
   * Drives the inferring phase progress directly. Used by the
   * Movie2Short pipeline (server-side analysis/TTS/render) which has
   * no whisper-style phase callbacks. `detail` optionally sets a
   * human-readable stage label shown by the preprocessing splash.
   */
  setInferringProgress(progress: number, detail?: string | null): void {
    if (!this._status.active) return;
    this.publish({
      phase: 'inferring',
      rawProgress: this.clamp01(progress),
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  markComplete(): void {
    if (!this._status.active) return;
    this.publish({ phase: 'complete', rawProgress: 1, detail: null });
  }

  cancel(): void {
    if (!this._status.active) return;
    this.publish(TranscribeProgressStore.IDLE);
  }

  private publish(patch: Partial<TranscribeStatus>): void {
    this._status = { ...this._status, ...patch };
    this.dispatchEvent(new Event('change'));
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
