# PRD — movie2short Studio Frontend (Clean-Room Clone dari tscaps)

> **Status:** Draft v1.0 — 29 Aug 2026
> **Owner:** movie2short
> **Referensi perilaku:** `E:\project\tscaps\apps\studio` (AGPL-3.0) — diamati black-box, tidak copy kode
> **Backend kontrak:** `server/server.mjs` + `src/index.ts` + `src/analyzer/model.ts`

## 1. Ringkasan Eksekutif

`movie2short` adalah pipeline lokal yang mengubah movie panjang menjadi short-form 9:16 dengan narasi TTS clone, auto-caption `loki`, dan BGM. Pipeline sudah end-to-end via `POST /api/run` → `final_captioned_loki.mp4` (`AGENTS.md:19`). Frontend belum ada (`tscaps-web/dist` tidak ada). PRD ini mendefinisikan frontend clean-room yang meng-clone **perilaku** `tscaps Studio` tanpa menyalin ekspresi `AGPL`, agar dapat dilisensikan ulang secara permissive (AJPL/MIT milik sendiri).

Engine `packages/engine` (`MIT`) boleh dipakai sebagai dependency `npm`, sedangkan `apps/studio` (`AGPL-3.0`) hanya jadi referensi perilaku.

## 2. Tujuan & Metrik Sukses

**Tujuan:**
- Satu portal web di `http://localhost:3131` (port `PORT` `server.mjs:751`) untuk upload → konfigurasi → run → pantau log WS → preview & download artifact.
- UX familiar bagi pengguna `tscaps`: dropzone, preview video, timeline, template gallery, toast, mobile/desktop layout.
- 100% sandbox (`sandbox/audio-cpp`, `sandbox/chromium`, `models/OmniVoice` `AGENTS.md:15`) — tidak referensi keluar repo.

**Metrik sukses (MVP):**
- Upload 500MB → `POST /api/upload` sukses < 60s di LAN.
- Run one-shot `outputMode=one` → `final_captioned_loki.mp4` tampil di `/jobs/:id` tanpa manual `node cli/...`.
- Log WS live < 500ms latency, survive 3 jam (roadmap `docs/ROADMAP.md:5`).
- Preview `<video>` seek via `Range` header `server.mjs:681` tanpa buffer ulang penuh.
- Lighthouse performance > 80, a11y > 90.

## 3. Non-Tujuan (Out of Scope MVP)

- Transkripsi browser Whisper (`@huggingface/transformers` + `mediabunny` di `tscaps`) — diganti polling `analysis` server.
- Person segmentation & behind-actor mask (`src/core/person-segmentation`) — opsional fase 2.
- Edit `narration_text` lalu re-TTS tanpa re-run analisis (butuh endpoint baru — perlu izin backend `AGENTS.md:60`).
- Multi-user auth / cloud sync.

## 4. Persona

| Persona | Kebutuhan |
|---|---|
| **Creator TikTok** | Butuh short 2 menit cepat, pilih template `loki`, ganti hook pertama, download mp4+srt. |
| **Editor Long Movie** | Split `auto` 2 menit/part `M2S_MINUTES_PER_PART` `server.mjs:234`, pantau log per-stage, cancel job `server.mjs:550`. |

## 5. User Stories (Prioritas MoSCoW)

**Must:**
- Sebagai creator, saya drag-drop `getvid.mp4` ke dropzone, melihat preview sebelum run (mirip `VideoDropzone` `EditorPage.tsx:238`).
- Sebagai editor, saya pilih model `M2S_MODEL_NAME` (`ag/gemini-3.6-flash-high` default `.env:3`), toggle `chunk 40s` `server.mjs:245`, `caption ON`, pilih `template loki` dari `GET /api/templates` `server.mjs:571`.
- Sebagai operator, saya melihat `stage=analysis|tts|render|caption` live via `WS /ws?job=` `server.mjs:164` dan `GET /api/jobs/:id/log` `server.mjs:648`.
- Sebagai reviewer, saya play `final_short.mp4` dan `final_captioned_loki.mp4` via `GET /files/:jobId/*` dengan `Range` `server.mjs:681`.

