import type { EditorStore } from '@core/editor/store/EditorStore';
import type { RefreshDocumentAction } from '@core/editor/actions/RefreshDocumentAction';
import type { RunTaggersAction } from '@core/tagging/actions/RunTaggersAction';
import type { ApplyHookSheetAction } from '@core/preprocessing/actions/ApplyHookSheetAction';
import type { ApplyMultipleSpeakersAction } from '@core/preprocessing/actions/ApplyMultipleSpeakersAction';
import type { CreateProjectAction } from '@core/projects/actions/CreateProjectAction';
import type { SaveProjectAction } from '@core/projects/actions/SaveProjectAction';
import type { ProjectPartRef, ProjectRepository } from '@core/projects/domain/ProjectRepository';
import { ProjectSaveFailedError } from '@core/projects/domain/errors/ProjectSaveFailedError';
import type { Telemetry } from '@core/telemetry/domain/Telemetry';
import type { AppError } from '@core/_shared/domain/AppError';
import type { AppErrorClassifier } from '@core/_shared/services/AppErrorClassifier';
import type { TranscribeProgressStore } from '@core/transcription/store/TranscribeProgressStore';
import { Movie2ShortLogStore, type Movie2ShortLogLine } from '@core/preprocessing/store/Movie2ShortLogStore';
import { parseSrtToDocument } from '@core/preprocessing/services/SrtDocumentBuilder';

export interface Movie2ShortOptions {
  readonly model: string;
  readonly template: string;
  /** one = satu short; auto = split otomatis ±90s/part; manual = user pilih jumlah part. */
  readonly outputMode: 'one' | 'auto' | 'manual';
  /** true = analisis per chunk 40 detik; false = satu video utuh. */
  readonly chunk: boolean;
  /** Jumlah part (dipakai saat outputMode = 'manual'). */
  readonly parts: number;
  /** Target menit per part (dipakai saat outputMode = 'auto'). */
  readonly minutesPerPart: number;
  /** BGM file path relatif ke repo (public/bgm/...) atau undefined untuk tanpa BGM. */
  readonly bgm?: string | undefined;
  /** Target durasi rekap full-spoiler dalam menit (dipakai saat outputMode = 'one'). */
  readonly targetMinutes?: number;
  readonly stretch: number;
  readonly hzoom: number;
  readonly cameraPlan: boolean;
  /** Jeda diam (detik) di AWAL tiap clip TTS — biar onset kalimat tidak terpotong. */
  readonly lead: number;
  /** Jeda diam (detik) di AKHIR tiap clip TTS — biar ekor kalimat tidak terpotong/halusinasi. */
  readonly tail: number;
}

interface PipelineJobArtifact {
  readonly name: string;
}

/**
 * Runs the Movie2Short server-side pipeline (analysis -> narration ->
 * TTS -> render -> tscaps caption) for the video currently loaded in
 * the editor, then builds an editable caption `Document` from the
 * pipeline's SRT output and persists it as a project draft — the same
 * tail (taggers, hook sheet, refresh, save) as `PreprocessVideoAction`
 * so the result lands in the editor fully editable.
 *
 * The backend runs at `backendBaseUrl`; progress is reported through
 * the shared `TranscribeProgressStore` so the existing preprocessing
 * splash shows live stage progress.
 */
export class Movie2ShortAction {
  constructor(
    private readonly store: EditorStore,
    private readonly runTaggers: RunTaggersAction,
    private readonly applyHookSheet: ApplyHookSheetAction,
    private readonly applyMultipleSpeakers: ApplyMultipleSpeakersAction,
    private readonly refresh: RefreshDocumentAction,
    private readonly createProject: CreateProjectAction,
    private readonly saveProject: SaveProjectAction,
    private readonly projectRepository: ProjectRepository,
    private readonly canPersist: () => boolean,
    private readonly telemetry: Telemetry,
    private readonly errorClassifier: AppErrorClassifier,
    private readonly progress: TranscribeProgressStore,
    private readonly logStore: Movie2ShortLogStore,
    private readonly backendBaseUrl: string,
  ) {}

