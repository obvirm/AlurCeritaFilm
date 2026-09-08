# movie2short - Project Context

## Input Video
- **Video input utama**: `C:\Users\X\Downloads\getvid.mp4`
- **Video referensi** (gaya narasi): `C:\Users\X\Downloads\KISAH SPONGEBOB JADI PENGANGGURAN.mp4`
- JANGAN menukar keduanya. Video referensi hanya untuk gaya, BUKAN input pipeline.
- Reference voice TTS: `data/reference/test_snippet.wav` (+ `test_snippet.txt`) - scope SATU narrator.

## Pipeline Architecture
1. **Analyzer** (`src/analyzer`): Menganalisis video per chunk menggunakan OpenAI Compatible API untuk menghasilkan manifest scene dan teks narasi. (Default: membaca audio/visual langsung dari MP4).
2. **Synthesizer** (`src/synthesizer`): Memproses manifest dan narasi menjadi struktur siap render.
3. **Renderer** (`src/renderer`): Menggabungkan hasil (visual dan audio) menggunakan FFmpeg untuk menghasilkan video final (`final_short.mp4`).

## Aturan Sandbox & End to End (WAJIB)
1. **100% di dalam repo** — semua model & binary ada di `tts/`, `sandbox/` dan `models/` di dalam `movie2short`. DILARANG referensi keluar ke `E:\project\tscaps`, `D:\audio-cpp-lowend-gpu`, atau `C:\Program Files\`.
   - Audio C++ (folder fungsi `tts/`): `tts/bin/audiocpp_cli.exe` + `tts/model_specs` + `models/OmniVoice`
   - Chromium: `browser/chromium-*/chrome-win64/chrome.exe` via `PLAYWRIGHT_BROWSERS_PATH=browser`
   - Templates: `templates/` (copy dari tscaps, tscaps murni referensi, jangan baca lintas repo)
2. **End to end = one shot via server** — `POST /api/run` dengan `outputMode=one` langsung jadi `final_captioned_loki.mp4` tanpa manual `node cli/...` pakai `$env`.
3. **ROM:**
   - Gaya narasi (editable) → `prompts/narration_prompt.md` (MD)
   - Penentuan menit/part (hardcode) → `src/analyzer/model.ts` hardcode `PENENTUAN DURASI {{MINUTES}}/{{PARTS}}` di-inject dari `.env` `M2S_MINUTES_PER_PART`/`M2S_PARTS`
   - TTS voice cloning (mp3) → variabel `TTS_VOICE` terpisah, bukan di ROM

## API & Model (OpenAI Compatible)
- **Konfigurasi Utama**: 100% diatur melalui file `.env`.
- Semua koneksi AI menggunakan standar **OpenAI Compatible API** (terpusat di `model.ts`). File legacy khusus vendor tertentu sudah dihapus.
- Variabel `.env` yang digunakan:
  - `M2S_MODEL_NAME` (contoh: `ag/gemini-3.6-flash-high`)
  - `OPENAI_BASE_URL` (contoh: `http://localhost:20128/v1`)
  - `OPENAI_API_KEY`
- **Chunking**: Analisis per-chunk 40 detik (`chunkDuration = 40`), `fps: 1`, prompt kasual. Visual di-crop menggunakan `hzoom 1.15`.
- **Cloud Cleanup**: Jika model mendukung backend cloud, pastikan resource temporer dihapus di blok `finally`.

## Run Command
```
npx tsx src/index.ts --video "C:\Users\X\Downloads\getvid.mp4"
```
*(Parameter model dan URL diambil dari .env)*

## Backend Server
- **Production**: `npm run dev:ui` - menjalankan `server/server.mjs` (Node.js)
- Port default: 3131 (env `PORT`)
- Pipeline dijalankan sebagai subprocess dari server Node.js.

## Sinkronisasi Visual & Narasi
- Kondisi "aman" saat ini (commit `e829622`): analisis per-chunk 40 detik membuat scene berdurasi pendek (3-8s) yang pas dengan durasi membaca narasi.
- Eksperimen visual anchor (`visual_start_sec/visual_end_sec`) dan crop-awal sudah di-revert. Jangan dipasang ulang tanpa perintah user.

