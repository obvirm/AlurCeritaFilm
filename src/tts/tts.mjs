#!/usr/bin/env node
/**
 * HTTP TTS — postur audiocpp_manifest_tts.mjs, tetapi panggil HTTP server
 * (http://127.0.0.1:8080/v1/audio/speech) alih-alih spawn audiocpp_cli.
 *
 * Output IDENTIK dengan versi CLI:
 *   <outdir>/narration_scenes_natural/scene_XXXX.wav   (raw per scene, DENGAN gap lead/tail)
 *   <output>.wav                                       (concat semua scene TANPA gap)
 *   <output>.json                                      (metadata + durasi natural per scene)
 */
import fs from "node:fs";
import path from "node:path";


// WAV mono PCM16 helpers (copied from audiocpp_manifest_tts.mjs)
function parseWavBuffer(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`Bukan WAV`);
  let off = 12;
  let channels = 1;
  let rate = 0;
  let frames = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(off + 10);
      rate = buf.readUInt32LE(off + 12);
    } else if (id === "data") {
      frames = buf.subarray(off + 8, off + 8 + size);
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!frames) throw new Error(`Tidak ada chunk data di WAV`);
  if (channels !== 1) throw new Error(`Harus mono, dapat ${channels} channel`);
  return { rate, frames };
}

function parseWav(file) {
  return parseWavBuffer(fs.readFileSync(file));
}

function makeWavBuffer(rate, frames) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + frames.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(frames.length, 40);
  return Buffer.concat([header, frames]);
}

function writeWav(file, rate, frames) {
  fs.writeFileSync(file, makeWavBuffer(rate, frames));
}

const SILENCE_2S = (n) => Buffer.alloc(n * 2, 0); // 16-bit silence

// ---------------------------------------------------------------------------
// Parse CLI args (same interface as audiocpp_manifest_tts.mjs)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, "");
    a[k] = argv[i + 1];
  }
  return a;
}

