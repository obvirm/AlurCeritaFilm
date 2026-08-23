#!/usr/bin/env node
/**
 * Generate one OmniVoice narration track via audio.cpp (audiocpp_cli, C++/ggml).
 *
 * Node murni — TIDAK ada Python di jalur TTS. Semua sintesis dijalankan oleh
 * audiocpp_cli.exe (model OmniVoice di-load SEKALI, semua scene diproses dalam
 * satu session batch). Script ini hanya orkestrasi: baca manifest -> batch text
 * -> jalankan exe -> rakit WAV final + JSON metadata.
 *
 * Kontrak output IDENTIK dengan versi Python lama (omnivoice_manifest_tts_natural.py):
 *   <outdir>/narration_scenes_natural/scene_XXXX.wav   (raw per scene, DENGAN gap lead/tail)
 *   <output>.wav                                       (concat semua scene TANPA gap)
 *   <output>.json                                      (metadata + durasi natural per scene)
 *
 * --lead / --tail (default 5s/5s): jeda diam di awal & akhir SETIAP clip TTS.
 * Gap ini HANYA ada di file raw per-scene — fungsinya biar onset/ekor kalimat
 * tidak terpotong langsung saat generate (sumber halusinasi). Saat PENGGABUNGAN
 * (concat ke satu track final), gap DIHAPUS: track final murni suara natural.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// WAV mono PCM16 helpers (tanpa dependency)
// ---------------------------------------------------------------------------
function parseWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`Bukan WAV: ${file}`);
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
    }
    off += 8 + size + (size % 2);
  }
  if (!frames) throw new Error(`Tidak ada chunk data di WAV: ${file}`);
  if (channels !== 1) throw new Error(`Harus mono, dapat ${channels} channel: ${file}`);
  return { rate, frames };
}

function writeWav(file, rate, frames) {
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
  header.writeUInt16LE(16, 34); // bits
  header.write("data", 36, "ascii");
  header.writeUInt32LE(frames.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, frames]));
}

// ---------------------------------------------------------------------------
// Arg parsing minimal (--key value)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[key] = argv[i + 1];
        i += 1;
      } else {
        args[key] = "";
      }
    }
  }
  return args;
}

const SILENCE_2S = (n) => Buffer.alloc(n * 2); // PCM16 zero

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["manifest", "ref-audio", "ref-text", "output"];
  for (const r of required) {
    if (!args[r]) throw new Error(`Argumen wajib hilang: --${r}`);
  }

  const manifestPath = path.resolve(args.manifest);
  const outputPath = path.resolve(args.output);
  const refAudio = path.resolve(args["ref-audio"]);
  const refText = fs.readFileSync(path.resolve(args["ref-text"]), "utf8").trim();

  const exe = args.exe || process.env.AUDIOCPP_EXE || "audiocpp_cli";
  const model = args.model || process.env.AUDIOCPP_MODEL || "";
  const specs = args["model-specs"] || process.env.AUDIOCPP_MODEL_SPECS || "";
  if (!model) throw new Error("--model tidak diberikan dan env AUDIOCPP_MODEL kosong");
  if (!fs.existsSync(specs) || !fs.statSync(specs).isDirectory()) {
    throw new Error(`Dir model-specs tidak ditemukan: ${specs}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const scenes = manifest.scenes || [];
  if (!scenes.length) throw new Error("Manifest contains no scenes");
  if (!fs.existsSync(refAudio)) throw new Error(`Reference audio not found: ${refAudio}`);
  if (!refText) throw new Error("Reference transcript is empty");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const sceneDir = path.join(path.dirname(outputPath), "narration_scenes_natural");
  const batchOut = path.join(path.dirname(outputPath), "_audiocpp_batch_out");
  const batchTxt = path.join(path.dirname(outputPath), "_audiocpp_batch.txt");
  const batchManifest = path.join(path.dirname(outputPath), "_audiocpp_batch_manifest.json");
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(batchOut, { recursive: true });

  const texts = scenes.map((s, i) => {
    const text = String(s.narration_text || "").trim();
    const dur = Number(s.end_sec) - Number(s.start_sec);
    if (!text || !(dur > 0)) throw new Error(`Invalid narration scene at index ${i}`);
    return text;
  });

  fs.writeFileSync(batchTxt, texts.join("\n") + "\n", "utf8");
  console.log(`[Audiocpp-natural] ${scenes.length} scene -> batch audiocpp_cli (model load sekali)`);

  const cmd = [
    exe,
    "--task", "tts",
    "--family", "omnivoice",
    "--model-spec-override", specs,
    "--model", path.resolve(model),
    "--backend", args.backend || "cuda",
    "--batch-text-file", batchTxt,
    "--voice-ref", refAudio,
    "--reference-text", refText,
    "--language", args.language || "Indonesian",
    "--num-inference-steps", args.steps || "16",
    "--guidance-scale", "2.0",
    "--request-option", `speed=${args.speed || "1.12"}`,
    "--out-dir", batchOut,
    "--batch-manifest-out", batchManifest,
  ];
  console.log(`[Audiocpp-natural] ${cmd.join(" ")}`);
  const result = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`audiocpp_cli gagal (rc=${result.status})`);
  }
  if (!fs.existsSync(batchManifest)) {
    throw new Error("audiocpp_cli tidak menulis batch manifest");
  }

  const batch = JSON.parse(fs.readFileSync(batchManifest, "utf8"));
  const requests = new Map((batch.requests || []).map((r) => [r.id, r]));

  const generated = [];
  const sceneFiles = [];
  const sceneDurations = [];
  let sr = 0;
  for (let i = 0; i < texts.length; i += 1) {
    const rid = `line_${i + 1}`;
    const info = requests.get(rid);
    if (!info) throw new Error(`Hasil batch untuk ${rid} tidak ada di manifest`);
    const wavPath = path.join(batchOut, `${rid}.wav`);
    if (!fs.existsSync(wavPath)) throw new Error(`Output batch tidak ditemukan: ${wavPath}`);
    const { rate, frames } = parseWav(wavPath);
    sr = rate;
    const dur = frames.length / 2 / rate;

    // RAW TTS: lead + tail gap. Gap ini HANYA untuk file raw per-scene.
    let padded = frames;
    const lead = Number(args.lead ?? 5);
    const tail = Number(args.tail ?? 5);
    if (lead > 0) padded = Buffer.concat([SILENCE_2S(Math.round(lead * sr)), padded]);
    if (tail > 0) padded = Buffer.concat([padded, SILENCE_2S(Math.round(tail * sr))]);

    const scenePath = path.join(sceneDir, `scene_${String(i + 1).padStart(4, "0")}.wav`);
    writeWav(scenePath, sr, padded);
    sceneFiles.push(path.relative(path.dirname(outputPath), scenePath).split(path.sep).join("/"));

    generated.push(frames);
    sceneDurations.push(Math.round(dur * 1000) / 1000);
    console.log(
      `[Audiocpp-natural] Scene ${i + 1}/${texts.length} (${(dur).toFixed(2)}s): ${texts[i].slice(0, 60)}`
    );
  }

  const track = Buffer.concat(generated);
  writeWav(outputPath, sr, track);

  const metadata = {
    engine: "OmniVoice-audio.cpp",
    mode: "natural-duration",
    model: path.resolve(model),
    referenceAudio: refAudio,
    language: args.language || "Indonesian",
    sampleRate: sr,
    channels: 1,
    durationSec: Math.round(track.length / 2 / sr * 1000) / 1000,
    sceneCount: scenes.length,
    leadSec: Number(args.lead ?? 5),
    tailSec: Number(args.tail ?? 5),
    gapAppliedTo: "raw-scene-files-only",
    sceneFiles,
    sceneDurationsSec: sceneDurations,
    sceneSourceDurationsSec: scenes.map((s) =>
      Math.round((Number(s.end_sec) - Number(s.start_sec)) * 1000) / 1000
    ),
  };
  const metadataPath = outputPath.replace(/\.wav$/, ".json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`[Audiocpp-natural] Narration track: ${outputPath}`);
  console.log(`[Audiocpp-natural] Metadata: ${metadataPath}`);
}

try {
  main();
} catch (e) {
  console.error(`[Audiocpp-natural] ERROR: ${e.message}`);
  process.exit(1);
}
