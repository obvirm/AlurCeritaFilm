# Catatan Model Gemini — Wajib Baca Sebelum Memilih VLM

> ⏰ **JANGAN PERCAYA LUPA**: Model Gemini API BERUBAH terus. Selalu cek
> https://ai.google.dev/gemini-api/docs/models (atau `sf_web_search`/`ninerouter`) SEBELUM
> menjalankan pipeline, jangan pakai model dari ingatan lama.
> Snapshot ini dibuat tanggal: **2026-08-06** (sumber: halaman resmi docs, "Last updated 2026-07-30").

## ✅ Model yang HARUS dipakai (terbaru & stabil per snapshot ini)

| Model | Endpoint API | Status | Input limit |
|---|---|---|---|
| **Gemini 3.6 Flash** | `gemini-3.6-flash` | **STABLE — pakai ini** | 1.048.576 token (1M) |
| Gemini 3.5 Flash | `gemini-3.5-flash` | Stable | 1M |
| Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` | Stable (lebih murah/cepat) | 1M |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | Stable | 1M |
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Preview | 1M |
| Gemini 3 Flash | `gemini-3-flash-preview` | Preview | 1M |

**Jangan otomatis pakai 2.5 lagi**: `gemini-2.5-flash` masih ada di API (mungkin masih bekerja)
TAPI itu model generasi lamа — pipeline di project ini dulunya default ke 2.5 dan sudah diganti ke `gemini-3.6-flash`.

### 🔁 Model lama yang masih eksis (tapi TIDAK pilihan utama)
- `gemini-2.5-flash` (`gemini-2.5-flash`) — stable, input 1M
- `gemini-2.5-flash-lite`, `gemini-2.5-pro` — stable
- `gemini-2.0-flash` — masa transisi/deprecation, hindari

## 🚦 Rate limit & error 429 (penting!)
- Limit diukur: **RPM** (request/menit), **TPM** (token/menit input), **RPD** (request/hari).
- **RPD reset tengah malam Pacific Time** — kalau kena 429 `RESOURCE_EXHAUSTED`, **hari itu juga biasanya tidak kembali**;
  tunggu reset harian / jangan paksa backoff pendek.
- Dibatasi **per project**, bukan per API key. Tier Free umumnya kecil.
- Kalau 429 persisten walaupun sudah menunggu lama: anggap kuota proyek habis →
  tunggu minimal beberapa jam, atau ganti project baru / pakai Ollama lokal (`llava:7b`) sebagai fallback.
- Spend-based limit (Tier 1+) dihitung rollед 10 menit → 429 sesaat bisa hilang dengan menunggu + mengecilkan context.

## ✅ Cara cek cepat (sebelum eksekusi)
```powershell
# Daftar model tersedia di project ini:
# https://ai.google.dev/gemini-api/docs/models  → bagian "Gemini 3"
# Atau uji hidup:
$key = (Select-String -Path .env -Pattern '^GEMINI_API_KEY=(.*)$').Matches[0].Groups[1].Value
Invoke-RestMethod -Uri "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=$key" `
  -Method Post -ContentType 'application/json' `
  -Body '{"contents":[{"parts":[{"text":"OK"}]}]}'
```

## 📌 Tempat model dipakai di repo ini
- `src/index.ts` → default `--model` (kini `gemini/gemini-3.6-flash`)
- `src/analyzer.ts` → fallback default `gemini/gemini-3.6-flash`
- CLI: `npx tsx src/index.ts --video <file> --out <dir> --model gemini/gemini-3.6-flash`
- Pipeline lokal (tanpa key API): `--model llava:7b` — kualitas lebih rendah, hanya cadangan.