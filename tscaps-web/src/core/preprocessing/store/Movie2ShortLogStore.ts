export interface Movie2ShortLogLine {
  readonly text: string;
  readonly level: string;
}

export interface Movie2ShortLogView {
  readonly jobId: string | null;
  readonly lines: readonly Movie2ShortLogLine[];
}

/**
 * Holds the tail of the Movie2Short backend job log for the splash
 * screen console. The pipeline action pushes freshly polled lines
 * here; the preprocessing screen subscribes and renders them.
 */
export class Movie2ShortLogStore extends EventTarget {
  private _view: Movie2ShortLogView = { jobId: null, lines: [] };

  get view(): Movie2ShortLogView {
    return this._view;
  }

  start(jobId: string): void {
    this._view = { jobId, lines: [] };
    this.dispatchEvent(new Event('change'));
  }

  setLines(lines: readonly Movie2ShortLogLine[]): void {
    this._view = { ...this._view, lines };
    this.dispatchEvent(new Event('change'));
  }

  clear(): void {
    this._view = { jobId: null, lines: [] };
    this.dispatchEvent(new Event('change'));
  }
}
