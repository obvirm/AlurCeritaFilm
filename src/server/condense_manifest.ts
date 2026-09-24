/**
 * Condense recap — pilih subset scene kunci + padatkan narasi ke budget detik.
 * Dipanggil server (runPipeline) saat targetMinutes > 0.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs src/server/condense_manifest.ts
 *   <manifest.json> <condensed.json> --seconds <N> [--model <m>] [--lead 5] [--tail 5]
 */
import { config } from "dotenv";
import fs from "fs/promises";
import path from "path";

config();

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "http://localhost:20128/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Kecepatan bicara terukur (Patrick ±21-24 char/detik) — margin aman pakai 20.
const CHARS_PER_SEC = 20;

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

async function main() {
  const [manifestPath, condensedPath] = process.argv.slice(2);
  const seconds = Number(arg("--seconds", "60"));
  const model = arg("--model") || process.env.MODEL_NAME || "ag/gemini-3.6-flash-high";
  if (!manifestPath || !condensedPath || !(seconds > 0)) {
    console.error("usage: condense_manifest.ts <manifest.json> <condensed.json> --seconds <N> [--model <m>]");
    process.exit(1);
  }

  const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8"));
  const scenes = manifest.scenes || [];
  if (!scenes.length) throw new Error("Manifest kosong (0 scene)");

  const budgetChars = Math.floor(seconds * CHARS_PER_SEC);
  const digest = scenes
    .map((s: any) => `[${s.start_sec}s-${s.end_sec}s] ${s.description || ""} || ${s.narration_text || ""}`)
    .join("\n");

  const prompt = `Kamu merangkum video panjang jadi SATU short full-spoiler berdurasi ±${seconds} detik.
Total narration_text SEMUA scene yang kamu pilih (digabung) MAKSIMAL ${budgetChars} karakter.

Aturan:
1. Pilih subset scene KRONOLOGIS (awal->tengah->klimaks->akhir), buang yang tidak penting.
2. Padatkan tiap narration_text (1 kalimat pendek) tapi pertahankan fakta & gaya narasi asli.
3. start_sec/end_sec pakai angka ASLI dari input (jangan ubah).
4. subject_x_pct ikutkan kalau ada.

Daftar scene (format [mulai-akhir] deskripsi || narasi):
${digest}

Balas JSON SAJA: {"scenes":[{"id":"...","start_sec":0,"end_sec":0,"description":"...","narration_text":"...","subject_x_pct":50}]}`;

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
    }),
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`LLM condense HTTP ${response.status}: ${errBody.slice(0, 200)}`);
  }
  const data = (await response.json()) as any;
  const raw: string = data.choices?.[0]?.message?.content || "";
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("LLM tidak mengembalikan JSON");
  const parsed = JSON.parse(raw.slice(first, last + 1));
  const out = (parsed.scenes || []).filter((s: any) => String(s.narration_text || "").trim().length > 0);
  if (!out.length) throw new Error("LLM menghasilkan 0 scene");

  await fs.mkdir(path.dirname(path.resolve(condensedPath)), { recursive: true });
  await fs.writeFile(
    path.resolve(condensedPath),
    JSON.stringify({ videoFile: manifest.videoFile, scenes: out }, null, 2)
  );
  const totalChars = out.map((s: any) => String(s.narration_text).length).reduce((a: number, b: number) => a + b, 0);
  console.log(`[condense] ${out.length}/${scenes.length} scene, ${totalChars}/${budgetChars} chars -> ${condensedPath}`);
}

main().catch((e) => {
  console.error(`[condense] ERROR: ${e.message}`);
  process.exit(1);
});
