// Build a narration track aligned to original scene windows.
// Each natural OmniVoice scene is padded with silence to its visual window;
// when narration is longer, the renderer freezes the last visual frame.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve(process.argv[2] || 'data/output/getvid_omnivoice/manifest.json');
const metadataPath = path.resolve(process.argv[3] || 'data/output/getvid_omnivoice/narration_omnivoice_natural.json');
const outputPath = path.resolve(process.argv[4] || 'data/output/getvid_omnivoice/narration_omnivoice_aligned.wav');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const baseDir = path.dirname(metadataPath);
const workDir = path.join(path.dirname(outputPath), 'narration_scenes_aligned');
fs.mkdirSync(workDir, { recursive: true });

const concatLines = [];
const effectiveDurations = [];
for (let i = 0; i < manifest.scenes.length; i++) {
  const sc = manifest.scenes[i];
  const visualDur = Number(sc.end_sec) - Number(sc.start_sec);
  const narrationDur = Number(metadata.sceneDurationsSec[i]);
  const targetDur = Math.max(visualDur, narrationDur);
  const src = path.resolve(baseDir, metadata.sceneFiles[i]);
  const dst = path.join(workDir, `scene_${String(i + 1).padStart(4, '0')}.wav`);
  const padDur = Math.max(0, targetDur - narrationDur);
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-af', `apad=pad_dur=${padDur.toFixed(3)}`,
    '-t', targetDur.toFixed(3), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', dst,
  ]);
  concatLines.push(`file '${dst.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
  effectiveDurations.push(Number(targetDur.toFixed(3)));
}

const concatPath = path.join(workDir, 'concat.txt');
fs.writeFileSync(concatPath, concatLines.join('\n') + '\n');
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatPath,
  '-c:a', 'pcm_s16le', outputPath,
]);

const alignedMeta = {
  ...metadata,
  mode: 'natural-duration-aligned-to-scenes',
  effectiveSceneDurationsSec: effectiveDurations,
  durationSec: Number(effectiveDurations.reduce((a, b) => a + b, 0).toFixed(3)),
  alignment: 'Natural narration; original scene preserved; silence pads short narration; renderer freezes final frame for long narration.',
};
const alignedMetaPath = outputPath.replace(/\.wav$/i, '.json');
fs.writeFileSync(alignedMetaPath, JSON.stringify(alignedMeta, null, 2));
console.log(`ALIGNED_WAV=${outputPath}`);
console.log(`ALIGNED_META=${alignedMetaPath}`);
console.log(`TOTAL_DURATION=${alignedMeta.durationSec}`);
console.log(`FREEZE_SCENES=${effectiveDurations.filter((d, i) => d > (manifest.scenes[i].end_sec - manifest.scenes[i].start_sec) + 0.01).length}`);