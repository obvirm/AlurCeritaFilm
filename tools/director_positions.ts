#!/usr/bin/env node
/**
 * DIRECTOR — menentukan posisi kamera per scene (kiri/tengah/kanan) via llava:7b lokal.
 * Murni lokal, TIDAK memakai Gemini.
 *
 * Usage:
 *   DIRECTOR_VIDEO="C:\...\getvid.mp4" npx tsx tools/director_positions.ts \
 *     data/output/regenerated_gemini36/manifest.json data/output/regenerated_gemini36/camera_plan.json
 *
 * Output: [{ scene_id, frame_sec, position: "left"|"center"|"right" }]
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const manifestPath = process.argv[2];
const outPath = process.argv[3] || "data/output/camera_plan.json";
const tmpDir = path.join(path.dirname(outPath), "_director_frames");
const FRAMES_PER_REQUEST = 4;

interface DirScene { id: string; start_sec: number; end_sec: number }
interface DirPos { scene: string; frame_sec: number; position: string; raw: string }

function extractFrame(videoPath: string, startSec: number, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg",
      ["-nostdin", "-y", "-ss", startSec.toFixed(3), "-i", videoPath,
       "-frames:v", "1", "-q:v", "2", outFile],
      (e) => (e ? reject(e) : resolve()));
  });
}

async function askOllama(frames: { b64: string }[]): Promise<any[]> {
  const images = frames.map((f) => f.b64);
  const markers = frames.map((_, i) => `[img-${i}]`).join(" ");
  const resp = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "llava:7b",
      stream: false,
      messages: [{
        role: "user",
        content:
          `${markers}\n\nGambar-gambar ini berasal dari video kartun. ` +
          `Untuk SETIAP gambar [img-i], jawab di mana posisi KARAKTER UTAMA (tokoh kartun paling menonjol):\n` +
          `- "left"  jika tokoh di sepertiga kiri frame\n` +
          `- "center" jika di tengah\n` +
          `- "right" jika di sepertiga kanan\n` +
          `Jika ragu, pilih posisi yang paling terlihat jelas.\n\n` +
          `Balas JSON SAJA, urut dari [img-0] sampai [img-${frames.length - 1}]:\n` +
          `{"positions":[{"pos":1,"side":"left"},{"pos":2,"side":"center"}]}`,
      }],
      format: "json",
      options: { temperature: 0.2, num_ctx: 4096 },
    }),
  });
  if (!resp.ok) throw new Error(`ollama HTTP ${resp.status}`);
  const data = await resp.json();
  const txt: string = data?.message?.content || "";
  try { return JSON.parse(txt)?.positions || []; }
  catch {
    const m = txt.match(/\{[^]*"positions"\s*:\s*\[[^\]]*\]\s*\}/);
    if (m) { try { return JSON.parse(m[0])?.positions || []; } catch { return []; } }
    return [];
  }
}

async function main() {
  if (!manifestPath) throw new Error("usage: director_positions.ts <manifest.json> [out.json]");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const videoPath = process.env.DIRECTOR_VIDEO;
  const scenes: DirScene[] = manifest.scenes?.length ? manifest.scenes : manifest;
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error("scenes kosong");
  if (!videoPath) throw new Error("env DIRECTOR_VIDEO tidak diset");
  if (!fs.existsSync(videoPath)) throw new Error(`video tidak ada: ${videoPath}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`[Director] ${scenes.length} scene | video: ${videoPath}`);
  const plan: DirPos[] = [];
  const batches = [];
  for (let i = 0; i < scenes.length; i += FRAMES_PER_REQUEST) {
    batches.push(scenes.slice(i, i + FRAMES_PER_REQUEST));
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const frames = [];
    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const frameSec = s.start_sec + (s.end_sec - s.start_sec) / 2;
      const fp = path.join(tmpDir, `scene_${String(s.id).replace(/[^\w]/g, "_")}.jpg`);
      await extractFrame(videoPath, frameSec, fp);
      frames.push({ b64: fs.readFileSync(fp).toString("base64") });
    }

    let positions: any[] = [];
    try { positions = await askOllama(frames); }
    catch (e) { console.warn(`  batch ${b + 1} gagal: ${String(e).slice(0, 90)}`); }

    // map pos (1-based) -> side; fallback urutan jika model balas tanpa pos
    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      let side = "";
      for (const p of positions) {
        if (Number(p.pos) === j + 1) { side = String(p.side || ""); break; }
      }
      if (!side && positions[j]) side = String(positions[j].side || "");
      const norm = ["left", "center", "right"].includes(side) ? side : "center";
      plan.push({
        scene: s.id,
        frame_sec: s.start_sec + (s.end_sec - s.start_sec) / 2,
        position: norm,
        raw: side || "-",
      });
      console.log(`  ${s.id} -> ${norm}${side !== norm ? " (fallback center)" : ""}`);
    }
    console.log(`[Director] batch ${b + 1}/${batches.length} selesai`);
  }

  fs.writeFileSync(outPath, JSON.stringify({
    plan, source: "llava:7b", generated: new Date().toISOString(),
  }, null, 2));
  console.log(`\n[Done] ${outPath} — ${plan.length} scene`);
}

main().catch((e) => { console.error(e); process.exit(1); });