  async execute(options: Movie2ShortOptions): Promise<void> {
    const { video } = this.store.snapshot();
    const videoFile = video.file;
    if (!videoFile) return;

    this.store.patch({ status: 'preprocessing', error: null });
    await this.yieldOnePaint();
    this.progress.start('inferring');
    this.progress.setInferringProgress(0.02, 'Menyiapkan video…');

    const startedAt = performance.now();
    let jobId: string | null = null;
    try {
      const { videoPath } = await this.uploadVideo(videoFile);
      this.progress.setInferringProgress(0.08, 'Uploading video…');
      const started = await this.startPipeline(videoPath, options);
      jobId = started.jobId;
      this.logStore.start(jobId);
      this.progress.setInferringProgress(0.12, 'Memulai pipeline…');
      const artifacts = await this.pollPipeline(jobId);
      this.progress.setInferringProgress(0.92, 'Menyusun draft…');
      const srtText = await this.fetchCaptionSrt(jobId, artifacts, options.template);
      this.progress.setInferringProgress(0.96, 'Membuat dokumen caption…');

      const parts = this.collectParts(jobId, artifacts);
      const document = parseSrtToDocument(srtText);
      this.store.patch({ document, parts, activePartIndex: 0 });
      await this.runTaggers.execute();
      this.applyHookSheet.execute();
      this.applyMultipleSpeakers.execute(false);
      this.refresh.execute();
      await this.persistResult();
      await this.persistParts(parts);
      await this.attachShortVideo(jobId, artifacts);

      this.progress.markComplete();
      this.telemetry.capture('movie2short_completed', {
        elapsed_ms: Math.round(performance.now() - startedAt),
        template: options.template,
        model: options.model,
      });
    } catch (err) {
      console.error('[movie2short] failed', err);
      if (jobId) await this.refreshLog(jobId).catch(() => {});
      this.progress.cancel();
      const appError = this.errorClassifier.wrap(err);
      this.store.patch({ status: 'idle', error: appError });
      this.telemetry.capture('movie2short_failed', {
        error_name: appError.name,
        error_message: appError.message,
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
    }
  }

  /**
   * Restores an editable draft from a *completed* backend job — no
   * re-analysis / re-TTS needed. Useful when a run finished server-side
   * but the frontend flow was interrupted (page reload), or when the
   * user wants a draft from an earlier successful job.
   */
  async restoreFromJob(jobId: string): Promise<void> {
    const res = await fetch(`${this.backendBaseUrl}/api/jobs/${jobId}`);
    if (!res.ok) throw new Error(`Gagal mengambil status job (HTTP ${res.status})`);
    let json: { ok?: boolean; job?: { status?: string; artifacts?: PipelineJobArtifact[] } } = {};
    try { json = await res.json(); } catch { /* keep empty */ }
    const job = json.job;
    if (!job) throw new Error('Job tidak ditemukan di backend.');
    if (job.status !== 'done') {
      throw new Error(`Job belum selesai (status: ${job.status}). Tunggu sampai selesai dulu.`);
    }
    this.logStore.start(jobId);
    await this.refreshLog(jobId).catch(() => {});

    this.store.patch({ status: 'preprocessing', error: null });
    await this.yieldOnePaint();
    this.progress.start('inferring');
    this.progress.setInferringProgress(0.2, 'Mengambil hasil job…');
    try {
      const srtText = await this.fetchCaptionSrt(jobId, job.artifacts ?? [], 'loki');
      this.progress.setInferringProgress(0.9, 'Membuat dokumen caption…');
      const document = parseSrtToDocument(srtText);
      this.store.patch({ document });
      await this.runTaggers.execute();
      this.applyHookSheet.execute();
      this.applyMultipleSpeakers.execute(false);
      this.refresh.execute();
      await this.persistResult();
      await this.attachShortVideo(jobId, job.artifacts ?? []);
      this.progress.markComplete();
    } catch (err) {
      console.error('[movie2short] restore failed', err);
      this.progress.cancel();
      this.store.patch({ status: 'idle', error: this.errorClassifier.wrap(err) });
    }
  }

  /**
   * Cancels the currently running backend job (if any), freeing the
   * concurrency guard so a new Generate can start.
   */
  async cancelRunningJob(): Promise<void> {
    const res = await fetch(`${this.backendBaseUrl}/api/jobs`);
    if (!res.ok) return;
    let json: { ok?: boolean; jobs?: Array<{ id: string; status?: string }> } = {};
    try { json = await res.json(); } catch { /* keep empty */ }
    const running = (json.jobs ?? []).find((j) => j.status === 'running');
    if (!running) return;
    await fetch(`${this.backendBaseUrl}/api/jobs/${running.id}/cancel`, { method: 'POST' }).catch(() => {});
  }

  private async uploadVideo(file: File): Promise<{ videoPath: string }> {
    const url = `${this.backendBaseUrl}/api/upload?name=${encodeURIComponent(file.name)}`;
    const res = await fetch(url, { method: 'POST', body: file });
    let json: { ok?: boolean; videoPath?: string; error?: string } = {};
    try { json = await res.json(); } catch { /* keep empty */ }
    if (!res.ok || !json.ok || !json.videoPath) {
      throw new Error(`Upload video gagal (HTTP ${res.status}): ${json.error ?? 'cek backend Movie2Short di ' + this.backendBaseUrl}`);
    }
    return { videoPath: json.videoPath };
  }

  private async startPipeline(
    videoPath: string,
    options: Movie2ShortOptions,
  ): Promise<{ jobId: string }> {
    const res = await fetch(`${this.backendBaseUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath,
        model: options.model,
        outputMode: options.outputMode,
        chunk: options.chunk,
        parts: options.parts,
        minutesPerPart: options.minutesPerPart,
        stretch: options.stretch,
        hzoom: options.hzoom,
        cameraPlan: options.cameraPlan,
        lead: options.lead,
        tail: options.tail,
        bgm: options.bgm,
        caption: true,
        template: options.template,
      }),
    });
    let json: { ok?: boolean; jobId?: string; error?: string } = {};
    try { json = await res.json(); } catch { /* keep empty */ }
    if (!res.ok || !json.ok || !json.jobId) {
      if (res.status === 409) {
        throw new Error('Masih ada job lain yang berjalan di backend. Batalkan dari dialog ini, atau tunggu sampai selesai, lalu coba lagi.');
      }
      throw new Error(`Pipeline gagal dimulai (HTTP ${res.status}): ${json.error ?? 'unknown'}`);
    }
    return { jobId: json.jobId };
  }

  private async pollPipeline(jobId: string): Promise<PipelineJobArtifact[]> {
    const STAGE_INFO: Record<string, { pct: number; label: string }> = {
      analysis: { pct: 0.2, label: 'Menganalisis video…' },
      condense: { pct: 0.35, label: 'Memadatkan cerita ke target durasi…' },
      tts: { pct: 0.45, label: 'Synthesizing narasi…' },
      split: { pct: 0.6, label: 'Membagi part…' },
      render: { pct: 0.7, label: 'Rendering video…' },
      caption: { pct: 0.85, label: 'Rendering caption…' },
    };
    const POLL_MS = 2500;
    const MAX_POLLS = 720; // 30 menit
    for (let i = 0; i < MAX_POLLS; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      await this.refreshLog(jobId).catch(() => {});
      const res = await fetch(`${this.backendBaseUrl}/api/jobs/${jobId}`);
      if (!res.ok) throw new Error(`Gagal mengambil status job (HTTP ${res.status})`);
      let json: { ok?: boolean; job?: { status?: string; stage?: string | null; error?: string | null; artifacts?: PipelineJobArtifact[] } } = {};
      try { json = await res.json(); } catch { /* keep empty */ }
      const job = json.job;
      if (!job) throw new Error('Job tidak ditemukan di backend.');
      if (job.status === 'error' || job.status === 'cancelled') {
        throw new Error(job.error || `Pipeline ${job.status}.`);
      }
      if (job.status === 'done') return job.artifacts ?? [];
      const info = job.stage ? STAGE_INFO[job.stage] : undefined;
      if (info) this.progress.setInferringProgress(info.pct, info.label);
    }
    throw new Error('Pipeline melebihi batas waktu 30 menit.');
  }

  /**
   * Menukar video preview editor ke potongan SHORT hasil pipeline
   * (`final_short.mp4` — timeline = master narasi, sudah berisi audio TTS).
   * Efeknya: (1) video tampil terpotong per scene (bukan sumber penuh),
   * (2) audio narasi ikut keputar di preview, (3) caption sejajar dengan
   * timeline video. File sumber tetap di `video.file` untuk re-run.
   *
   * Referensi preview (jobId + artifact) disimpan ke project record via
   * repository, sehingga setelah browser di-refresh, LoadProjectAction bisa
   * mengambil ulang `final_short.mp4` dari backend dan preview tetap short.
   */
  private async attachShortVideo(jobId: string, artifacts: PipelineJobArtifact[]): Promise<void> {
    // Part-01 lebih dulu di artifacts; cocok juga untuk mode one (root).
    const name = artifacts.find((a) => a.name === 'final_short.mp4' || a.name.endsWith('/final_short.mp4'))?.name;
    if (!name) return;
    try {
      const res = await fetch(`${this.backendBaseUrl}/files/${jobId}/${encodeURIComponent(name)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const { video } = this.store.snapshot();
      const duration = await this.probeVideoDuration(url);
      this.store.patch({ video: { ...video, url, duration: duration || video.duration } });
      await this.persistPreviewReference(jobId, name, duration || video.duration);
    } catch (error) {
      console.warn('[movie2short] gagal menukar video preview ke short cut:', error);
    }
  }

  /**
   * Mencatat referensi preview short-cut ke project record (best-effort).
   * Tidak menggagalkan alur utama kalau project belum dibuat / persisten
   * tidak tersedia.
   */
  private async persistPreviewReference(jobId: string, artifactName: string, duration: number): Promise<void> {
    const projectId = this.store.snapshot().projectId;
    if (!projectId || !this.canPersist()) return;
    try {
      await this.projectRepository.savePreviewVideo(projectId, { jobId, artifactName, duration });
    } catch (error) {
      console.warn('[movie2short] gagal menyimpan referensi preview:', error);
    }
  }

  private probeVideoDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => resolve(0);
      el.src = url;
    });
  }