**Should:**
- Timeline visual: batang scene 3–8s (`model.ts:114`) vs durasi TTS `narration_durations.json` master timeline `AGENTS.md:53`.
- Dashboard `/` daftar 20 jobs Terbaru `GET /api/jobs` `server.mjs:630` dengan status `queued|running|done|error|cancelled`.
- Template gallery dengan `swatch` gradient `server.mjs:585` + live CSS preview.

**Could:**
- Edit `narration_text` inline (dirty flag `EditorStore.ts:108`) lalu export SRT saja.
- Favorite template via `localStorage` (mimic `IndexedDB` 7 stores `createEditorApp.tsx:111` tapi ringkas).

## 6. Persyaratan Fungsional

### 6.1 Shell & Navigasi
- SPA `react-router-dom@7` routes: `/` Dashboard, `/new` Wizard, `/jobs/:id` Detail, `/templates` Gallery, `/*` fallback `index.html` (mirip `server.mjs:712` SPA fallback).
- Header: Wordmark, Theme toggle `data-theme` `index.html:10`, back button `onBack` `EditorHost.tsx:412`.
- Layout: `DesktopEditorLayout` 3-kolom + `MobileEditorLayout` bottom-sheet `EditorPage.tsx:257` responsive `< 768px`.

### 6.2 Upload
- Dropzone + file picker, accept `video/*`, validasi `fs.existsSync` setara `server.mjs:505`, POST raw body ke `POST /api/upload?name=<basename>` `server.mjs:478`, tampilkan progress & `videoPath` hasil.
- Guard: jika ada job `running` (`find j.status==='running'` `server.mjs:510`) tampilkan banner 409.

### 6.3 Konfigurasi Run
Form di `/new` mapping ke `sanitized` `server.mjs:519`:
- `model` (string, default `gemini/gemini-3.6-flash-high`)
- `chunk` boolean|number (true=40s, false=full) `server.mjs:242`
- `minutesPerPart` & `parts` + `outputMode=one|auto|manual` `server.mjs:234,531`
- `targetMinutes` → `targetSeconds` `server.mjs:239` (recap condense)
- `stretch` 0..1, `hzoom` >1 (contoh 1.15 `AGENTS.md:33`)
- `caption` bool, `template` string default `loki` `server.mjs:528`
- `lead`/`tail` number detik (default 5)
- `bgm` path opsional (`public/bgm/*.flac` fallback `server.mjs:235`)

### 6.4 Eksekusi & Observability
- `POST /api/run` → `{jobId}` `server.mjs:537`, redirect ke `/jobs/:id`.
- Poll `GET /api/jobs/:id` `server.mjs:604` + `GET /api/jobs/:id/log` `server.mjs:648` + WS `subscribe(jobId, ws)` `server.mjs:164` untuk `pushLog`/`pushStatus` `server.mjs:176,187`.
- Stage badge `analysis|condense|tts|split|render|caption` `runPipeline` `server.mjs:232`.
- Tombol Cancel `POST /api/jobs/:id/cancel` `server.mjs:550` (kill `job._proc` `server.mjs:559`).

### 6.5 Preview & Artifact
- Daftar `job.artifacts` `server.mjs:616` render sebagai list `{name, kind: video|srt|audio|json|text}` `server.mjs:108`.
- `<video>` src `/files/:jobId/<name>` dengan support `Range` bytes `server.mjs:681` + `accept-ranges` `server.mjs:705`.
- Download SRT `final_captioned_loki.srt` `render-movie2short-template.ts:73` dan `narasi.txt`.
- Simpan referensi preview di `IndexedDB` (persist refresh) `AGENTS.md:57` versi ringkas: `localStorage` key `m2s:lastJobId` + `artifacts`.

### 6.6 Template Gallery
- `GET /api/templates` `server.mjs:571` → grid card `{id, name, swatch, css, json.styleControls}`.
- Card click pilih template untuk run berikutnya, preview iframe inject `style.css` + `filters.svg` (jika ada) `render-movie2short-template.ts:52`.

