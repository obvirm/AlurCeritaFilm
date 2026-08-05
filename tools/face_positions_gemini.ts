// Detect the main character's face position per scene using Gemini on the
// uploaded source MP4 (videoMetadata chunk queries, same pattern as the
// existing scene-analysis pipeline). No frame extraction needed.
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { uploadVideoToGemini, deleteVideoFromGemini, type GeminiVideoFile } from '../src/stage1/vlm_gemini.js';

config();

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';
const GEMINI_MODEL = 'gemini-2.5-flash';

const VIDEO = 'C:/Users/X/Downloads/getvid.mp4';
const MANIFEST = 'E:/project/movie2short/data/output/getvid_gemini_mp4/manifest.json';
const OUT = 'E:/project/movie2short/data/output/getvid_hook_cta/face_positions.json';

interface FacePosition {
  x: number;
  y: number;
  visible: boolean;
  confidence: 'high' | 'medium' | 'low';
}

function secondsToTimestamp(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function parseFaceJson(raw: string): FacePosition | null {
  const cleaned = raw.trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<FacePosition>;
    return toFacePosition(parsed);
  } catch { /* continue */ }
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return parseFaceJson(fence[1]);
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return parseFaceJson(cleaned.slice(firstBrace, lastBrace + 1));
  }
  return null;
}

function toFacePosition(parsed: Partial<FacePosition>): FacePosition | null {
  if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
  return {
    x: Math.max(0, Math.min(100, parsed.x)),
    y: Math.max(0, Math.min(100, parsed.y)),
    visible: parsed.visible !== false,
    confidence: (parsed.confidence as FacePosition['confidence']) || 'medium',
  };
}

let lastQuota = false; // true bila kegagalan terakhir karena 429 setelah backoff

async function queryFacePosition(
  video: GeminiVideoFile,
  startSec: number,
  endSec: number,
  apiKey: string,
  sceneLabel: string,
): Promise<FacePosition | null> {
  const prompt = `Tentukan posisi wajah KARAKTER UTAMA dalam klip video kartun ini (${secondsToTimestamp(startSec)}-${secondsToTimestamp(endSec)}).
Analisis keseluruhan klip dan berikan posisi PUSAT WAJAH karakter utama (bukan badan, bukan wajah karakter lain):
- x: persen dari tepi kiri gambar (0 = kiri, 100 = kanan)
- y: persen dari tepi atas gambar (0 = atas, 100 = bawah)
Jika tidak ada wajah karakter yang jelas terlihat dalam klip, set visible=false.
Balas HANYA satu objek JSON mentah, tanpa kalimat pengantar, tanpa markdown, tanpa teks lain. Contoh: {"x":50,"y":40,"visible":true,"confidence":"high"}`;

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [
        {
          fileData: { fileUri: video.uri, mimeType: video.mimeType },
          videoMetadata: { startOffset: `${startSec}s`, endOffset: `${endSec}s`, fps: 1 },
        },
        { text: prompt },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 200, responseMimeType: 'application/json' },
  };

  const url = `${GEMINI_API_BASE}/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const waits = [60_000, 120_000, 300_000]; // backoff saat 429 kuota/rate-limit
  let quotaExhausted = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (response.status === 429) {
        const waitMs = waits[attempt - 1] ?? 300_000;
        if (attempt < 3) {
          console.warn(`[face] ${sceneLabel}: 429; tunggu ${waitMs / 1000}s sebelum retry...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        quotaExhausted = true;
        break;
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`);
      }
      const data = (await response.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
      const parsed = parseFaceJson(rawText);
      lastQuota = false;
      if (!parsed) {
        console.warn(`[face] ${sceneLabel}: unparseable -> ${rawText.slice(0, 120)}`);
        return null;
      }
      console.log(`[face] ${sceneLabel}: x=${parsed.x} y=${parsed.y} visible=${parsed.visible} conf=${parsed.confidence}`);
      return parsed;
    } catch (error: any) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 5000));
        continue;
      }
      lastQuota = false;
      console.warn(`[face] ${sceneLabel} gagal: ${String(error.message).slice(0, 160)}`);
      return null;
    }
  }
  lastQuota = quotaExhausted;
  if (quotaExhausted) {
    console.warn(`[face] ${sceneLabel}: 429 persist (backoff habis); record null.`);
    return null;
  }
  return null;
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY belum diisi di file .env');

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const scenes = manifest.scenes as Array<{ id: string; start_sec: number; end_sec: number }>;
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error('Manifest tidak memiliki scenes');

  console.log(`[face] Uploading ${VIDEO} ke Gemini...`);
  const video = await uploadVideoToGemini(VIDEO);
  const results: Record<string, FacePosition | null> = {};
  let quotaStreak = 0;
  try {
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const label = `scene_${String(i + 1).padStart(2, '0')}(${sc.id})`;
      const pos = await queryFacePosition(video, sc.start_sec, sc.end_sec, apiKey, label);
      results[sc.id] = pos;
      if (lastQuota) quotaStreak++; else quotaStreak = 0;
      if (quotaStreak >= 3) {
        console.warn('[face] 3 scene beruntun 429 persist; hentikan batch dan laporkan parsial.');
        break;
      }
      await new Promise((r) => setTimeout(r, 3000)); // jeda antar scene, hindari spam
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ source: VIDEO, model: GEMINI_MODEL, results }, null, 2));
    const ok = Object.values(results).filter((r) => r?.visible).length;
    console.log(`[face] WROTE ${OUT}`);
    console.log(`[face] visible=${ok}/${scenes.length}`);
  } finally {
    await deleteVideoFromGemini(video);
  }
}

main().catch((error) => {
  console.error('[face] FAILED:', error);
  process.exitCode = 1;
});
