// Tool: gabungkan audio narasi s2 per scene ke satu track, pad/trim ke durasi scene video.
// Jalankan via pwsh tsx (memakai ffmpeg/ffprobe eksternal).
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'data/output/getvid_omnivoice');
const manifestPath = path.join(outDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const scenes = manifest.scenes;

if (!Array.isArray(scenes) || scenes.length === 0) {
  console.error('No scenes found in manifest');
  process.exit(1);
}

const sceneWavs = [];
const concatList = path.join(outDir, 's2_concat_list.txt');
const paddedDir = path.join(outDir, 's2_padded');
fs.mkdirSync(paddedDir, { recursive: true });

function ffprobe(file) {
  const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`, { encoding: 'utf8' }).trim();
  return parseFloat(out);
}

function ffmpeg(args) {
  execSync(`ffmpeg -y -hide_banner -loglevel error ${args}`, { encoding: 'utf8' });
}

const lines = [];
for (let i = 0; i < scenes.length; i++) {
  const sc = scenes[i];
  const videoDur = sc.end_sec - sc.start_sec;
  const srcWav = path.resolve(outDir, `s2_scene_${i}`);
  if (!fs.existsSync(srcWav)) {
    console.error(`Missing s2_scene_${i}`);
    process.exit(1);
  }
  const dur = ffprobe(srcWav);
  const paddedWav = path.resolve(paddedDir, `scene_${i}.wav`);
  if (dur > videoDur + 0.05) {
    // audio lebih panjang: potong ke durasi video scene
    ffmpeg(`-i "${srcWav}" -t ${videoDur.toFixed(3)} -ar 44100 -ac 1 -c:a pcm_s16le "${paddedWav}"`);
  } else {
    // audio lebih pendek: pad dengan silence sampai durasi scene
    ffmpeg(`-i "${srcWav}" -af apad=pad_dur=${(videoDur - dur).toFixed(3)} -t ${videoDur.toFixed(3)} -ar 44100 -ac 1 -c:a pcm_s16le "${paddedWav}"`);
  }
  const actual = ffprobe(paddedWav);
  lines.push(`file '${paddedWav.replace(/'/g, "'\\''")}'`);
  sceneWavs.push({ scene: i, src: videoDur, actual: Math.round(actual * 100) / 100 });
}

fs.writeFileSync(concatList, lines.join('\n') + '\n', 'utf8');
const finalWav = path.join(outDir, 'narration_s2.wav');
ffmpeg(`-f concat -safe 0 -i "${concatList}" -c:a pcm_s16le "${finalWav}"`);

console.log(`FINAL_WAV=${finalWav}`);
console.log(`FINAL_DURATION=${ffprobe(finalWav)}s`);
console.table(sceneWavs);
console.log(`CONCAT_LIST=${concatList}`);