// ---------------------------------------------------------------------------
// HTTP TTS helper — calls /v1/audio/speech, returns Buffer (WAV)
// ---------------------------------------------------------------------------
async function httpTts(text, { host = "127.0.0.1", port = 8080, model = "higgs-tts-q4", language = "Indonesian", maxChunkChars = 200, voiceRef = null, referenceText = null } = {}) {
  const url = `http://${host}:${port}/v1/audio/speech`;
  // Split long text into chunks — respect word boundaries
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxChunkChars) {
      chunks.push(remaining);
      break;
    }
    // Try to find a good break point: prefer period/exclamation/question, then space
    let breakAt = -1;
    for (const sep of ['.', '!', '?']) {
      const idx = remaining.lastIndexOf(sep, maxChunkChars);
      if (idx > maxChunkChars * 0.4) { breakAt = idx; break; }
    }
    if (breakAt < 0) {
      // Find nearest space
      breakAt = remaining.lastIndexOf(' ', maxChunkChars);
    }
    if (breakAt < maxChunkChars * 0.3) breakAt = maxChunkChars;
    chunks.push(remaining.slice(0, breakAt + 1).trim());
    remaining = remaining.slice(breakAt + 1).trim();
  }

  // Format dok audio C++ (app/server/README.md): voice_ref {type,path|data}
  // + reference_text. Path host dipakai bila bisa (tanpa batas ukuran —
  // server tolak base64 >5 MiB); base64 hanya untuk file kecil.
  const makeBody = (inputText) => {
    const body = { model, input: inputText, response_format: "wav", language };
    if (voiceRef) body.voice_ref = voiceRef;
    if (voiceRef && referenceText) body.reference_text = referenceText;
    return JSON.stringify(body);
  };

  async function singleTts(text, retries = 6) {
    for (let attempt = 0; attempt < retries; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: makeBody(text),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const errBody = await res.text().catch(() => "");
      if (errBody.includes("max_tokens")) return null;
      if (errBody.includes("allocat") || errBody.includes("KV cache") || errBody.includes("cudaMalloc") || errBody.includes("out of memory") || errBody.includes("OOM")) {
        console.log(`[HTTP-TTS] VRAM error, waiting 15s before retry (${attempt + 1}/${retries})...`);
        await new Promise((ok) => setTimeout(ok, 15000));
        continue;
      }
      throw new Error(`HTTP TTS ${res.status}: ${errBody.slice(0, 200)}`);
    }
    throw new Error(`HTTP TTS failed after ${retries} VRAM retries`);
  }

  async function ttsWithRetry(text, depth = 0) {
    if (text.trim().length === 0) return Buffer.alloc(0);
    const buf = await singleTts(text);
    if (buf) return buf;
    if (depth >= 3) throw new Error(`HTTP TTS max_tokens after 3 splits: "${text.slice(0, 50)}..."`);
    await new Promise((ok) => setTimeout(ok, 3000));
    const mid = Math.floor(text.length / 2);
    const space = text.lastIndexOf(" ", mid);
    const splitAt = space > mid * 0.5 ? space : mid;
    console.log(`[HTTP-TTS] max_tokens, splitting chunk (${text.length} chars) -> two halves`);
    const left = await ttsWithRetry(text.slice(0, splitAt), depth + 1);
    const right = await ttsWithRetry(text.slice(splitAt), depth + 1);
    return joinWavBuffers([left, right]);
  }

  if (chunks.length === 1) {
    const buf = await ttsWithRetry(text);
    return buf;
  }

  // Multiple chunks — gabung PCM-nya (decode tiap WAV dulu).
  // Concat mentah file WAV menumpuk header 44-byte di tengah buffer,
  // bikin parseWav cuma baca chunk pertama (sisa kalimat hilang).
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[HTTP-TTS] Chunk ${i + 1}/${chunks.length}: ${chunks[i].slice(0, 40)}...`);
    const buf = await ttsWithRetry(chunks[i]);
    parts.push(buf);
    if (i < chunks.length - 1) await new Promise((ok) => setTimeout(ok, 2000));
  }
  return joinWavBuffers(parts);
}

// Decode tiap buffer WAV -> gabung frames PCM -> satu WAV utuh.
function joinWavBuffers(buffers) {
  const framesList = [];
  let rate = 24000;
  for (const b of buffers) {
    if (!b || b.length === 0) continue;
    const { rate: r, frames } = parseWavBuffer(b);
    rate = r;
    framesList.push(frames);
  }
  return makeWavBuffer(rate, Buffer.concat(framesList));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const manifestPath = args.manifest;
  const outputPath = args.output;
  const hostPort = (args.server || "http://127.0.0.1:8080").replace(/^https?:\/\//, "");
  const [host, portStr] = hostPort.split(":");
  const port = Number(portStr) || 8080;
  const language = args.language || "Indonesian";
  const lead = Number(args.lead ?? 5);
  const tail = Number(args.tail ?? 5);
  const maxChunkChars = Number(args.maxChunkChars) || 200;
  const ttsModel = args.model || process.env.TTS_MODEL || "higgs-tts-q4";
  const voiceRefPath = args.voiceRef || args["voice-ref"] || process.env.AUDIOCPP_VOICE_REF;
  const hostDataDir = (process.env.HOST_DATA_DIR || "").replace(/\\/g, "/").replace(/\/$/, "");

  // Voice ref: file apa pun pilihan user. Dok: {type:path} bila path host
  // diketahui (tanpa batas ukuran), else base64 untuk file kecil (limit 5 MiB).
  // Transcript pendamping: <nama>.txt atau <nama>.wav.txt.
  let voiceRef = null;
  let referenceText = null;
  if (voiceRefPath) {
    if (!fs.existsSync(voiceRefPath)) {
      throw new Error(`Voice reference file not found: ${voiceRefPath}`);
    }
    const stat = fs.statSync(voiceRefPath);
    console.log(`[HTTP-TTS] Using voice reference: ${voiceRefPath} (${(stat.size/1024).toFixed(0)}KB)`);
    if (hostDataDir && voiceRefPath.startsWith("/app/data")) {
      voiceRef = { type: "path", path: hostDataDir + voiceRefPath.slice("/app/data".length) };
    } else if (stat.size <= 4 * 1024 * 1024) {
      voiceRef = { type: "base64", data: fs.readFileSync(voiceRefPath).toString("base64") };
    } else {
      throw new Error(`Voice ref >4MB di luar /app/data (tidak bisa dipetakan ke path host, dan base64 dibatasi 5 MiB server): ${voiceRefPath}`);
    }
    const refTxtPath = args.refText || args["ref-text"] || [voiceRefPath.replace(/\.[^.]+$/, ".txt"), `${voiceRefPath}.txt`].find((p) => fs.existsSync(p));
    if (refTxtPath) {
      referenceText = fs.readFileSync(refTxtPath, "utf8").trim();
      console.log(`[HTTP-TTS] Using reference transcript: ${refTxtPath} (${referenceText.length} chars)`);
    } else {
      console.log(`[HTTP-TTS] WARNING: no transcript — clone mungkin tidak nempel`);
    }
  }

  if (!manifestPath || !outputPath) {
    console.error("Usage: --manifest <m.json> --output <out.wav> [--server http://127.0.0.1:8080] [--voice-ref <path>] [--lead 5] [--tail 5]");
    process.exit(1);
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest tidak ditemukan: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const scenes = manifest.scenes || [];
  if (!scenes.length) throw new Error("Manifest kosong (0 scene)");

  const texts = scenes.map((s) => String(s.narration_text || "").trim());
  const sceneDir = path.join(path.dirname(outputPath), "narration_scenes_natural");
  fs.mkdirSync(sceneDir, { recursive: true });

  const generated = [];
  const sceneDurations = [];
  const sceneFiles = [];
  let sr = 24000;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) {
      console.log(`[HTTP-TTS] Scene ${i + 1}/${texts.length}: SKIP (kosong)`);
      sceneDurations.push(0);
      continue;
    }

    console.log(`[HTTP-TTS] Scene ${i + 1}/${texts.length}: ${text.slice(0, 60)}...`);
    const wavBuf = await httpTts(text, { host, port, model: ttsModel, language, maxChunkChars, voiceRef, referenceText });

    // Write temp WAV, parse it
    const tmpPath = path.join(sceneDir, `_tmp_scene_${i}.wav`);
    fs.writeFileSync(tmpPath, wavBuf);
    let { rate, frames } = parseWav(tmpPath);
    sr = rate;
    const dur = frames.length / 2 / rate;

    // RAW TTS: lead + tail gap
    let padded = frames;
    if (lead > 0) padded = Buffer.concat([SILENCE_2S(Math.round(lead * sr)), padded]);
    if (tail > 0) padded = Buffer.concat([padded, SILENCE_2S(Math.round(tail * sr))]);

    const scenePath = path.join(sceneDir, `scene_${String(i + 1).padStart(4, "0")}.wav`);
    writeWav(scenePath, sr, padded);
    fs.unlinkSync(tmpPath); // cleanup temp

    sceneFiles.push(path.relative(path.dirname(outputPath), scenePath).split(path.sep).join("/"));
    generated.push(frames);
    sceneDurations.push(Math.round(dur * 1000) / 1000);

    console.log(`[HTTP-TTS] Scene ${i + 1}/${texts.length} (${dur.toFixed(2)}s) OK`);
  }

  const track = Buffer.concat(generated);
  writeWav(outputPath, sr, track);

  const metadata = {
    engine: "Higgs-Audio-v3-HTTP",
    mode: "natural-duration",
    server: `http://${host}:${port}`,
    language,
    sampleRate: sr,
    channels: 1,
    durationSec: Math.round(track.length / 2 / sr * 1000) / 1000,
    sceneCount: scenes.length,
    leadSec: lead,
    tailSec: tail,
    gapAppliedTo: "raw-scene-files-only",
    sceneFiles,
    sceneDurationsSec: sceneDurations,
    sceneSourceDurationsSec: scenes.map((s) =>
      Math.round((Number(s.end_sec) - Number(s.start_sec)) * 1000) / 1000
    ),
  };
  const metadataPath = outputPath.replace(/\.wav$/, ".json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`[HTTP-TTS] Narration track: ${outputPath}`);
  console.log(`[HTTP-TTS] Metadata: ${metadataPath}`);
}

try {
  await main();
} catch (e) {
  console.error(`[HTTP-TTS] ERROR: ${e.message}`);
  process.exit(1);
}
