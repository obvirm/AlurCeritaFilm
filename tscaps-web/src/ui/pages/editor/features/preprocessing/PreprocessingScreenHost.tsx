import { useEffect, useMemo, useState } from 'react';
import { TranscribeProgressController } from '@presentation/transcription/controllers/TranscribeProgressController';
import { useTranscription } from '@ui/_shared/contexts/modules/TranscriptionContext';
import { usePreprocessing } from '@ui/_shared/contexts/modules/PreprocessingContext';
import type { Movie2ShortLogView } from '@core/preprocessing/store/Movie2ShortLogStore';
import { PreprocessingScreen } from '@ui/pages/editor/features/preprocessing/components/PreprocessingScreen';


/**
 * Mounts the preprocessing splash and feeds it a fresh progress
 * controller scoped to this mount. Surface-specific copy and the
 * slow-hint nudge are wired here so the screen itself stays
 * surface-agnostic. Also streams the Movie2Short backend log tail
 * into the splash console.
 */
export function PreprocessingScreenHost() {
  const { progressStore } = useTranscription();
  const { logStore } = usePreprocessing();
  const progressController = useMemo(
    () => new TranscribeProgressController(progressStore),
    [progressStore],
  );
  const [logView, setLogView] = useState<Movie2ShortLogView>(() => logStore.view);

  useEffect(() => {
    progressController.start();
    return () => progressController.stop();
  }, [progressController]);

  useEffect(() => {
    const update = () => setLogView(logStore.view);
    logStore.addEventListener('change', update);
    update();
    return () => logStore.removeEventListener('change', update);
  }, [logStore]);


  return (
    <main className="relative flex flex-col items-center justify-center h-dvh overflow-hidden px-3 py-2 lg:px-6 lg:py-4">
      <PreprocessingScreen
        controller={progressController}
        log={logView.lines}
      />
    </main>
  );
}

