import { useEffect, useState, type ReactNode } from 'react';
import type { TranscriberOptions } from '@tscaps/engine';
import { AppDialog, AppDialogActions } from '@ui/_shared/components/Dialog/AppDialog';
import { AppErrorMessage, getAppErrorTitle } from '@ui/_shared/components/AppErrorMessage/AppErrorMessage';
import { BTN_PRIMARY_SM, BTN_SECONDARY_SM } from '@ui/_shared/styles/buttons';
import type { AppError } from '@core/_shared/domain/AppError';
import type { TranscribePreference } from '@core/transcription/domain/TranscribePreference';
import type { PreprocessVideoAction } from '@core/preprocessing/actions/PreprocessVideoAction';
import type { Movie2ShortAction, Movie2ShortOptions } from '@core/preprocessing/actions/Movie2ShortAction';
import type { UpdateTranscribePreferenceAction } from '@core/transcription/actions/UpdateTranscribePreferenceAction';
import { SelectField, type SelectFieldOption } from '@ui/pages/editor/features/preprocessing/components/SelectField';
import { AdvancedSection } from '@ui/pages/editor/features/preprocessing/components/AdvancedSection';

const LANGUAGES: readonly SelectFieldOption[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en',   label: 'English' },
  { value: 'es',   label: 'Spanish' },
  { value: 'pt',   label: 'Portuguese' },
  { value: 'fr',   label: 'French' },
  { value: 'de',   label: 'German' },
  { value: 'it',   label: 'Italian' },
  { value: 'nl',   label: 'Dutch' },
  { value: 'ru',   label: 'Russian' },
  { value: 'ja',   label: 'Japanese' },
  { value: 'zh',   label: 'Chinese' },
  { value: 'ko',   label: 'Korean' },
  { value: 'ar',   label: 'Arabic' },
  { value: 'hi',   label: 'Hindi' },
];

const MODELS: readonly SelectFieldOption[] = [
  { value: 'gemini/gemini-3.6-flash', label: 'Gemini 3.6 Flash (cloud)' },
  { value: 'llava:7b', label: 'Llava 7b (lokal)' },
];

const DEFAULT_DESCRIPTION = 'Pick a language. Transcription runs in your browser.';
const MOVIE2SHORT_DESCRIPTION =
  'Analisis → narasi → TTS → render → caption. Hasilnya jadi draft yang bisa diedit.';

type Mode = 'movie2short' | 'local';

interface StartDialogProps {
  readonly open: boolean;
  readonly preference: TranscribePreference;
  readonly isMobileDevice: boolean;
  readonly error: AppError | null;
  readonly preprocessVideo: PreprocessVideoAction;
  readonly updatePreference: UpdateTranscribePreferenceAction;
  readonly onCancel: () => void;
  readonly description?: string;
  readonly extraFields?: ReactNode;
  readonly extraNotices?: ReactNode;
  readonly renderActions?: (start: () => void) => ReactNode;
  /** Backend/model picker is only meaningful when the transcriber runs in the browser. */
  readonly showAdvanced?: boolean;
  /** Movie2Short pipeline — when provided the dialog offers the pipeline mode first. */
  readonly movie2short?: Movie2ShortAction;
  readonly templates?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Completed backend jobs with caption output — lets the user turn an existing run into a draft. */
  readonly doneJobs?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  /** A job currently running on the backend (blocks new Generate runs). */
  readonly runningJob?: { readonly id: string; readonly stage: string | null } | null;
  readonly onCancelRunningJob?: () => void;
  /** Set when the most recent run failed with a Gemini quota (429) error. */
  readonly quotaWarning?: string | null;
}

/**
 * Shared "Start your video" dialog. Defaults to the Movie2Short
 * pipeline (server-side analysis -> narration -> TTS -> render ->
 * caption, result lands as an editable draft); the local browser
 * transcription mode remains available as a fallback. The optional
 * slots let callers extend the form with extra fields, notices, or a
 * custom action row.
 */
