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
- **Default: `gemini/gemini-3.6-flash`** (model Gemini terbaru, stable). Jangan pakai 2.5 tanpa alasan.
- Gemini menganalisis MP4 penuh (semua frame + audio) — kualitas paling tinggi.
- Fallback lokal saat kuota API habis/429: `--model llava:7b` (kualitas jauh lebih rendah, hanya cadangan).
- Pipeline lokal sudah dipaksa **semua frame (tiap 2 detik) resolusi penuh**, dikirim per batch 4 gambar ke llava. JANGAN kembalikan ke sampling frame atau resolusi kecil (320 px) — user menuntut tanpa kompromi.
- Prompt storyteller (`STORYTELLER_SYSTEM_INSTRUCTION`, Bahasa Indonesia kasual/gaul) JANGAN diubah/dihapus.
- Cloud cleanup: MP4 yang di-upload ke Gemini WAJIB dihapus via `finally` — retensi cloud maksimal 30 menit, tidak boleh menunggu 48 jam.

## Run Command
```
npx tsx src/index.ts --video "C:\Users\X\Downloads\getvid.mp4" --out <output_dir> --model gemini/gemini-3.6-flash
```

## TTS Runtime
- `.venv-omnivoice\Scripts\python.exe tools\omnivoice_manifest_tts_natural.py --manifest <m.json> --ref-audio data\reference\test_snippet.wav --ref-text data\reference\test_snippet.txt --output <n.wav>`
- Wajib env: `HF_HOME=E:\project\movie2short\.cache\huggingface`, `HF_HUB_OFFLINE=1`, `CUDA_VISIBLE_DEVICES=''` (CPU, karena VRAM host jenuh oleh aplikasi lain).
- Durasi natural → render dengan `--audio <n.wav> --scene-durations <n.json>` (narasi sebagai master timeline).

## Known Issues / Env
- C: drive mudah penuh (pagefile 16–30 GB; RAM host 31,8 GB sering jenuh). Bersihkan cache aman (npm-cache, ms-playwright, Temp, browser/NVIDIA cache) bila `0.x GB`.
- Ollama kadang mati dan perlu restart (`Get-Process ollama* | Stop-Process -Force`, lalu `Start-Process ollama`).
- `vlm.ts` jangan dikembalikan ke sampling 2-frame; num_ctx 4096; llava:7b dijadikan CPU/VRAM kecil.
- gemma4:12b OOM di CPU — jangan dipakai.
- Jangan commit/push tanpa perintah eksplisit user.