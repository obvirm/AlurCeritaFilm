import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TranscriberOptions } from '@tscaps/engine';
import type { Template } from '@core/templates/domain/Template';
import { TemplatePreviewStatic } from '@ui/pages/editor/components/template/TemplatePreviewStatic';
import { TemplatePreviewArtifactsBuilder } from '@presentation/editor/services/TemplatePreviewArtifactsBuilder';
import { AlignmentCssBuilder } from '@presentation/editor/services/AlignmentCssBuilder';
import { Sheet } from '@core/sheets/domain/Sheet';
import type { AlignmentConfig } from '@tscaps/engine';
import { useEngine } from '@ui/_shared/contexts/modules/EngineContext';
import { useRendering } from '@ui/_shared/contexts/modules/RenderingContext';
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

// Matches LocalFileTemplateLoader's fallback when a template declares no
// alignment block (vertical anchor 75% down, horizontally centered).
const ALIGNMENT_FALLBACK: AlignmentConfig = {
  verticalAlign: 'top',
  verticalOffset: 0.75,
  horizontalAlign: 'center',
  horizontalOffset: 0.5,
};
const alignmentCssBuilder = new AlignmentCssBuilder();

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
  { value: 'r9/ag/gemini-3.6-flash-high', label: '9Router ag/gemini-3.6-flash-high' },
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
  /** Input video shown beside the Movie2Short settings as a live visual reference. */
  readonly videoFile?: File | null;
  readonly templateDefinitions?: ReadonlyArray<Template>;
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
  videoFile = null,
  templateDefinitions = [],
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
  const [outputMode, setOutputMode] = useState<'one' | 'auto' | 'manual'>('one');
  const [chunk, setChunk] = useState<boolean>(true);
  const [parts, setParts] = useState<number>(3);
  const [stretch, setStretch] = useState<number>(0);
  const [hzoom, setHzoom] = useState<number>(1);
  const [cameraPlan, setCameraPlan] = useState<boolean>(false);
  const [lead, setLead] = useState<number>(5);
  const [tail, setTail] = useState<number>(5);
  const [restoreJobId, setRestoreJobId] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const engine = useEngine();
  const rendering = useRendering();
  const selectedTemplate = useMemo(
    () => templateDefinitions.find((definition) => definition.metadata.id === template) ?? null,
    [templateDefinitions, template],
  );
  const templatePreviewArtifactsBuilder = useMemo(
    () => new TemplatePreviewArtifactsBuilder(
      rendering.typographyCssVarBuilder,
      rendering.rotationCssVarBuilder,
      rendering.styleValuesCssVarsBuilder,
    ),
    [rendering.typographyCssVarBuilder, rendering.rotationCssVarBuilder, rendering.styleValuesCssVarsBuilder],
  );
  const templatePreviewScope = selectedTemplate ? `m2s-preview-${selectedTemplate.metadata.id}` : null;
  const templatePreviewVars = useMemo(
    () => selectedTemplate ? templatePreviewArtifactsBuilder.buildWrapperVars(selectedTemplate) : {},
    [selectedTemplate, templatePreviewArtifactsBuilder],
  );
  const templatePreviewCss = useMemo(
    () => selectedTemplate && templatePreviewScope
      ? templatePreviewArtifactsBuilder.buildScopedCss(selectedTemplate, templatePreviewScope)
      : '',
    [selectedTemplate, templatePreviewScope, templatePreviewArtifactsBuilder],
  );
  const templateFilterArtifacts = useMemo(
    () => selectedTemplate && templatePreviewScope
      ? templatePreviewArtifactsBuilder.buildFilterArtifacts(selectedTemplate, templatePreviewScope, 1280)
      : { filterDefsHtml: '', filterUrlVars: {} },
    [selectedTemplate, templatePreviewScope, templatePreviewArtifactsBuilder],
  );
  const templateLetterSplitter = selectedTemplate?.rendering.splitWordsIntoLetters ? engine.wordSplitter : null;

  // Real line splitter of the selected template, so the caption example is
  // broken into the same number of rows the final render would produce (e.g.
  // Loki: balanced-pixel-width, max 2 lines). Measures glyph widths against
  // the 1080x1920 render geometry with the template's CSS vars.
  const previewLineSplitter = useMemo(() => {
    if (!selectedTemplate) return null;
    const sheet = Sheet.fromTemplate(
      selectedTemplate.metadata.id,
      selectedTemplate.metadata.name,
      null,
      selectedTemplate,
    );
    const cssVars = rendering.sheetCssVarsBuilder.build(sheet);
    return engine.lineSplitters.build(selectedTemplate.lineSplitter, {
      css: selectedTemplate.getCss(),
      cssVars,
      videoWidth: 1080,
      videoHeight: 1920,
    });
  }, [selectedTemplate, rendering, engine]);

  // Anchor position mirrors the runtime overlay (AlignmentCssBuilder): the
  // caption is placed at the template's vertical/horizontal offset with the
  // align/justify from verticalAlign/horizontalAlign — not dead center.
  const captionAlignment = selectedTemplate?.alignment ?? ALIGNMENT_FALLBACK;
  const captionAnchorStyle = alignmentCssBuilder.buildAnchorStyle(captionAlignment);

  // Caption example scale: the template renders into a 720x1280 virtual
  // canvas (container-type: size feeds its cqh/cqw units), then the whole
  // canvas is letterboxed into the preview box so the caption keeps the
  // exact proportions of the final 1080x1920 render. Words wrap naturally
  // inside the 720-wide canvas — long copy never becomes one clipped line.
  const [captionScale, setCaptionScale] = useState(0.3);
  const captionPreviewRef = useRef<HTMLDivElement>(null);
  const CAPTION_PADDING = 10;
  useLayoutEffect(() => {
    const preview = captionPreviewRef.current;
    if (!preview) return;
    const measure = () => {
      const cw = preview.clientWidth - CAPTION_PADDING * 2;
      const ch = preview.clientHeight - CAPTION_PADDING * 2;
      if (cw <= 0 || ch <= 0) return;
      setCaptionScale(Math.min(cw / 720, ch / 1280));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(preview);
    return () => ro.disconnect();
  }, [selectedTemplate, templatePreviewScope]);

  useEffect(() => {
    if (!videoFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(videoFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

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
    const opts: Movie2ShortOptions = {
      model, template, outputMode, chunk, parts,
      stretch, hzoom, cameraPlan, lead, tail,
    };
    void movie2short.execute(opts);
  };

  const isM2S = mode === 'movie2short' && movie2short !== undefined;

  return (
    <AppDialog
      open={open}
      onClose={onCancel}
      closeOnOutsideClick={false}
      size="xl"
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
        <div className="grid grid-cols-[minmax(0,1fr)_240px] gap-3 items-start">
          <div className="space-y-3 min-w-0">
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
          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            <input
              type="checkbox"
              checked={chunk}
              onChange={(e) => setChunk(e.target.checked)}
              className="accent-accent size-4"
            />
            Analisis per chunk 40 detik
          </label>
          <p className="m-0 -mt-2 text-xs text-fg-faint">
            {chunk ? 'Video diproses per bagian 40 detik.' : 'Satu MP4 utuh dikirim untuk analisis.'}
          </p>
          <div>
            <span className="text-sm text-fg-secondary block">Output</span>
            <div className="flex rounded-xs border border-fg-muted/30 overflow-hidden w-full mt-1">
              <button
                type="button"
                className={`flex-1 px-2 py-1 text-xs font-medium transition-colors ${
                  outputMode === 'one'
                    ? 'bg-surface-3 text-accent shadow-inset-edge'
                    : 'bg-surface-2 text-fg-secondary hover:bg-surface-3 hover:text-fg-primary'
                }`}
                onClick={() => setOutputMode('one')}
              >
                One Short
              </button>
              <button
                type="button"
                className={`flex-1 px-2 py-1 text-xs font-medium transition-colors ${
                  outputMode === 'auto'
                    ? 'bg-surface-3 text-accent shadow-inset-edge'
                    : 'bg-surface-2 text-fg-secondary hover:bg-surface-3 hover:text-fg-primary'
                }`}
                onClick={() => setOutputMode('auto')}
              >
                Auto Split
              </button>
              <button
                type="button"
                className={`flex-1 px-2 py-1 text-xs font-medium transition-colors ${
                  outputMode === 'manual'
                    ? 'bg-surface-3 text-accent shadow-inset-edge'
                    : 'bg-surface-2 text-fg-secondary hover:bg-surface-3 hover:text-fg-primary'
                }`}
                onClick={() => setOutputMode('manual')}
              >
                Manual Split
              </button>
            </div>
            {outputMode === 'manual' && (
              <label className="block mt-2">
                <span className="text-sm text-fg-secondary">
                  Jumlah part — {parts}
                </span>
                <input
                  type="range"
                  min={2}
                  max={8}
                  step={1}
                  value={parts}
                  onChange={(e) => setParts(Number(e.target.value))}
                  className="w-full accent-accent mt-1"
                />
              </label>
            )}
            {outputMode === 'auto' && (
              <p className="m-0 mt-1.5 text-xs text-fg-faint">
                Dibagi otomatis ±90 detik per part, sesuai alur cerita.
              </p>
            )}
            {outputMode !== 'one' && (
              <p className="m-0 mt-1.5 text-xs text-fg-faint">
                Setiap part jadi draft sendiri yang bisa diedit.
              </p>
            )}
          </div>
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

          <div className="border border-edge-medium bg-black overflow-hidden">
            <div className="px-2 py-1.5 border-b border-edge-medium text-2xs uppercase tracking-wide text-fg-faint">
              Visual input
            </div>
            <div className="relative aspect-[9/16] overflow-hidden bg-black flex items-center justify-center">
              {previewUrl ? (
                <>
                  <video
                    key={`${previewUrl}-background`}
                    src={previewUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    aria-hidden
                    className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
                  />
                  <video
                    key={`${previewUrl}-foreground`}
                    src={previewUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="absolute left-1/2 top-1/2 max-w-none object-fill"
                    style={{
                      width: '100%',
                      height: `${31.67 + stretch * 68.33}%`,
                      transform: `translate(-50%, -50%) scaleX(${hzoom})`,
                    }}
                  />
                  {selectedTemplate && templatePreviewScope && (
                    <div
                      ref={captionPreviewRef}
                      className={`absolute inset-0 z-10 flex items-center justify-center pointer-events-none ${templatePreviewScope}`}
                      style={{
                        ...templatePreviewVars,
                        ...templateFilterArtifacts.filterUrlVars,
                        containerType: 'size',
                      } as React.CSSProperties}
                      aria-label={`Contoh caption template ${template}`}
                    >
                      <style>{templatePreviewCss}</style>
                      {templateFilterArtifacts.filterDefsHtml && (
                        <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
                          <defs dangerouslySetInnerHTML={{ __html: templateFilterArtifacts.filterDefsHtml }} />
                        </svg>
                      )}
                      <div
                        style={{
                          width: 720,
                          height: 1280,
                          containerType: 'size',
                          flexShrink: 0,
                          position: 'relative',
                          transform: `scale(${captionScale})`,
                          transformOrigin: 'center',
                        }}
                      >
                        {/* Zero-size grid anchor, same recipe as the runtime
                            overlay: positions the caption per the template's
                            alignment. max-content + the global `.line` nowrap
                            keep each pre-split line on one row. */}
                        <div
                          style={{
                            position: 'absolute',
                            display: 'grid',
                            gridTemplate: '0 / 0',
                            ...captionAnchorStyle,
                          } as React.CSSProperties}
                        >
                          <div style={{ width: 'max-content' }}>
                            <TemplatePreviewStatic
                              template={selectedTemplate}
                              letterSplitter={templateLetterSplitter}
                              lineSplitter={previewLineSplitter}
                              text="SPONGEBOB MENEMUKAN DUNIA YANG ANEH"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <span className="px-3 text-center text-xs text-fg-faint">Video input belum tersedia</span>
              )}
            </div>
            <div className="px-2 py-1.5 border-t border-edge-medium text-2xs text-fg-faint">
              Stretch {stretch.toFixed(2)} · H-Zoom {hzoom.toFixed(2)}
            </div>
          </div>
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