export function StartDialog({
  open,
  preference,
  isMobileDevice,
  error,
  preprocessVideo,
  updatePreference,
  onCancel,
  description,
  extraFields,
  extraNotices,
  renderActions,
  showAdvanced = true,
  movie2short,
  templates,
  doneJobs,
  runningJob,
  onCancelRunningJob,
  quotaWarning,
}: StartDialogProps) {
  const [mode, setMode] = useState<Mode>('movie2short');
  const [language, setLanguage] = useState<string>('auto');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Movie2Short settings
  const [model, setModel] = useState<string>('gemini/gemini-3.6-flash');
  const [template, setTemplate] = useState<string>('loki');
  const [stretch, setStretch] = useState<number>(0);
  const [hzoom, setHzoom] = useState<number>(1);
  const [cameraPlan, setCameraPlan] = useState<boolean>(false);
  const [lead, setLead] = useState<number>(5);
  const [tail, setTail] = useState<number>(5);
  const [restoreJobId, setRestoreJobId] = useState<string>('');

  useEffect(() => {
    if (doneJobs && doneJobs.length > 0 && !doneJobs.some((j) => j.id === restoreJobId)) {
      setRestoreJobId(doneJobs[0]!.id);
    }
  }, [doneJobs, restoreJobId]);

  const templateOptions: readonly SelectFieldOption[] = (templates && templates.length > 0
    ? templates
    : [{ id: 'loki', name: 'Loki (default)' }]
  ).map((t) => ({ value: t.id, label: t.name }));

  const handleStart = () => {
    const transcriber: TranscriberOptions = language === 'auto' ? {} : { language };
    void preprocessVideo.execute({ transcriber, multipleSpeakers: false });
  };

  const handleGenerateShort = () => {
    if (!movie2short) return;
    const opts: Movie2ShortOptions = { model, template, stretch, hzoom, cameraPlan, lead, tail };
    void movie2short.execute(opts);
  };

  const isM2S = mode === 'movie2short' && movie2short !== undefined;

  return (
    <AppDialog
      open={open}
      onClose={onCancel}
      closeOnOutsideClick={false}
      size="md"
      title="Start your video"
      description={description ?? (isM2S ? MOVIE2SHORT_DESCRIPTION : DEFAULT_DESCRIPTION)}
    >
      {movie2short && (
        <div className="flex rounded-xs border border-fg-muted/30 overflow-hidden w-full mb-3">
          <button
            type="button"
            className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'movie2short'
                ? 'bg-surface-3 text-accent shadow-inset-edge'
                : 'bg-surface-2 text-fg-secondary hover:bg-surface-3 hover:text-fg-primary'
            }`}
            onClick={() => setMode('movie2short')}
          >
            Movie2Short
          </button>
          <button
            type="button"
            className={`flex-1 px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'local'
                ? 'bg-surface-3 text-accent shadow-inset-edge'
                : 'bg-surface-2 text-fg-secondary hover:bg-surface-3 hover:text-fg-primary'
            }`}
            onClick={() => setMode('local')}
          >
            Transkripsi lokal
          </button>
        </div>
      )}

      {isM2S ? (
        <div className="space-y-3">
          <SelectField
            id="m2s-model"
            label="Model analisis"
            value={model}
            options={MODELS}
            onChange={setModel}
          />
          <SelectField
            id="m2s-template"
            label="Template caption"
            value={template}
            options={templateOptions}
            onChange={setTemplate}
          />
          <label className="block">
            <span className="text-sm text-fg-secondary">
              Stretch (lonjong) — {stretch.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={stretch}
              onChange={(e) => setStretch(Number(e.target.value))}
              className="w-full accent-accent mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm text-fg-secondary">
              H-Zoom — {hzoom.toFixed(2)}
            </span>
            <input
              type="range"
              min={1}
              max={1.6}
              step={0.01}
              value={hzoom}
              onChange={(e) => setHzoom(Number(e.target.value))}
              className="w-full accent-accent mt-1"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            <input
              type="checkbox"
              checked={cameraPlan}
              onChange={(e) => setCameraPlan(e.target.checked)}
              className="accent-accent size-4"
            />
            Camera plan (director)
          </label>
          <label className="block">
            <span className="text-sm text-fg-secondary">
              Jeda awal TTS (lead) — {lead.toFixed(1)}s (diam sebelum kalimat)
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={lead}
              onChange={(e) => setLead(Number(e.target.value))}
              className="w-full accent-accent mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm text-fg-secondary">
              Jeda akhir TTS (tail) — {tail.toFixed(1)}s (diam setelah kalimat)
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
              className="w-full accent-accent mt-1"
            />
          </label>

          {doneJobs && doneJobs.length > 0 && (
            <div className="border-t border-edge-medium pt-3 mt-1 space-y-2">
              <span className="text-sm text-fg-secondary block">
                Ambil hasil dari job yang sudah selesai
              </span>
              <div className="flex gap-2 items-center">
                <select
                  value={restoreJobId}
                  onChange={(e) => setRestoreJobId(e.target.value)}
                  className="flex-1 min-w-0 rounded-xs border border-edge-medium bg-surface-2 px-2 py-1.5 text-sm text-fg-primary focus:outline-none"
                >
                  {doneJobs.map((j) => (
                    <option key={j.id} value={j.id}>{j.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={BTN_SECONDARY_SM}
                  onClick={() => {
                    if (restoreJobId && movie2short) void movie2short.restoreFromJob(restoreJobId);
                  }}
                >
                  Ambil
                </button>
              </div>
            </div>
          )}

          {quotaWarning && (
            <div
              role="alert"
              className="text-sm text-warning bg-warning/10 border border-warning/40 rounded-xs px-3 py-2 space-y-1"
            >
              <p className="m-0 font-semibold">
                Run terakhir gagal: kuota Gemini habis (429)
              </p>
              <p className="m-0 text-xs text-fg-secondary">
                Pilih <b>Llava 7b (lokal)</b> di Model analisis untuk lanjut tanpa kuota, atau tunggu reset kuota Gemini.
              </p>
            </div>
          )}

          {runningJob && onCancelRunningJob && (
            <div
              role="alert"
              className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-xs px-3 py-2 space-y-2"
            >
              <p className="m-0 font-semibold">
                Job lain sedang berjalan{runningJob.stage ? ` (tahap: ${runningJob.stage})` : ''}
              </p>
              <p className="m-0 text-xs text-fg-secondary">
                Generate baru akan ditolak sampai job selesai. Batalkan dulu kalau mau mulai baru.
              </p>
              <button type="button" className={BTN_SECONDARY_SM} onClick={onCancelRunningJob}>
                Batalkan job yang berjalan
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <SelectField
            id="td-language"
            label="Language"
            value={language}
            options={LANGUAGES}
            onChange={setLanguage}
          />

          {extraFields}

          {showAdvanced && (
            <AdvancedSection
              open={advancedOpen}
              onToggle={() => setAdvancedOpen((v) => !v)}
              preference={preference}
              onPreferenceChange={(pref) => updatePreference.execute(pref)}
            />
          )}
        </>
      )}

      {isMobileDevice && (
        <p className="text-2xs text-fg-faint m-0 leading-snug">
          In-browser transcription runs on your device — on mobile it can be slow or fail.
        </p>
      )}

      {extraNotices}

      {error && (
        <div
          role="alert"
          className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-xs px-3 py-2 space-y-1"
        >
          <p className="font-semibold m-0">{getAppErrorTitle(error)}</p>
          <div className="text-fg-secondary">
            <AppErrorMessage error={error} isMobile={isMobileDevice} />
          </div>
        </div>
      )}

      <AppDialogActions>
        {renderActions
          ? renderActions(isM2S ? handleGenerateShort : handleStart)
          : (
            <>
              <button type="button" className={BTN_SECONDARY_SM} onClick={onCancel}>Cancel</button>
              <button
                type="button"
                className={BTN_PRIMARY_SM}
                onClick={isM2S ? handleGenerateShort : handleStart}
                autoFocus
              >
                {isM2S ? 'Generate Short' : 'Start'}
              </button>
            </>
          )}
      </AppDialogActions>
    </AppDialog>
  );
}
