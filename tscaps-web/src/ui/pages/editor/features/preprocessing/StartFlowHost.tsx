import { useEffect, useState } from 'react';
import type { EditorState } from '@core/editor/domain/EditorState';
import type { Template } from '@core/templates/domain/Template';
import type { EditorStore } from '@core/editor/store/EditorStore';
import type { PreprocessingFlowStore } from '@core/preprocessing/store/PreprocessingFlowStore';
import { useEditor } from '@ui/_shared/contexts/modules/EditorContext';
import { useTranscription } from '@ui/_shared/contexts/modules/TranscriptionContext';
import { usePreprocessing } from '@ui/_shared/contexts/modules/PreprocessingContext';
import { useTemplates } from '@ui/_shared/contexts/modules/TemplatesContext';
import { useUtils } from '@ui/_shared/contexts/modules/UtilsContext';
import { StartDialog } from '@ui/pages/editor/features/preprocessing/StartDialog';
import { MOVIE2SHORT_BACKEND_URL } from '@bootstrap/wiring/preprocessing';

interface StartFlowHostProps {
  onBack: () => void;
}


function useDialogOpen(flow: PreprocessingFlowStore): boolean {
  const [open, setOpen] = useState<boolean>(() => flow.dialogOpen);
  useEffect(() => {
    const update = () => setOpen(flow.dialogOpen);
    flow.addEventListener('change', update);
    update();
    return () => flow.removeEventListener('change', update);
  }, [flow]);
  return open;
}

function useEditorSnapshot(store: EditorStore): EditorState {
  const [state, setState] = useState(() => store.snapshot());
  useEffect(() => {
    const update = () => setState(store.snapshot());
    store.addEventListener('change', update);
    update();
    return () => store.removeEventListener('change', update);
  }, [store]);
  return state;
}

/**
 * Hosts the start-video dialog. Listens to the derived `dialogOpen`
 * flag and mounts the dialog only while it is true. Cancel composes
 * "clear the loaded video" with the navigation callback supplied by
 * the route so the user lands back where the flow started.
 */
interface TemplateOption {
  readonly id: string;
  readonly name: string;
}

interface DoneJobOption {
  readonly id: string;
  readonly label: string;
}

interface RunningJobInfo {
  readonly id: string;
  readonly stage: string | null;
}

function useRunningJob(): { job: RunningJobInfo | null; refresh: () => void } {
  const [job, setJob] = useState<RunningJobInfo | null>(null);
  const [tick, setTick] = useState<number>(0);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${MOVIE2SHORT_BACKEND_URL}/api/jobs`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.ok || !Array.isArray(json.jobs)) return;
        const running = json.jobs.find((j: { status?: string }) => j.status === 'running');
        setJob(running ? { id: running.id, stage: running.stage ?? null } : null);
      } catch {
        // Backend off — treated as no running job.
      }
    };
    void load();
    const iv = window.setInterval(load, 4000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [tick]);
  return { job, refresh };
}

function useQuotaWarning(): string | null {
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${MOVIE2SHORT_BACKEND_URL}/api/jobs`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.ok || !Array.isArray(json.jobs)) return;
        const failed = (json.jobs as Array<{ status?: string; error?: string; createdAt?: string }>)
          .filter((j) => j.status === 'error' && /429|kuota|quota|rate limit|rate_limit/i.test(j.error ?? ''))
          .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0];
        if (failed?.error) setWarning(failed.error);
      } catch {
        // Backend off — no warning.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return warning;
}

function useDoneJobs(): DoneJobOption[] {
  const [jobs, setJobs] = useState<DoneJobOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${MOVIE2SHORT_BACKEND_URL}/api/jobs`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.ok || !Array.isArray(json.jobs)) return;
        setJobs(
          json.jobs
            .filter((j: { status?: string; artifacts?: string[] }) =>
              j.status === 'done' && (j.artifacts ?? []).some((a) => a.endsWith('.srt')))
            .map((j: { id: string; createdAt?: string }) => ({
              id: j.id,
              label: `${new Date(j.createdAt ?? Date.now()).toLocaleString()} · ${j.id.slice(-6)}`,
            })),
        );
      } catch {
        // Backend off — the section simply doesn't render.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return jobs;
}

function useTemplateDefinitions(): Template[] {
  const templatesModule = useTemplates();
  const [templates, setTemplates] = useState<Template[]>([]);
  useEffect(() => {
    let cancelled = false;
    void templatesModule.repository.getAll().then((loaded) => {
      if (!cancelled) setTemplates(loaded);
    }).catch(() => {
      if (!cancelled) setTemplates([]);
    });
    return () => { cancelled = true; };
  }, [templatesModule]);
  return templates;
}

function useMovie2ShortTemplates(): TemplateOption[] {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${MOVIE2SHORT_BACKEND_URL}/api/templates`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.ok || !Array.isArray(json.templates)) return;
        setTemplates(
          json.templates.map((t: { id?: string; name?: string }) => ({
            id: t.id ?? '',
            name: t.name ?? t.id ?? '',
          })).filter((t: TemplateOption) => t.id.length > 0),
        );
      } catch {
        // Backend off — the dialog falls back to the loki template.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return templates;
}

/**
 * Hosts the start-video dialog. Listens to the derived `dialogOpen`
 * flag and mounts the dialog only while it is true. Cancel composes
 * "clear the loaded video" with the navigation callback supplied by
 * the route so the user lands back where the flow started.
 */
export function StartFlowHost({ onBack }: StartFlowHostProps) {
  const editor = useEditor();
  const transcription = useTranscription();
  const preprocessing = usePreprocessing();
  const { userAgentInspector } = useUtils();
  const open = useDialogOpen(preprocessing.flow);
  const state = useEditorSnapshot(editor.store);
  const templates = useMovie2ShortTemplates();
  const templateDefinitions = useTemplateDefinitions();
  const doneJobs = useDoneJobs();
  const runningJob = useRunningJob();
  const quotaWarning = useQuotaWarning();

  if (!open) return null;

  const handleCancel = () => {
    editor.actions.video.clear.execute();
    onBack();
  };


  return (
    <StartDialog
      open
      preference={state.transcribePreference}
      isMobileDevice={userAgentInspector.isMobile()}
      error={state.error}
      preprocessVideo={preprocessing.actions.preprocessVideo}
      updatePreference={transcription.actions.updatePreference}
      onCancel={handleCancel}
      videoFile={state.video.file}
      movie2short={preprocessing.actions.movie2short}
      templates={templates}
      templateDefinitions={templateDefinitions}
      doneJobs={doneJobs}
      runningJob={runningJob.job}
      quotaWarning={quotaWarning}
      onCancelRunningJob={() => {
        void preprocessing.actions.movie2short.cancelRunningJob().then(runningJob.refresh);
      }}
    />
  );
}

