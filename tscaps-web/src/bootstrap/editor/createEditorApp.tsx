import '@styles/tokens.css';
import '@styles/globals.css';
import '@styles/fonts.css';
import { ActiveSheetAutoSwitcher } from '@core/editor/automations/ActiveSheetAutoSwitcher';
import type { ReactElement } from 'react';
import { EditorApp } from '@bootstrap/editor/EditorApp';
import { BlockedEditorApp } from '@bootstrap/editor/BlockedEditorApp';
import { bootEngine } from '@bootstrap/wiring/engine';
import { bootBrowserSupport } from '@bootstrap/wiring/browser-support';
import { bootEditor, bootEditorStore } from '@bootstrap/wiring/editor';
import { bootCaptions } from '@bootstrap/wiring/captions';
import { bootCuts } from '@bootstrap/wiring/cuts';
import { bootTemplates, buildTemplateFavoritesIndexedDbStoreDefinition } from '@bootstrap/wiring/templates';
import { bootFonts } from '@bootstrap/wiring/fonts';
import { bootExport } from '@bootstrap/wiring/export';
import { ExportStore } from '@core/export/store/ExportStore';
import {
  bootProjects,
  buildProjectsIndexedDbStoreDefinition,
} from '@bootstrap/wiring/projects';
import { bootVideos, buildVideosIndexedDbStoreDefinition } from '@bootstrap/wiring/videos';
import { bootTranscription } from '@bootstrap/wiring/transcription';
import { bootTagging } from '@bootstrap/wiring/tagging';
import { bootPreprocessing, MOVIE2SHORT_BACKEND_URL } from '@bootstrap/wiring/preprocessing';
import type { PreviewVideoResolver, ProjectPreview } from '@core/projects/domain/ProjectRepository';
import { bootSheets } from '@bootstrap/wiring/sheets';
import { bootUtils } from '@bootstrap/wiring/utils';
import {
  bootUserBlobs,
  buildUserBlobsIndexedDbStoreDefinition,
} from '@bootstrap/wiring/user-blobs';
import {
  bootUserTemplates,
  buildUserTemplatesIndexedDbStoreDefinition,
} from '@bootstrap/wiring/user-templates';
import { bootAssetLibrary } from '@bootstrap/wiring/asset-library';
import { AggregateTemplateRepository } from '@core/templates/infrastructure/repositories/AggregateTemplateRepository';
import { bootRendering } from '@bootstrap/wiring/rendering';
import { bootRouting } from '@bootstrap/wiring/routing';
import { bootTelemetry } from '@bootstrap/wiring/telemetry';
import { isProfilingEnabled, setupProfiler, instrumentExportLifecycle } from '@bootstrap/editor/profiler';

export interface CreateEditorAppOptions {
  readonly appVersion: string;
  /**
   * Video file to load into the editor as soon as the store is wired,
   * before the React tree is returned, so the transcribe flow opens
   * on first paint.
   */
  readonly initialVideo?: File;
}

/**
 * Coordinates the editor tree's composition. Boots every feature
 * module in dependency order, pre-warms the data needed by the first
 * paint, gates on a browser-support probe (returning a blocked editor
 * app if WebCodecs or templates are unavailable), and hands the wired
 * modules to an `EditorApp` for mounting.
 *
 * Side-effect CSS imports run when this module is imported, so the
 * caller inherits the design tokens without separate work.
 */
