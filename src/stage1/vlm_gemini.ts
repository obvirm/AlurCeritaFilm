import fs from "fs/promises";
import { openAsBlob } from "fs";
import path from "path";
import { config } from "dotenv";
import { SceneOutput, VlmResponse } from "./vlm.js";

config();

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_MODEL = "gemini-2.5-flash";
const VIDEO_PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

export const STORYTELLER_SYSTEM_INSTRUCTION = `PERAN
Kamu adalah storyteller video short Indonesia yang energik, ekspresif, humoris, dan terdengar seperti sedang bercerita seru ke teman dekat. Narasi harus enak dibacakan sebagai voice-over TikTok/YouTube Shorts.

PRIORITAS UTAMA
- Akurasi audiovisual selalu lebih penting daripada komedi atau gaya bahasa.
- Gunakan hanya tokoh, aksi, lokasi, dialog, dan hubungan sebab-akibat yang didukung video, audio, atau transcript pendamping.
- Jangan mengarang kejadian untuk membuat cerita lebih lucu. Jika detail tidak jelas, gunakan deskripsi netral.
- Jaga kesinambungan dengan konteks sebelumnya dan jangan mengulang informasi yang sama.

GAYA NARASI
- Gunakan Bahasa Indonesia sehari-hari yang kasual, cepat, jelas, dan tidak kaku.
- Fokus pada aksi, konflik, reaksi karakter, dan bagian paling menarik; lewati detail yang membosankan.
- Sisipkan komentar lucu, heran, atau sarkas ringan hanya jika cocok dengan kejadian.
- Gunakan partikel seperti "nah", "coy", "dong", "wak", "pak", "bang", "gila", "bisa-bisanya", dan "banget" secara natural dan hemat. Jangan menumpuk slang atau memakainya di setiap kalimat.
- Boleh memakai dialog langsung pendek jika ucapan karakter benar-benar terdengar atau maknanya jelas dari konteks.
- Jangan memakai bahasa formal, gaya berita, clickbait palsu, makian berat, atau humor yang menutupi jalan cerita.
- Jangan membuka jawaban dengan kalimat meta seperti "Tentu", "Berikut hasilnya", atau "Narasi:".

STRUKTUR
- Awali momen pertama dengan hook yang langsung masuk ke situasi atau konflik.
- Gunakan transisi singkat dan bervariasi antar kejadian.
- Tekankan bagian absurd atau klimaks tanpa melebih-lebihkan fakta.
- Saat mencapai akhir cerita, tutup dengan kesimpulan singkat dan santai.

FORMAT VOICE-OVER
- Setiap narration_text terdiri dari 1-2 kalimat ringkas.
- Kalimat harus mudah diucapkan, tidak kepanjangan, dan tetap bisa dipahami tanpa membaca description.
- description bersifat faktual dan konkret; narration_text bersifat kasual dan menghibur.`;

export interface GeminiVideoFile {
  name: string;
  uri: string;
  mimeType: string;
}

interface GeminiFileResponse {
  file?: {
    name?: string;
    displayName?: string;
    uri?: string;
    mimeType?: string;
    sizeBytes?: string;
    state?: string;
    error?: { message?: string };
  };
}

function requireApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY belum diisi di file .env");
  }
  return apiKey;
}

function getVideoMimeType(videoPath: string): string {
  switch (path.extname(videoPath).toLowerCase()) {
    case ".mov": return "video/quicktime";
    case ".mpeg":
    case ".mpg": return "video/mpeg";
    case ".avi": return "video/avi";
    case ".webm": return "video/webm";
    case ".wmv": return "video/wmv";
    case ".3gp": return "video/3gpp";
    default: return "video/mp4";
  }
}

async function readGeminiError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message || body;
  } catch {
    return body;
  }
}

async function getUploadedFile(name: string, apiKey: string): Promise<GeminiFileResponse["file"]> {
  const response = await fetch(`${GEMINI_API_BASE}/v1beta/${name}`, {
    headers: { "x-goog-api-key": apiKey }
  });
  if (!response.ok) {
    throw new Error(`Gemini file status ${response.status}: ${await readGeminiError(response)}`);
  }
  const data = await response.json() as GeminiFileResponse["file"] & GeminiFileResponse;
  // Files API GET returns the file object directly; upload finalize wraps it in `file`.
  return data.file || data;
}

