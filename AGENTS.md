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
- Orkestrasi Node: `node tools/audiocpp_manifest_tts.mjs --manifest <m.json> --ref-audio data\reference\test_snippet.wav --ref-text data\reference\test_snippet.txt --output <n.wav>`
- Default: `audiocpp_cli.exe` menggunakan snapshot `k2-fsa/OmniVoice`, backend `cuda`.
- Narasi berfungsi sebagai master timeline saat digabungkan dengan video final.

## Frontend Preview (tscaps-web)
- Frontend React HANYA berfungsi menampilkan hasil akhir dan UI dasar. Segala logika dan konfigurasi model diatur oleh Backend (`.env`).
- Menyimpan referensi preview di IndexedDB agar persisten saat di-refresh.

## Known Issues / Env
- C: drive mudah penuh (pagefile 16-30 GB; RAM host 31,8 GB sering jenuh). Bersihkan cache aman bila ruang sisa `0.x GB`.
- Ollama kadang mati dan perlu restart (`Get-Process ollama* | Stop-Process -Force`, lalu `Start-Process ollama`).
- Jangan commit/push tanpa perintah eksplisit user.