## 7. Persyaratan Non-Fungsional

- **Clean-room:** Tidak copy file `AGPL` verbatim; hanya amati perilaku. Spec ini jadi intermediate. Engine `MIT` boleh `npm i @tscaps/engine` jika perlu.
- **Sandbox:** Semua binary di `sandbox/` `AGENTS.md:15`, `PLAYWRIGHT_BROWSERS_PATH=sandbox/chromium` `server.mjs:81`.
- **Performa:** Bundle < 500KB gz (tanpa `mediabunny`/`transformers`), LCP < 2.5s, log 4000 entri cap `pushLog` `server.mjs:179`.
- **A11y:** Keyboard seek (`prevFrame/nextWord` mimic `PlaybackActions` `EditorHost.tsx:350`), focus ring, `aria-label` dropzone.
- **i18n:** Default Indonesia (pesan `videoPath tidak valid` `server.mjs:506`), toggle EN opsional.
- **Error:** Jika `manifest.json` 0 scene → tampilkan hint kuota `429` `server.mjs:265,275`.

## 8. Arsitektur Ringkas

```
web/  (Vite + React 19 + TS + Tailwind + react-router-dom + zustand)
  src/main.tsx  -> boot PipelineApp (mirip createEditorApp.tsx:92 tanpa bootEngine berat)
  src/app/api/client.ts  -> fetch + WS wrapper untuk 6 endpoint server.mjs
  src/app/stores/pipelineStore.ts -> Zustand store mimic EditorStore.ts:27 patch/commit/dirty
  src/ui/pages/{Dashboard, NewJob, JobDetail, Templates}
  src/ui/components/{VideoDropzone, VideoPlayer, CustomVideoControls, TimelinePreview, CaptionsPanel, TemplateGrid, LogViewer, ArtifactList, Toast}
  src/styles/tokens.css, globals.css (copy token tscaps tapi tulis ulang)

server/server.mjs:712 -> serve `web/dist` (ganti dari `tscaps-web/dist`)
```

## 9. Kriteria Penerimaan (Acceptance)

- [ ] `npm run dev:web` (Vite 5173) proxy `/api` → `3131` jalan.
- [ ] `npm run build` hasil `web/dist/index.html` ter-serve via `node server/server.mjs` di `http://localhost:3131`.
- [ ] Upload `C:\Users\X\Downloads\getvid.mp4` via UI sukses, `videoPath` tercatat.
- [ ] Run one-shot menghasilkan `final_captioned_loki.mp4` dan dapat di-play seek tanpa error `artifact not found` `server.mjs:671`.
- [ ] Log WS live muncul, stage badge update, cancel bekerja.
- [ ] Template gallery tampil `loki` dengan `swatch` dan `css` tidak kosong.
- [ ] Tidak ada file `AGPL` ter-copy; `web/LICENSE` baru terpasang.

## 10. Risiko & Mitigasi

- **AGPL taint:** Review `git diff` sebelum merge, pastikan tidak ada blok > 10 baris identik dengan `apps/studio`.
- **C: penuh / RAM jenuh** `AGENTS.md:68`: build di `E:`, cleanup `node_modules/.cache`.
- **Ollama mati** `AGENTS.md:70`: UI tampilkan hint fallback `llava:7b` ↔ `gemini`.
- **Concurrency 409:** UI lock tombol Run dan polling `GET /api/jobs` untuk cek `running`.

## 11. Roadmap Implementasi

1. Scaffold `web/` Vite + Tailwind + Router (Fase 1)
2. API client + store + WS (Fase 2)
3. Dashboard + NewJob Wizard (Fase 3)
4. JobDetail + LogViewer + Cancel (Fase 4)
5. Preview + Artifacts + Range (Fase 5)
6. Templates Gallery (Fase 6)
7. Polish + build verify (Fase 7)

---
*Dokumen ini adalah spec clean-room. Implementasi hanya boleh membaca spec ini dan kontrak `server.mjs`, bukan menyalin `apps/studio/src`.*