/** Uploads the source MP4 once so every analysis request can reuse the same video. */
export async function uploadVideoToGemini(videoPath: string): Promise<GeminiVideoFile> {
  const apiKey = requireApiKey();
  const absolutePath = path.resolve(videoPath);
  const stat = await fs.stat(absolutePath);
  const mimeType = getVideoMimeType(absolutePath);

  console.log(`[Gemini] Uploading new MP4 for this session (${(stat.size / 1024 / 1024).toFixed(1)} MB)...`);

  const startResponse = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(stat.size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: path.basename(absolutePath) } })
  });

  if (!startResponse.ok) {
    throw new Error(`Gemini upload init ${startResponse.status}: ${await readGeminiError(startResponse)}`);
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini tidak mengembalikan upload URL");

  const videoBlob = await openAsBlob(absolutePath, { type: mimeType });
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(stat.size),
      "Content-Type": mimeType,
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: videoBlob
  });

  if (!uploadResponse.ok) {
    throw new Error(`Gemini upload ${uploadResponse.status}: ${await readGeminiError(uploadResponse)}`);
  }

  const uploaded = await uploadResponse.json() as GeminiFileResponse;
  const fileName = uploaded.file?.name;
  if (!fileName) throw new Error("Respons upload Gemini tidak memiliki nama file");

  try {
    const deadline = Date.now() + VIDEO_PROCESSING_TIMEOUT_MS;
    let file = uploaded.file;
    while (file?.state === "PROCESSING" || !file?.state) {
      if (Date.now() >= deadline) throw new Error("Gemini terlalu lama memproses video");
      console.log("[Gemini] Video masih diproses, cek lagi dalam 5 detik...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      file = await getUploadedFile(fileName, apiKey);
    }

    if (file?.state === "FAILED") {
      throw new Error(`Gemini gagal memproses video: ${file.error?.message || "unknown error"}`);
    }
    if (file?.state !== "ACTIVE" || !file.uri) {
      throw new Error(`Status file Gemini tidak valid: ${file?.state || "unknown"}`);
    }

    console.log("[Gemini] MP4 aktif dan siap dianalisis.");
    return {
      name: fileName,
      uri: file.uri,
      mimeType: file.mimeType || mimeType
    };
  } catch (error) {
    try {
      await deleteGeminiFileByName(fileName, apiKey);
      console.log(`[Gemini] Upload gagal dipakai; cloud video deleted: ${fileName}`);
    } catch (cleanupError) {
      console.warn(`[Gemini] Cleanup upload gagal: ${(cleanupError as Error).message}`);
    }
    throw error;
  }
}

