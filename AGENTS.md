# movie2short — Project Context

## Input Video
- **Video input utama**: `C:\Users\X\Downloads\getvid.mp4`
- **Video referensi** (gaya narasi): `C:\Users\X\Downloads\KISAH SPONGEBOB JADI PENGANGGURAN.mp4`
- JANGAN menukar keduanya. Video referensi hanya untuk gaya, BUKAN input pipeline.
- Reference voice TTS: `data/reference/test_snippet.wav` (+ `test_snippet.txt`) — scope SATU narrator.

## Pipeline
1. Whisper.cpp (`whisper/Release/whisper-cli.exe`, model `whisper/ggml-large-v3-turbo.bin`) → transkrip audio (hanya untuk pipeline lokal; Gemini baca audio MP4 langsung)
2. VLM → analisis scene per chunk (Gemini 3.6 Flash via upload MP4, ATAU Ollama llava:7b lokal)
3. Stage 2 synthesis → manifest + narasi
4. TTS OmniVoice natural (CPU fallback) → `narration_omnivoice_natural.wav` + `.json`
5. FFmpeg render → video final (narasi = master timeline, audio asli video TIDAK dipakai)

## VLM Model — WAJIB BACA: docs/GEMINI_MODELS.md
- **Kondisi saat ini = RESTORE ke commit `e829622`** (diputuskan user): model `gemini-2.5-flash`, analisis **per-chunk 40 detik** (`chunkDuration = 40`), `fps: 1`, prompt storyteller lama, renderer zoom 1.15 crop tengah. Inilah versi yang user anggap "aman" (visual pas narasi).
- ⚠️ **Run 2026-08-13 dengan kondisi restore GAGAL**: mayoritas chunk 2.5-flash mengembalikan JSON yang tidak bisa diparse kode commit (`JSON tidak bisa diparse, chunk dilewati` ±12×, kemungkinan terpotong maxOutputTokens 2048 atau format berubah), plus kuota free tier habis (429) di tengah run. Diagnosa ulang butuh kuota balik — JANGAN asumsikan kondisi commit otomatis jalan.
- ⚠️ **TTS bisa jalan di CUDA padahal harus CPU**: `CUDA_VISIBLE_DEVICES=''` di env server tidak selalu efektif di Windows spawn — cek log `Loading ... on cuda` sebelum TTS panjang.
- JANGAN ubah chunking/nol-chunking tanpa perintah eksplisit user — eksperimen nol-chunking (1 request video penuh) sudah dicoba dan membuat timestamp Gemini meleset + fps 4 kena 503 free tier.
- Fallback lokal saat kuota API habis/429: `--model llava:7b` (kualitas jauh lebih rendah, hanya cadangan).
- Pipeline lokal sudah dipaksa **semua frame (tiap 2 detik) resolusi penuh**, dikirim per batch 4 gambar ke llava. JANGAN kembalikan ke sampling frame atau resolusi kecil (320 px) — user menuntut tanpa kompromi.
- Prompt storyteller (`STORYTELLER_SYSTEM_INSTRUCTION`, Bahasa Indonesia kasual/gaul) JANGAN diubah/dihapus.
- Cloud cleanup: MP4 yang di-upload ke Gemini WAJIB dihapus via `finally` — retensi cloud maksimal 30 menit, tidak boleh menunggu 48 jam.

## Run Command
```
npx tsx src/index.ts --video "C:\Users\X\Downloads\getvid.mp4" --out <output_dir> --model gemini/gemini-3.6-flash
```

## Sinkronisasi Visual ↔ Narasi
- Kondisi saat ini = kondisi commit `e829622` (user anggap "aman"): analisis per-chunk 40 detik membuat scene sempit (3-8s) ≈ durasi narasi, sehingga visual pas dengan narasi.
- Eksperimen visual anchor (`visual_start_sec/visual_end_sec`) dan crop-awal sudah dicoba dan **di-revert** — jangan dipasang ulang tanpa perintah eksplisit user.

## TTS Runtime
- `.venv-omnivoice\Scripts\python.exe tools\omnivoice_manifest_tts_natural.py --manifest <m.json> --ref-audio data\reference\test_snippet.wav --ref-text data\reference\test_snippet.txt --output <n.wav>`
- Wajib env: `HF_HOME=E:\project\movie2short\.cache\huggingface`, `HF_HUB_OFFLINE=1`, `CUDA_VISIBLE_DEVICES=''` (CPU, karena VRAM host jenuh oleh aplikasi lain).
- Durasi natural → render dengan `--audio <n.wav> --scene-durations <n.json>` (narasi sebagai master timeline).
- TTS script punya `--lead <detik>` + `--tail <detik>` (default 5/5): jeda diam di AWAL dan AKHIR **setiap** clip TTS — **HANYA di file raw per-scene** (biar onset/ekor kalimat tidak halusinasi). Saat penggabungan (concat ke satu track), gap DIHAPUS — track final murni suara tanpa jeda panjang.

## Frontend Preview Persistence (tscaps-web)
- Setelah generate/Ambil, `Movie2ShortAction.attachShortVideo` menukar preview editor ke `final_short.mp4` (potongan per scene + audio TTS) dan **menyimpan referensi preview** (`savePreviewVideo`: jobId + artifactName + duration) di record project IndexedDB.
- `LoadProjectAction` saat buka project memanggil `previewVideoResolver` (fetch `/files/<jobId>/final_short.mp4` dari backend :3131) → preview short **persisten meski browser di-refresh**. Gagal fetch → fallback ke video sumber asli.
- Repository `save()` (autosave caption) WAJIB mempertahankan kolom `previewJobId/previewArtifactName/previewDuration` dari record lama — jangan di-null-kan.

## Known Issues / Env
- C: drive mudah penuh (pagefile 16–30 GB; RAM host 31,8 GB sering jenuh). Bersihkan cache aman (npm-cache, ms-playwright, Temp, browser/NVIDIA cache) bila `0.x GB`.
- Ollama kadang mati dan perlu restart (`Get-Process ollama* | Stop-Process -Force`, lalu `Start-Process ollama`).
- `vlm.ts` jangan dikembalikan ke sampling 2-frame; num_ctx 4096; llava:7b dijadikan CPU/VRAM kecil.
- gemma4:12b OOM di CPU — jangan dipakai.
- Jangan commit/push tanpa perintah eksplisit user.