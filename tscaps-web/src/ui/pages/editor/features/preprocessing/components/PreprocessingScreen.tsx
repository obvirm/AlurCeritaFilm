import { useEffect, useRef, useState } from 'react';
import type {
  TranscribeProgressController,
  TranscribeProgressView,
} from '@presentation/transcription/controllers/TranscribeProgressController';
import type { Movie2ShortLogLine } from '@core/preprocessing/store/Movie2ShortLogStore';
import { Wordmark } from '@ui/_shared/components/Wordmark/Wordmark';

export interface Copy {
  readonly primary: string;
  readonly helper: string;
}

export type CopyResolver = (view: TranscribeProgressView) => Copy;

interface PreprocessingScreenProps {
  readonly controller: TranscribeProgressController;
  readonly selectCopy?: CopyResolver;
  /** Live log tail from the Movie2Short backend job (rendered as a console). */
  readonly log?: readonly Movie2ShortLogLine[];
}

const defaultSelectCopy: CopyResolver = (view) => {
  if (view.phase === 'model-download') {
    return {
      primary: 'Downloading the model.',
      helper: 'First run only — the model is cached after this.',
    };
  }
  if (view.phase === 'audio-extract') {
    return {
      primary: 'Extracting audio.',
      helper: 'Keep this tab open until it finishes.',
    };
  }
  return {
    primary: 'Processing your video.',
    helper: 'Keep this tab open until it finishes.',
  };
};

function useProgressView(controller: TranscribeProgressController): TranscribeProgressView {
  const [view, setView] = useState<TranscribeProgressView>(() => controller.view);
  useEffect(() => {
    const update = () => setView(controller.view);
    controller.addEventListener('change', update);
    update();
    return () => controller.removeEventListener('change', update);
  }, [controller]);
  return view;
}

/**
 * Splash shown while the preprocessing pipeline runs. Owns the full
 * viewport until the surrounding shell flips off the `preprocessing`
 * branch. The optional copy resolver lets the host override the
 * primary/helper strings when the pipeline has surface-specific stages
 * that warrant their own message.
 */
export function PreprocessingScreen({
  controller,
  selectCopy = defaultSelectCopy,
  log,
}: PreprocessingScreenProps) {
  const view = useProgressView(controller);
  const pct = Math.max(0, Math.min(100, Math.round(view.percent * 100)));
  const { primary, helper } = selectCopy(view);
  // Stage label (Movie2Short pipeline) overrides the generic copy.
  const stageCopy = view.detail ?? null;
  const logRef = useRef<HTMLPreElement | null>(null);

  // Keep the console pinned to the newest lines.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log?.length]);

  return (
    <div className="flex flex-col items-center justify-center gap-10 flex-1 w-full">
      <Wordmark size="lg" working />

      <div className="flex flex-col items-center gap-4 w-full max-w-md">
        <span className="font-mono text-4xl text-fg-primary tabular-nums">{pct}%</span>
        <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden">
          {/* `transform: scaleX` avoids layout/paint on each tick — composite-only. */}
          <div
            className="h-full w-full bg-accent origin-left transition-transform duration-base ease-emphasized"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 text-center max-w-md">
        <p className="text-base text-fg-primary m-0">{stageCopy ?? primary}</p>
        {stageCopy === null && <p className="text-sm text-fg-muted m-0">{helper}</p>}
      </div>

      {log && log.length > 0 && (
        <div className="w-full max-w-xl flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-fg-faint m-0">Pipeline log</span>
          <pre
            ref={logRef}
            className="h-40 overflow-y-auto rounded-xs border border-edge-medium bg-surface-2 p-2.5 m-0 text-[11px] leading-relaxed font-mono"
          >
            {log.map((l, i) => (
              <div
                key={i}
                className={l.level === 'err' ? 'text-danger' : 'text-fg-muted'}
              >
                {l.text}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