async function deleteGeminiFileByName(name: string, apiKey: string): Promise<void> {
  const response = await fetch(`${GEMINI_API_BASE}/v1beta/${name}`, {
    method: "DELETE",
    headers: { "x-goog-api-key": apiKey }
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Gemini delete ${response.status}: ${await readGeminiError(response)}`);
  }
}

export async function deleteVideoFromGemini(video: GeminiVideoFile): Promise<void> {
  await deleteGeminiFileByName(video.name, requireApiKey());
  console.log(`[Gemini] Cloud video deleted: ${video.name}`);
}

function parseVlmJson(raw: string): VlmResponse {
  try { return JSON.parse(raw) as VlmResponse; } catch {}

  const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]) as VlmResponse; } catch {}
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as VlmResponse; } catch {}
  }

  console.warn("[Gemini] JSON tidak bisa diparse, chunk dilewati.");
  return { scenes: [] };
}

function normalizeScenes(scenes: unknown, chunkStartSec: number, chunkEndSec: number): SceneOutput[] {
  if (!Array.isArray(scenes)) return [];
  const chunkDuration = chunkEndSec - chunkStartSec;

  return scenes
    .map((value, index): SceneOutput | null => {
      if (!value || typeof value !== "object") return null;
      const scene = value as Partial<SceneOutput>;
      const relativeStart = Math.max(0, Number(scene.start_sec) || 0);
      const relativeEnd = Math.min(chunkDuration, Math.max(relativeStart + 1, Number(scene.end_sec) || relativeStart + 3));
      if (relativeStart >= chunkDuration || relativeEnd <= relativeStart) return null;

      const description = String(scene.description || "").trim();
      const narration = String(scene.narration_text || "").trim();
      if (!description || !narration) return null;

      return {
        id: `scene_${index + 1}`,
        start_sec: Number((chunkStartSec + relativeStart).toFixed(3)),
        end_sec: Number((chunkStartSec + relativeEnd).toFixed(3)),
        description,
        narration_text: narration
      };
    })
    .filter((scene): scene is SceneOutput => scene !== null);
}

function secondsToTimestamp(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Analyzes one clipped time range from the uploaded MP4, including its audio stream. */
export async function analyzeVideoChunkWithGemini(
  video: GeminiVideoFile,
  chunkStartSec: number,
  chunkEndSec: number,
  modelName: string = GEMINI_MODEL,
  transcript?: string,
  previousContext?: string
): Promise<VlmResponse> {
  const apiKey = requireApiKey();
  const chunkDuration = chunkEndSec - chunkStartSec;
  const transcriptContext = transcript?.trim()
    ? `\n\nTRANSKRIP WHISPER UNTUK KLIP INI:\n${transcript.trim()}`
    : "";
  const previousContextBlock = previousContext?.trim()
    ? `\n\nKONTEKS CERITA SEBELUMNYA (jangan diulang):\n${previousContext.trim()}`
    : "";

  const prompt = `Analisis klip ${secondsToTimestamp(chunkStartSec)}-${secondsToTimestamp(chunkEndSec)} dari video asli dengan menggabungkan VISUAL dan AUDIO.
Transcript Whisper, jika tersedia, hanya bantuan untuk mengenali ucapan. Jika transcript bertentangan dengan video/audio, prioritaskan video/audio.

Tugas:
1. Pilih 1-3 momen penting yang benar-benar terjadi dan layak masuk rangkaian cerita.
2. Setiap scene idealnya 3-8 detik.
3. description harus menyebut aksi visual konkret, bukan interpretasi generik atau placeholder.
4. narration_text harus menjadi naskah voice-over final sesuai persona system instruction.
5. Jangan mengarang nama, dialog, lokasi, motif, atau kejadian.
6. start_sec dan end_sec wajib berupa detik relatif dari awal klip ini, antara 0 dan ${chunkDuration.toFixed(3)}. Jangan keluarkan timestamp global.
7. Jangan mengulang narasi dari konteks sebelumnya.
${previousContextBlock}${transcriptContext}

Balas JSON saja dengan struktur persis berikut:
{"scenes":[{"id":"scene_1","start_sec":0,"end_sec":5,"description":"aksi visual konkret","narration_text":"narasi voice-over final"}]}`;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: STORYTELLER_SYSTEM_INSTRUCTION }]
    },
    contents: [{
      role: "user",
      parts: [
        {
          fileData: { fileUri: video.uri, mimeType: video.mimeType },
          videoMetadata: {
            startOffset: `${chunkStartSec}s`,
            endOffset: `${chunkEndSec}s`,
            fps: 1
          }
        },
        { text: prompt }
      ]
    }],
    generationConfig: {
      temperature: 0.45,
      maxOutputTokens: 2048,
      responseMimeType: "application/json"
    }
  };

  const url = `${GEMINI_API_BASE}/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const message = await readGeminiError(response);
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 3) {
          const delayMs = attempt * 10000;
          console.warn(`[Gemini] ${response.status}; retry ${attempt}/2 dalam ${delayMs / 1000}s.`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        throw new Error(`Gemini generateContent ${response.status}: ${message}`);
      }

      const data = await response.json() as any;
      const rawText = data.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || "")
        .join("") || "";
      if (!rawText) throw new Error("Gemini mengembalikan respons kosong");

      const parsed = parseVlmJson(rawText);
      return { scenes: normalizeScenes(parsed.scenes, chunkStartSec, chunkEndSec) };
    } catch (error: any) {
      if (attempt < 3 && !(error instanceof Error && error.message.startsWith("Gemini generateContent 4"))) {
        console.warn(`[Gemini] Request gagal; retry ${attempt}/2: ${String(error.message).slice(0, 120)}`);
        await new Promise(resolve => setTimeout(resolve, attempt * 5000));
        continue;
      }
      console.warn(`[Gemini] Chunk ${chunkStartSec}-${chunkEndSec}s gagal: ${String(error.message).slice(0, 200)}`);
      return { scenes: [] };
    }
  }

  return { scenes: [] };
}
