/**
 * SPLIT MANIFEST — membagi satu manifest analysis menjadi N part.
 *
 * Analisis Gemini hanya dilakukan SEKALI; script ini hanya mempartisi
 * daftar scene hasil analisis menjadi N grup scene berurutan (tanpa
 * request AI tambahan). Setiap part ditulis sebagai manifest.json
 * sendiri di <partsDir>/part-XX/manifest.json, siap dipakai TTS +
 * render + caption per part.
 *
 * Mode pembagian:
 *   manual N       -> user memilih jumlah part
 *   auto (N=0)     -> target ±TARGET_SECONDS_PER_PART detik per part
 *
 * Usage:
 *   npx tsx tools/split_manifest.ts <manifest.json> <partsDir> <N>
 */
import fs from "node:fs";
import path from "node:path";

const TARGET_SECONDS_PER_PART = 90; // auto split: ±90 detik per short

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

function main(): void {
  const [, , manifestPath, partsDir, rawN] = process.argv;
  if (!manifestPath || !partsDir) {
    console.error("Usage: npx tsx tools/split_manifest.ts <manifest.json> <partsDir> <N|0=auto>");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  if (scenes.length === 0) {
    console.error("[split-manifest] manifest tidak punya scene.");
    process.exit(1);
  }

  const requested = Number(rawN ?? 0);
  const totalDuration = scenes.reduce((sum, s) => sum + Math.max(0, (s.end_sec ?? 0) - (s.start_sec ?? 0)), 0);
  let partCount = Number.isFinite(requested) && requested > 0 ? requested : 0;
  if (partCount === 0) {
    // auto: bagi berdasarkan durasi target
    partCount = Math.max(1, Math.ceil(totalDuration / TARGET_SECONDS_PER_PART));
  }
  partCount = Math.min(partCount, scenes.length);

  const groups = chunkScenes(scenes, partCount);
  fs.mkdirSync(partsDir, { recursive: true });

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const dir = path.join(partsDir, `part-${String(i + 1).padStart(2, "0")}`);
    fs.mkdirSync(dir, { recursive: true });
    const partManifest: Manifest = {
      ...manifest,
      scenes: group,
      partIndex: i + 1,
      partCount: groups.length,
      partDurationSec: group.reduce((sum, s) => sum + Math.max(0, (s.end_sec ?? 0) - (s.start_sec ?? 0)), 0),
    };
    const out = path.join(dir, "manifest.json");
    fs.writeFileSync(out, JSON.stringify(partManifest, null, 2), "utf8");
    console.log(`[split-manifest] ${path.relative(process.cwd(), out)} — ${group.length} scene, ${partManifest.partDurationSec.toFixed(1)}s`);
  }
  console.log(`[split-manifest] total ${groups.length} part dari ${scenes.length} scene (${totalDuration.toFixed(1)}s).`);
}

/** Membagi scene menjadi `partCount` grup berurutan, seimbang per jumlah scene. */
function chunkScenes(scenes: ManifestScene[], partCount: number): ManifestScene[][] {
  const groups: ManifestScene[][] = [];
  const base = Math.floor(scenes.length / partCount);
  const extra = scenes.length % partCount;
  let cursor = 0;
  for (let i = 0; i < partCount; i += 1) {
    const size = base + (i < extra ? 1 : 0);
    groups.push(scenes.slice(cursor, cursor + size));
    cursor += size;
  }
  return groups;
}

main();
