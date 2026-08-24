/**
 * SPLIT MANIFEST — membagi satu manifest analysis menjadi N part.
 *
 * Analisis Gemini hanya dilakukan SEKALI; script ini hanya mempartisi
 * daftar scene hasil analisis menjadi grup scene berurutan (tanpa
 * request AI tambahan). Setiap part ditulis sebagai manifest.json
 * sendiri di <partsDir>/part-XX/, siap dipakai render + caption per part.
 *
 * Mode pembagian:
 *   manual N            -> user memilih jumlah part (dibagi seimbang berdasar bobot)
 *   auto (N=0)          -> greedy fill sampai target detik (--minutes, default 90)
 *
 * Bobot durasi:
 *   --narration <meta>  -> pakai sceneDurationsSec dari metadata TTS (DURASI NARASI
 *                          ASLI — narasi adalah master timeline video final, jadi
 *                          panjang tiap part nyaris tepat sesuai target).
 *   tanpa --narration   -> proxy durasi sumber scene (end_sec-start_sec).
 *
 * Saat --narration dipakai, tiap part juga mendapat narration_durations.json:
 *   { sceneDurationsSec, narrationStartSec, durationSec }
 * Server memakai offset itu untuk memotong WAV narasi penuh per part.
 *
 * Usage:
 *   npx tsx tools/split_manifest.ts <manifest.json> <partsDir> <N|0=auto> [--narration <tts-meta.json>] [--minutes <m>]
 */
import fs from "node:fs";
import path from "node:path";

interface ManifestScene {
  start_sec: number;
  end_sec: number;
  [key: string]: unknown;
}

interface Manifest {
  videoFile?: string;
  scenes: ManifestScene[];
  [key: string]: unknown;
}

interface NarrationMeta {
  sceneDurationsSec?: number[];
  [key: string]: unknown;
}

function main(): void {
  const argv = process.argv.slice(2);
  const [manifestPath, partsDir, rawN] = argv;
  let narrationMetaPath = "";
  let minutes = 0;
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === "--narration") narrationMetaPath = argv[++i] || "";
    else if (argv[i] === "--minutes") minutes = Number(argv[++i]) || 0;
  }
  if (!manifestPath || !partsDir) {
    console.error("Usage: npx tsx tools/split_manifest.ts <manifest.json> <partsDir> <N|0=auto> [--narration <tts-meta.json>] [--minutes <m>]");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  if (scenes.length === 0) {
    console.error("[split-manifest] manifest tidak punya scene.");
    process.exit(1);
  }

  // Bobot: durasi narasi asli bila tersedia, selain itu proxy durasi sumber.
  let weights: number[] = [];
  let weightSource = "source-proxy";
  if (narrationMetaPath && fs.existsSync(narrationMetaPath)) {
    const meta = JSON.parse(fs.readFileSync(narrationMetaPath, "utf8")) as NarrationMeta;
    const durs = meta.sceneDurationsSec;
    if (Array.isArray(durs) && durs.length === scenes.length && durs.every((d) => Number(d) > 0)) {
      weights = durs.map(Number);
      weightSource = "narration";
    } else {
      console.warn(`[split-manifest] metadata narasi tidak cocok (${durs?.length ?? 0} vs ${scenes.length} scene); fallback proxy durasi sumber.`);
    }
  }
  if (weights.length === 0) {
    weights = scenes.map((s) => Math.max(0, (s.end_sec ?? 0) - (s.start_sec ?? 0)));
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const requested = Number(rawN ?? 0);

  let groups: number[][];
  if (Number.isFinite(requested) && requested > 0) {
    groups = partitionByWeight(weights, Math.min(requested, scenes.length));
  } else {
    const targetSec = minutes > 0 ? minutes * 60 : 90;
    groups = fillByTarget(weights, targetSec);
  }

  fs.mkdirSync(partsDir, { recursive: true });

  let cursorSec = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const idx = groups[i];
    const group = idx.map((k) => scenes[k]);
    const groupWeight = idx.reduce((sum, k) => sum + weights[k], 0);
    const dir = path.join(partsDir, `part-${String(i + 1).padStart(2, "0")}`);
    fs.mkdirSync(dir, { recursive: true });
    const partManifest: Manifest = {
      ...manifest,
      scenes: group,
      partIndex: i + 1,
      partCount: groups.length,
      partDurationSec: group.reduce((sum, s) => sum + Math.max(0, (s.end_sec ?? 0) - (s.start_sec ?? 0)), 0),
      narrationStartSec: round3(cursorSec),
      narrationDurationSec: round3(groupWeight),
    };
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(partManifest, null, 2), "utf8");
    if (weightSource === "narration") {
      fs.writeFileSync(
        path.join(dir, "narration_durations.json"),
        JSON.stringify({
          sceneDurationsSec: idx.map((k) => round3(weights[k])),
          narrationStartSec: round3(cursorSec),
          durationSec: round3(groupWeight),
        }, null, 2),
        "utf8",
      );
    }
    console.log(
      `[split-manifest] ${path.relative(process.cwd(), path.join(dir, "manifest.json"))} — ${group.length} scene, ${weightSource === "narration" ? "narasi" : "sumber"} ${groupWeight.toFixed(1)}s`,
    );
    cursorSec += groupWeight;
  }
  console.log(`[split-manifest] total ${groups.length} part dari ${scenes.length} scene (${weightSource}, bobot ${totalWeight.toFixed(1)}s).`);
}

/** Greedy fill: akumulasi scene sampai bobot >= target, lalu mulai part baru. */
function fillByTarget(weights: number[], targetSec: number): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let acc = 0;
  for (let i = 0; i < weights.length; i += 1) {
    current.push(i);
    acc += weights[i];
    const hasNextScene = i < weights.length - 1;
    if (hasNextScene && acc >= targetSec) {
      groups.push(current);
      current = [];
      acc = 0;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Bagi menjadi N grup berurutan dengan bobot total semiringkas mungkin. */
function partitionByWeight(weights: number[], partCount: number): number[][] {
  const total = weights.reduce((a, b) => a + b, 0);
  const groups: number[][] = Array.from({ length: partCount }, () => []);
  let gi = 0;
  let acc = 0;
  for (let i = 0; i < weights.length; i += 1) {
    groups[gi].push(i);
    acc += weights[i];
    const remainingGroups = partCount - gi - 1;
    const remainingScenes = weights.length - i - 1;
    // Geser ke boundary berikutnya hanya jika grup-grup sisanya tetap dapat >=1 scene.
    if (remainingGroups > 0 && remainingScenes > remainingGroups && acc >= ((gi + 1) * total) / partCount - 1e-6) {
      gi += 1;
    }
  }
  return groups;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

main();