  private async refreshLog(jobId: string): Promise<void> {
    const res = await fetch(`${this.backendBaseUrl}/api/jobs/${jobId}/log`);
    if (!res.ok) return;
    let json: { ok?: boolean; log?: Array<{ level?: string; line?: string }> } = {};
    try { json = await res.json(); } catch { /* keep empty */ }
    const log = json.log ?? [];
    const lines: Movie2ShortLogLine[] = log
      .slice(-30)
      .map((e) => ({
        text: (e.line ?? '').replace(/\s+/g, ' ').trim(),
        level: e.level ?? 'info',
      }))
      .filter((l) => l.text.length > 0);
    this.logStore.setLines(lines);
  }

  private async fetchCaptionSrt(
    jobId: string,
    artifacts: PipelineJobArtifact[],
    template: string,
  ): Promise<string> {
    const name = artifacts.find((a) => a.name.endsWith('.srt'))?.name;
    if (!name) {
      throw new Error('Hasil pipeline tidak memuat file caption (.srt). Pastikan opsi caption aktif.');
    }
    const res = await fetch(`${this.backendBaseUrl}/files/${jobId}/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Gagal mengambil SRT caption (HTTP ${res.status})`);
    return res.text();
  }

  /**
   * Mengelompokkan artifacts per part (`part-XX/...`). Mode one short
   * menghasilkan daftar kosong → perilaku lama (tanpa navigasi part).
   */
  private collectParts(jobId: string, artifacts: PipelineJobArtifact[]): ProjectPartRef[] {
    const prefixRe = /^(part-\d+)\/(.+)$/;
    const byPrefix = new Map<string, { video: string | null; srt: string | null }>();
    for (const a of artifacts) {
      const m = prefixRe.exec(a.name);
      if (!m) continue;
      const entry = byPrefix.get(m[1]!) ?? { video: null, srt: null };
      if (m[2]!.endsWith('.srt')) entry.srt = a.name;
      if (m[2]!.endsWith('/final_short.mp4') || m[2] === 'final_short.mp4') entry.video = a.name;
      byPrefix.set(m[1]!, entry);
    }
    return [...byPrefix.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([prefix, entry], index) => ({
        index,
        label: `Part ${index + 1}`,
        jobId,
        videoArtifact: entry.video ?? '',
        srtArtifact: entry.srt ?? '',
        duration: 0,
      }));
  }

