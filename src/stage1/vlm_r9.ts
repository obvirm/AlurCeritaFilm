import { config } from "dotenv";
import { SceneOutput, VlmResponse, parseVlmJson } from "./vlm.js";
import { STORYTELLER_SYSTEM_INSTRUCTION } from "./vlm_gemini.js";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

config();

const R9_BASE_URL = process.env.R9_BASE_URL || "http://localhost:20128/v1";
const R9_API_KEY = process.env.R9_API_KEY || "";

/**
 * Analisis chunk via 9Router (OpenAI-compatible, localhost:20128) — mode MP4 LANGSUNG.
 * Video dikirim utuh per chunk (potong pakai `-c copy` = kualitas asli, resolusi penuh,
 * TANPA re-encode / tanpa filter), base64 data URI — persis yang bisa dilihat model
 * `ag/gemini-3.6-flash-high` (sudah terverifikasi: model melihat video + audio).
 */
export async function analyzeChunkWithR9Video(
  videoPath: string,
  chunkStartSec: number,
  chunkEndSec: number,
  modelName: string = "ag/gemini-3.6-flash-high",
  transcript?: string,
  previousContext?: string
): Promise<VlmResponse> {
  const chunkDuration = chunkEndSec - chunkStartSec;
  if (chunkDuration <= 0) return { scenes: [] };

  // 1. Potong chunk MP4 (stream copy — kualitas & resolusi asli, tanpa filter)
  const tmpFile = path.join(os.tmpdir(), `r9_chunk_${Date.now()}_${Math.floor(Math.random() * 1e6)}.mp4`);
  try {
    execSync(
      `ffmpeg -y -ss ${chunkStartSec.toFixed(3)} -t ${chunkDuration.toFixed(3)} -i "${videoPath}" -c copy -an "${tmpFile}"`,
      { stdio: "pipe" }
    );
  } catch (e: any) {
    console.warn(`[R9] potong chunk gagal: ${String(e.message).slice(0, 140)}`);
    return { scenes: [] };
  }

  try {
    const buf = fs.readFileSync(tmpFile);
    const b64 = buf.toString("base64");
    const mb = (b64.length / 1024 / 1024).toFixed(1);
    console.log(`[R9] chunk ${chunkStartSec}s-${chunkEndSec}s | MP4 langsung (${mb} MB base64)`);

    const transcriptContext = transcript?.trim()
      ? `\n\nBerikut adalah transkrip audio dari bagian video ini:\n${transcript.trim()}`
      : "";
    const previousContextBlock = previousContext?.trim()
      ? `\n\nKONTEKS SEBELUMNYA — lanjutkan cerita dengan adegan BARU, jangan ulangi:\n${previousContext.trim()}`
      : "";

    const prompt = `Analisis video MP4 ini yang menampilkan rentang waktu ${chunkStartSec}s - ${chunkEndSec}s (klip dari video penuh).

Tugas:
1. Pilih 1-3 momen paling penting yang BENAR-BENAR terjadi di klip ini (lihat gerakan, aksi, dialog, konflik).
2. Setiap scene durasi 3-8 detik.
3. description harus menyebut aksi visual konkret yang terlihat di video.
4. narration_text harus naskah voice-over Bahasa Indonesia kasual sesuai persona.
5. start_sec dan end_sec adalah detik GLOBAL dari awal video penuh (bukan offset klip) — hitung dari penanda waktu klip + ${chunkStartSec}.
${previousContextBlock}${transcriptContext}

Balas JSON SAJA (format contoh — JANGAN tiru teksnya):
{"scenes":[{"start_sec":1,"end_sec":3,"description":"aksi visual konkret","narration_text":"narasi kasual"}]}`;

    const response = await fetch(`${R9_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${R9_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        stream: false,
        messages: [
          { role: "system", content: STORYTELLER_SYSTEM_INSTRUCTION },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:video/mp4;base64,${b64}` } }
            ]
          }
        ],
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const msg = await response.text();
      console.warn(`[R9] ${response.status}: ${msg.slice(0, 200)}`);
      return { scenes: [] };
    }

    const data = await response.json() as any;
    const rawText = data.choices?.[0]?.message?.content || "";
    if (!rawText) {
      console.warn(`[R9] respons kosong (chunk ${chunkStartSec}s)`);
      return { scenes: [] };
    }

    const parsed = parseVlmJson(rawText);
    if (!parsed.scenes?.length) {
      console.warn(`[R9] JSON tidak bisa diparse (chunk ${chunkStartSec}s)`);
      return { scenes: [] };
    }

    // Timestamp global + sanitasi
    const scenes: Array<SceneOutput & { startSecGlobal: number; endSecGlobal: number }> = [];
    for (const s of parsed.scenes) {
      const start = Math.max(chunkStartSec, Number(s.start_sec) || chunkStartSec);
      const end = Math.min(chunkEndSec, Math.max(start + 1, Number(s.end_sec) || chunkEndSec));
      const text = String(s.narration_text || "").trim();
      if (!text || text === "Narasi menarik" || text === "Y" || text === "X") continue;
      scenes.push({ ...s, startSecGlobal: start, endSecGlobal: end });
    }

    console.log(`[R9] chunk ${chunkStartSec}s: ${scenes.length} scene (MP4 langsung)`);
    return { scenes };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
