import { Ollama } from "ollama";
import { ExtractedFrame } from "./frameExtractor.js";

export interface SceneOutput {
  id: string;
  start_sec: number;
  end_sec: number;
  description: string;
  narration_text: string;
}

export interface VlmResponse {
  scenes: SceneOutput[];
}

export function parseVlmJson(raw: string): VlmResponse {
  try { return JSON.parse(raw) as VlmResponse; } catch {}

  const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]) as VlmResponse; } catch {}
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as VlmResponse; } catch {}
  }

  console.warn("Failed to parse VLM JSON, using fallback");
  return { scenes: [] };
}

function assignSceneIds(scenes: SceneOutput[]): SceneOutput[] {
  return scenes.map((scene, index) => ({ ...scene, id: `scene_${index + 1}` }));
}

export async function analyzeChunkWithOllama(
  frames: ExtractedFrame[],
  chunkStartSec: number,
  chunkEndSec: number,
  modelName: string = "gemma4:12b",
  transcript?: string,
  previousContext?: string
): Promise<VlmResponse> {
  if (!frames || frames.length === 0) return { scenes: [] };

  // Kirim SEMUA frame resolusi penuh (tanpa sampling 2-frame).
  // Bagi ke sub-batch agar setiap request muat di context model:
  // llava image -> 576 token; num_ctx 4096 -> maks ~6 gambar + prompt + jawaban.
  const IMAGES_PER_REQUEST = 4; // 4 gambar full-res ~3.3k token muat di num_ctx 4096
  const batchScenes: Array<SceneOutput & { startSecGlobal: number; endSecGlobal: number }> = [];
  const ollama = new Ollama();

  const transcriptContext = transcript
    ? `\n\nBerikut adalah transkrip audio dari bagian video ini:\n${transcript}`
    : "";

  const previousContextBlock = previousContext
    ? `\n\nKONTEKS SEBELUMNYA — lanjutkan cerita dengan adegan BARU:\n${previousContext}`
    : "";

  for (let i = 0; i < frames.length; i += IMAGES_PER_REQUEST) {
    const batch = frames.slice(i, i + IMAGES_PER_REQUEST);
    const images = batch.map((f) => f.base64);
    const imgMarkers = batch.map((_, bi) => `[img-${bi}]`).join(" ");
    const batchStartSec = batch[0].timestamp;
    const batchEndSec = batch[batch.length - 1].timestamp;

    const prompt = `${imgMarkers}

Anda adalah ahli analisis video. Analisis gambar-gambar di atas dari rentang waktu ${chunkStartSec}s - ${chunkEndSec}s (klip ini bagian ${i / IMAGES_PER_REQUEST + 1} dari ${Math.ceil(frames.length / IMAGES_PER_REQUEST)} klip frame).

Tugas Anda:
1. Identifikasi 1-2 scene pendek yang terjadi dalam gambar-gambar ini
2. Setiap scene durasi 2-5 detik
3. Tulis deskripsi visual singkat dalam Bahasa Indonesia
4. Tulis narasi 1 kalimat engaging dalam Bahasa Indonesia gaul/sehari-hari
5. start_sec dan end_sec adalah offset dari AWAL CHUNK ini
${previousContextBlock}${transcriptContext}

Balas JSON SAJA (format contoh — JANGAN tiru teksnya):
{"scenes":[{"start_sec":1,"end_sec":3,"description":"X","narration_text":"Y"}]}`;

    try {
      const response = await ollama.chat({
        model: modelName,
        messages: [{ role: "user", content: prompt, images }],
        format: "json",
        options: { temperature: 0.6, num_ctx: 4096 }
      });

      const parsed = parseVlmJson(response.message.content);
      if (parsed.scenes?.length) {
        for (const s of parsed.scenes) {
          const start = chunkStartSec + Math.max(0, Number(s.start_sec) || 0);
          const end = chunkStartSec + Math.max(1, Number(s.end_sec) || 3);
          if (end <= start) continue;
          batchScenes.push({
            ...s,
            startSecGlobal: start,
            endSecGlobal: Math.min(end, chunkEndSec)
          });
        }
      }
      console.log(`[VLM] chunk ${chunkStartSec}s: batch ${i / IMAGES_PER_REQUEST + 1}/${Math.ceil(frames.length / IMAGES_PER_REQUEST)} -> ${parsed.scenes?.length ?? 0} scene`);
    } catch (error: any) {
      console.warn(`VLM chunk batch failed: ${String(error.message).slice(0, 120)}`);
    }
  }

  // Gabungkan hasil semua batch, urutkan, deduplikasi overlap
  const sorted = batchScenes.sort((a, b) => a.startSecGlobal - b.startSecGlobal);
  const deduped: Array<SceneOutput & { startSecGlobal: number; endSecGlobal: number }> = [];
  for (const s of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && s.startSecGlobal < last.endSecGlobal) continue; // skip overlap
    const text = String(s.narration_text || "").trim();
    if (!text || text === "Narasi menarik" || text === "Y" || text === "X") continue; // buang placeholder tiruan
    deduped.push({
      ...s,
      start_sec: s.startSecGlobal,
      end_sec: s.endSecGlobal,
      id: `scene_${deduped.length + 1}`
    });
  }

  return { scenes: deduped };
}

export async function analyzeScenesWithOllama(
  frames: ExtractedFrame[],
  transcript: string,
  modelName: string = "gemma4:12b"
): Promise<VlmResponse> {
  const ollama = new Ollama();
  const images = frames.map(f => f.base64);
  const imgMarkers = frames.map((_, i) => `[img-${i}]`).join(" ");

  const prompt = `${imgMarkers}

You are an expert video editor. Analyze these frames from a video.
Divide into key scenes for a vertical short video. Write 1-sentence narration in INDONESIAN.

Respond JSON only:
{"scenes":[{"id":"scene_1","start_sec":0,"end_sec":10,"description":"Visual description","narration_text":"Narasi Indonesia"}]}`;

  try {
    const response = await ollama.chat({
      model: modelName,
      messages: [{ role: "user", content: prompt, images }],
      format: "json",
      options: { temperature: 0.6 }
    });

    const parsed = parseVlmJson(response.message.content);
    parsed.scenes = assignSceneIds(parsed.scenes);
    console.log(`[VLM] Parsed ${parsed.scenes.length} scenes`);
    return parsed;
  } catch (error: any) {
    throw new Error(`VLM analysis failed: ${String(error)}`);
  }
}