  private async persistParts(parts: ProjectPartRef[]): Promise<void> {
    const projectId = this.store.snapshot().projectId;
    if (!projectId || parts.length === 0 || !this.canPersist()) return;
    try {
      await this.projectRepository.saveParts(projectId, parts);
    } catch (error) {
      console.warn('[movie2short] gagal menyimpan referensi part:', error);
    }
  }

  /**
   * Menukar draft aktif ke part lain: memuat SRT part tsb sebagai
   * dokumen caption + video preview part tsb, lalu menyimpan project.
   */
  async activatePart(index: number): Promise<void> {
    const state = this.store.snapshot();
    const part = state.parts[index];
    if (!part || part.index === state.activePartIndex) return;
    if (!part.srtArtifact || !part.videoArtifact) return;
    const jobId = part.jobId;
    if (!jobId) return;

    this.store.patch({ status: 'preprocessing', error: null });
    await this.yieldOnePaint();
    try {
      const srtRes = await fetch(`${this.backendBaseUrl}/files/${jobId}/${encodeURIComponent(part.srtArtifact)}`);
      if (!srtRes.ok) throw new Error(`Gagal mengambil SRT part (HTTP ${srtRes.status})`);
      const document = parseSrtToDocument(await srtRes.text());
      this.store.patch({ document });
      await this.runTaggers.execute();
      this.applyHookSheet.execute();
      this.applyMultipleSpeakers.execute(false);
      this.refresh.execute();

      const videoRes = await fetch(`${this.backendBaseUrl}/files/${jobId}/${encodeURIComponent(part.videoArtifact)}`);
      if (videoRes.ok) {
        const blob = await videoRes.blob();
        const url = URL.createObjectURL(blob);
        const { video } = this.store.snapshot();
        if (video.url && video.url.startsWith('blob:')) URL.revokeObjectURL(video.url);
        const duration = await this.probeVideoDuration(url);
        this.store.patch({
          video: { ...video, url, duration: duration || video.duration },
          activePartIndex: index,
        });
      } else {
        this.store.patch({ activePartIndex: index });
      }
      await this.persistResult();
    } catch (err) {
      console.error('[movie2short] gagal pindah part', err);
      this.store.patch({ status: 'idle', error: this.errorClassifier.wrap(err) });
    }
  }

  private async persistResult(): Promise<void> {
    if (!this.canPersist()) return;
    try {
      if (this.store.snapshot().projectId === null) {
        await this.createProject.execute();
      }
      await this.saveProject.execute();
    } catch (cause) {
      console.error('[movie2short] auto-save after pipeline failed', cause);
      this.store.patch({ error: new ProjectSaveFailedError({ cause }) });
    }
  }

  private async yieldOnePaint(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}