## TTS Runtime (audio.cpp - pure C++)
- Orkestrasi Node: `node tools/audiocpp_manifest_tts.mjs --manifest <m.json> --ref-audio data\reference\test_snippet.wav --ref-text data\reference\test_snippet.txt --output <n.wav>` (otomatis chunked `AUDIOCPP_BATCH_SIZE=4` biar RAM aman)
- Binary & model di folder fungsi `tts/`: `tts/bin/audiocpp_cli.exe` + `models/OmniVoice`, backend `cuda`.
- Narasi berfungsi sebagai master timeline saat digabungkan dengan video final.

## Frontend Preview (tscaps-web)
- Frontend React HANYA berfungsi menampilkan hasil akhir dan UI dasar. Segala logika dan konfigurasi model diatur oleh Backend (`.env`).
- Menyimpan referensi preview di IndexedDB agar persisten saat di-refresh.

## Aturan Kerja (WAJIB)
- **JANGAN SENTUH BACKEND KALAU USER CUMA MINTA FRONTEND/UI.** Backend = `server/server.mjs`, `tscaps-renderer/*`, pipeline `templates/`, `@tscaps/engine`, `src/analyzer`, `src/synthesizer`, `src/renderer`, dan script build `tools/*`.
  - Kalau kerja frontend nemu bug/error yang akarnya di backend (misal API nggak balikin data, endpoint kurang, CSS caption kosong), **STOP** — laporkan ke user, jangan benerin pipeline backend sendiri.
- Kalau frontend butuh endpoint/perubahan API baru, tanya dulu & tunggu konfirmasi eksplisit sebelum ubah backend.
  - Pengecualian: HANYA ubah backend kalau user minta eksplisit ("benerin backend", "tambah endpoint", dst).
- **JANGAN OVER-ENGINEERING.** Jangan nambah fitur/UI/komponen yang user tidak minta. PRINSIP: YAGNI — kerjakan tepat yang diminta, tidak lebih. Contoh pelanggaran: user cuma minta fix grid thumb, jangan sekalian nambah panel detail `css — first 800 chars` + `template.json` + `iframe preview` di `web/src/ui/pages/Templates.tsx:56`. Kalau mau nambah, tanya dulu & tunggu `ok` eksplisit.
- **Harus berimajinasi tapi jangan over-engineering.** Saat bikin contoh/sample jangan cuma `1 kata` (`Tito` doang) — kasih kuota `2-3 kata` biar kepakai `highlight` & `line` wrapping, misal `THIS IS TSCAPS` / `THIS IS TEMPLATE` / `ini adalah caption`. Thinking imaginative untuk konten, bukan untuk nambah arsitektur.
- **Jangan commit/push tanpa perintah eksplisit user.**
- **Jangan eksekusi perintah destruktif git** (`git reset --hard`, `git clean`, `git checkout -- .`) tanpa jelasin dulu situasinya dan dapet arahan user.
- **Thinking kelamaan = kabari user.** Kalau analisis/eksekusi lama, kasih update progress dulu, jangan diam.

## Aturan Anti-Mereh (WAJIB — biar gak iya-iya & halusinasi)
- **JANGAN jawab iya-iya tanpa bukti.** Tiap klaim `udah plek` wajib sertakan `file:line` + hasil `read`/screenshot — kalau belum baca, bilang `belum baca`.
- **JANGAN nanya ulang hal yang user udah jawab 2x.** Catat `4:2 wide` `5 grid` `gap-3` `hitam #000/#0A0A0A + abu #1A1A1A/#27272A` `hijau #B6FF3B cuma border selected` `judul==caption` `thumb==kanvas 1:1` di `AGENTS.md` biar gak lupa.
- **DI plan cuma boleh read/inspect — dilarang halusinasi `build sukses` kalau belum `npm --prefix web run build` + `curl /templates` 200.**
- **DI build jangan eksekusi tanpa `ok` eksplisit user.** Tanya `ok plek atau putih?` sekali aja, kalau user bilang `sono kerjakan` baru tulis `web/src/ui/components/TemplateGrid.tsx:59`.
- **TIAP thumb harus pakai `style.build.css` + `segment/line/word` + `fitScale 2.4` biar `selene` pill gak kecil — kalau masih `14px Inter` berarti belum sesuai template, jangan bilang sesuai.

## Known Issues / Env
- C: drive mudah penuh (pagefile 16-30 GB; RAM host 31,8 GB sering jenuh). Bersihkan cache aman bila ruang sisa `0.x GB`.
- Ollama kadang mati dan perlu restart (`Get-Process ollama* | Stop-Process -Force`, lalu `Start-Process ollama`).
- Jangan commit/push tanpa perintah eksplisit user.