export async function createEditorApp(opts: CreateEditorAppOptions): Promise<ReactElement> {

  const profilingEnabled = isProfilingEnabled();
  if (profilingEnabled) setupProfiler();


  const utils = bootUtils({
    indexedDbStores: [
      buildProjectsIndexedDbStoreDefinition(),
      buildVideosIndexedDbStoreDefinition(),
      buildUserBlobsIndexedDbStoreDefinition(),
      buildUserTemplatesIndexedDbStoreDefinition(),
      buildTemplateFavoritesIndexedDbStoreDefinition(),
    ],
  });
  const telemetry = bootTelemetry({
    userAgentInspector: utils.userAgentInspector,
    appVersion: opts.appVersion,
  });
  const routing = bootRouting({
    pathPrefix: '',
  });
  const videos = bootVideos({ indexedDb: utils.indexedDb });
  const engine = bootEngine();

  const editorStore = bootEditorStore({
    localStorageClient: utils.localStorageClient,
    userAgentInspector: utils.userAgentInspector,
  });
  const templates = await bootTemplates({
    localStorageClient: utils.localStorageClient,
    indexedDb: utils.indexedDb,
    engine,
  });
  const browserSupport = await bootBrowserSupport({
    templateRepository: templates.repository,
    userAgent: navigator.userAgent,
  });
  if (!browserSupport.supportReport.webcodecsSupported) return withRootErrorBoundary(<BlockedEditorApp reason="webcodecs" />);
  if (browserSupport.supportReport.supportedTemplateIds.size === 0) return withRootErrorBoundary(<BlockedEditorApp reason="no-templates" />);
  const userBlobs = await bootUserBlobs({
    indexedDb: utils.indexedDb,
  });
  const userTemplates = await bootUserTemplates({
    indexedDb: utils.indexedDb,
    engine,
    templates,
    templateSupportChecker: browserSupport.templateSupportChecker,
  });
  const templateRepository = new AggregateTemplateRepository([
    templates.repository,
    userTemplates.templateRepository,
  ]);
  const assetLibrary = bootAssetLibrary({ templates, userBlobs });
  const rendering = bootRendering({ assetLibrary });
  const editor = bootEditor({
    engine,
    rendering,
    store: editorStore.store,
    transcribePreferenceRepository: editorStore.transcribePreferenceRepository,
    filteredTemplateRepository: browserSupport.filteredTemplateRepository,
  });
  const captions = bootCaptions({
    store: editor.store,
    deriver: editor.deriver,
    refresh: editor.refresh,
  });
  const cuts = bootCuts({ store: editor.store });
  const fonts = await bootFonts({ userBlobs });
  // ExportStore is created up here so it can feed both `projects`
  // (which resets it on project load) and `exports` (which is the
  // module that owns its mutations). `projects.actions.save` then
  // becomes a dep of `exports` for the auto-save-before-render flow,
  // which is why this two-step wiring exists.
  const exportRunStore = new ExportStore();
  const previewVideoResolver: PreviewVideoResolver = (preview: ProjectPreview) =>
    resolvePreviewVideo(MOVIE2SHORT_BACKEND_URL, preview);
  const projects = bootProjects({
    templateRepository,
    store: editor.store,
    exportStore: exportRunStore,
    refresh: editor.refresh,
    templateSupportChecker: browserSupport.templateSupportChecker,
    indexedDb: utils.indexedDb,
    videoBlobCache: videos.blobCache,
    previewVideoResolver,
  });
  const sheets = bootSheets({
    store: editor.store,
    refresh: editor.refresh,
    deriver: editor.deriver,
    templates,
    telemetry,
  });
  const exports = bootExport({
    engine,
    rendering,
    sheets,
    cuts,
    utils,
    store: editor.store,
    fonts,
    runStore: exportRunStore,
    saveProject: projects.actions.save,
    telemetry,
    userBlobs,
    overlayResolver: () => null,
  });
  const tagging = bootTagging({
    store: editor.store,
  });
  const transcription = bootTranscription({
    store: editor.store,
    preferenceRepository: editor.transcribePreferenceRepository,
    audioDecoder: engine.audioDecoder,
  });
  const preprocessing = bootPreprocessing({
    store: editor.store,
    transcribe: transcription.actions.transcribe,
    progress: transcription.progressStore,
    runTaggers: tagging.actions.runTaggers,
    refresh: editor.refresh,
    deriver: editor.deriver,
    projects,
    telemetry,
  });
  // Automation that bridges the editor store and the sheets feature:
  // started here because it depends on both modules being ready.
  new ActiveSheetAutoSwitcher(editor.store, sheets.actions.sheets.setActive).start();

  if (profilingEnabled) instrumentExportLifecycle(exports.runStore);

  // Kick off template hydration so it overlaps with the first React paint.
  void editor.actions.initialize.execute();

  if (opts.initialVideo) editor.actions.video.load.execute(opts.initialVideo);

  const { attachE2EHookIfRequested } = await import('@bootstrap/e2eHook');
  attachE2EHookIfRequested({
    editorStore: editor.store,
    exportStore: exports.runStore,
    loadVideo: editor.actions.video.load,
    exportRun: exports.actions.run,
  });

  const tree = (
    <EditorApp
      modules={{
        engine,
        rendering,
        routing,
        editor,
        captions,
        cuts,
        projects,
        templates,
        sheets,
        transcription,
        tagging,
        preprocessing,
        exports,
        fonts,
        utils,
        telemetry,
        userBlobs,
        userTemplates,
        assetLibrary,
      }}
    />
  );
  return withRootErrorBoundary(tree);
}

/**
 * Fetches a project's short-cut preview video (`final_short.mp4` with the
 * burned-in narration) from the Movie2Short backend and turns it into a
 * playable object URL. Returns `null` when the artifact is gone or the
 * backend is unreachable — the editor then falls back to the original
 * source video.
 */
async function resolvePreviewVideo(
  backendBaseUrl: string,
  preview: ProjectPreview,
): Promise<{ url: string; duration: number } | null> {
  try {
    const res = await fetch(
      `${backendBaseUrl}/files/${encodeURIComponent(preview.jobId)}/${encodeURIComponent(preview.artifactName)}`,
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const duration = await probeVideoDuration(url);
    return { url, duration: duration || preview.duration };
  } catch (error) {
    console.warn('[projects] backend preview tidak tersedia, memakai video sumber:', error);
    return null;
  }
}

function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => resolve(0);
    el.src = url;
  });
}

function withRootErrorBoundary(tree: ReactElement): ReactElement {
  return tree;
}
