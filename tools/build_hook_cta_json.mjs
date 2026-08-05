// Build combined 36-scene manifest + durations for hook + CTA captioned output.
import fs from 'node:fs';
import path from 'node:path';

const base = 'E:/project/movie2short/data/output';
const srcManifest = JSON.parse(fs.readFileSync(path.join(base, 'getvid_gemini_mp4/manifest.json'), 'utf8'));
const srcDurations = JSON.parse(fs.readFileSync(path.join(base, 'getvid_omnivoice/narration_omnivoice_continuous.json'), 'utf8'));
const outDir = path.join(base, 'getvid_omnivoice_captioned_v6');
fs.mkdirSync(outDir, { recursive: true });

const scenes34 = srcManifest.scenes;
const dur34 = srcDurations.sceneDurationsSec;
if (scenes34.length !== 34 || dur34.length !== 34) {
  throw new Error(`expected 34 scenes/durations, got ${scenes34.length}/${dur34.length}`);
}

const H = 590, E = 597; // scene-34 window in getvid.mp4 (cold open + CTA freeze)
const hook = { id: 'hook', start_sec: H, end_sec: E, description: 'Cold open: pantomim disumpal dari akhir', narration_text: 'Endingnya begini… tapi tunggu, gimana bisa sampai sini?' };
const cta = { id: 'cta', start_sec: H, end_sec: E, description: 'CTA akhir: pertanyaan diskusi', narration_text: 'Menurutmu, si pantomim salah gak?' };

const scenes36 = [hook, ...scenes34, cta];
const dur36 = [2.24, ...dur34, 1.76];

fs.writeFileSync(path.join(outDir, 'manifest_36.json'), JSON.stringify({ scenes: scenes36 }, null, 2));
fs.writeFileSync(
  path.join(outDir, 'durations_36.json'),
  JSON.stringify({ sceneDurationsSec: dur36, durationSec: +dur36.reduce((a, b) => a + b, 0).toFixed(3) }, null, 2),
);
console.log('TOTAL_SEC', (+dur36.reduce((a, b) => a + b, 0)).toFixed(3));
console.log('scenes', scenes36.length, 'durations', dur36.length);