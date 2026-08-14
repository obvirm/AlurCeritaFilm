import type { Project } from '@core/projects/domain/Project';
import type { ProjectMetadata } from '@core/projects/domain/ProjectMetadata';

/**
 * Reference to a completed Movie2Short pipeline job's short-cut video
 * (`final_short.mp4` — timeline = master narasi, sudah berisi audio TTS).
 *
 * Persisted with the project record so the editor can restore the short
 * preview after a page reload. The video bytes themselves live on the
 * backend (`/files/<jobId>/<artifactName>`), not in IndexedDB, so the
 * preview does not compete with the source blob in the LRU video cache.
 */
export interface ProjectPreview {
  readonly jobId: string;
  readonly artifactName: string;
  readonly duration: number;
}

/**
 * Resolves a persisted preview reference into a playable object URL.
 * Implementations fetch the backend artifact (`/files/<jobId>/<name>`)
 * and return `null` when the artifact is gone or the backend is down —
 * the caller then falls back to the original source video.
 */
export type PreviewVideoResolver = (
  preview: ProjectPreview,
) => Promise<{ url: string; duration: number } | null>;

/**
 * Persistence contract for Projects.
 *
 * Video Blob handling is exposed as separate methods because the cache is
 * LRU-bounded while the main project record persists indefinitely.
 * `save` does not touch the video blob; `cacheVideoBlob` does, and is the
 * sole entry point that may evict an older blob.
 */
export interface ProjectRepository {
  list(): Promise<ProjectMetadata[]>;
  load(id: string): Promise<Project | null>;
  has(id: string): Promise<boolean>;
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;

  loadVideoBlob(projectId: string): Promise<Blob | null>;
  cacheVideoBlob(projectId: string, blob: Blob): Promise<void>;

  /**
   * Persists (or clears, when `preview` is `null`) the short-cut video
   * reference for a project. Independent of the main project record
   * save — the preview is a backend artifact reference, not part of the
   * serialised project payload.
   */
  savePreviewVideo(projectId: string, preview: ProjectPreview | null): Promise<void>;
  loadPreviewVideo(projectId: string): Promise<ProjectPreview | null>;
}
