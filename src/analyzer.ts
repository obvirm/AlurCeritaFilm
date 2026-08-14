import path from "path";
import fs from "fs/promises";
import { extractFramesToMemory } from "./stage1/frameExtractor.js";
import { analyzeChunkWithOllama, SceneOutput } from "./stage1/vlm.js";
import { analyzeChunkWithR9Video } from "./stage1/vlm_r9.js";
import { analyzeVideoChunkWithGemini, deleteVideoFromGemini, uploadVideoToGemini } from "./stage1/vlm_gemini.js";
import { extractAudio } from "./stage1/audioExtractor.js";
import { transcribeAudio } from "./stage1/whisper.js";
import { synthesizeNarration } from "./stage2/narrationSynthesizer.js";

export interface PipelineOptions {
  videoPath: string;
  outputDir: string;
  intervalSec?: number;
  ollamaModel?: string;
}

export async function runAnalysisPipeline(options: PipelineOptions) {
  const { videoPath, outputDir, ollamaModel = "gemini/gemini-3.6-flash" } = options;
  const isGemini = ollamaModel.startsWith("gemini/");
  const isR9 = ollamaModel.startsWith("r9/");
  const actualModel = isGemini ? ollamaModel.replace("gemini/", "") : isR9 ? ollamaModel.replace("r9/", "") : ollamaModel;

  console.log("[1/5] Ensuring output directories...");
  await fs.mkdir(outputDir, { recursive: true });
  const tempDir = path.join(outputDir, "temp");
  await fs.mkdir(tempDir, { recursive: true });

  console.log("[2/5] Getting video duration...");
  let totalDuration = 60;
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const { stdout } = await execAsync(
      'ffprobe -v error -show_entries format=duration -of csv=p=0 "' + path.resolve(videoPath) + '"'
    );
    totalDuration = parseFloat(stdout.trim()) || 60;
    console.log("       Duration: " + totalDuration + "s");
  } catch {
    console.log("       Default: " + totalDuration + "s");
  }

  console.log("[3/5] Preparing audio context...");
  let transcript = "";
  const transcriptTextPath = path.join(outputDir, "transcript.txt");
  const transcriptSegmentsPath = path.join(outputDir, "transcript_timestamps.json");

  if (isGemini || isR9) {
    // Gemini & R9 (ag/gemini-*) membaca audio langsung dari MP4 — Whisper dilewati.
    console.log("       " + (isGemini ? "Gemini" : "R9 (ag/gemini)") + " akan membaca audio langsung dari MP4; Whisper dilewati.");
  } else {
    try {
      transcript = (await fs.readFile(transcriptTextPath, "utf8")).trim();
      await fs.access(transcriptSegmentsPath);
      console.log("       Reusing existing transcript: " + transcript.length + " chars");
    } catch {
      const audioPath = path.join(tempDir, "audio.wav");
      try {
        await extractAudio(videoPath, audioPath);
        const stats = await fs.stat(audioPath);
        console.log("       Audio: " + (stats.size / 1024 / 1024).toFixed(2) + " MB");
        transcript = await transcribeAudio(audioPath, outputDir);
        console.log("       Transcript: " + transcript.length + " chars");
      } catch (e) {
        console.log("       Audio skipped: " + (e as Error).message);
      }
    }
  }

  console.log("[4/5] VLM analysis...");
  const allScenes: SceneOutput[] = [];
  // M2S_CHUNK_DURATION: 0 = satu request penuh (tanpa chunk), default 40 detik.
  const chunkDurationRaw = Number(process.env.M2S_CHUNK_DURATION || "40");
  const chunkDuration = chunkDurationRaw > 0 ? chunkDurationRaw : totalDuration;
  let previousNarration = "";

  let transcriptSegments: Array<{ start: number; end: number; text: string }> = [];
  try {
    transcriptSegments = JSON.parse(
      await fs.readFile(path.join(outputDir, "transcript_timestamps.json"), "utf8")
    );
  } catch {}

  const geminiVideo = isGemini ? await uploadVideoToGemini(videoPath) : null;

  try {
    for (let cs = 0; cs < totalDuration; cs += chunkDuration) {
      const ce = Math.min(cs + chunkDuration, totalDuration);
      const chunkTranscript = transcriptSegments
        .filter(segment => segment.start < ce && segment.end > cs)
        .map(segment => {
          const localStart = Math.max(0, segment.start - cs).toFixed(2);
          const localEnd = Math.min(ce - cs, segment.end - cs).toFixed(2);
          return `[${localStart}s-${localEnd}s] ${segment.text}`;
        })
        .join("\n");

      console.log("       Chunk " + cs + "s-" + ce + "s" + (geminiVideo ? " | MP4 audio+visual" : " | transcript: " + chunkTranscript.length + " chars"));

      let r;
      if (geminiVideo) {
        r = await analyzeVideoChunkWithGemini(
          geminiVideo,
          cs,
          ce,
          actualModel,
          undefined,
          previousNarration
        );
      } else if (isR9) {
        // R9 = kirim MP4 LANGSUNG (potong per chunk -c copy, kualitas asli, tanpa filter)
        r = await analyzeChunkWithR9Video(videoPath, cs, ce, actualModel, chunkTranscript, previousNarration);
      } else {
        const frames = await extractFramesToMemory(videoPath, 2, 0, cs, ce); // semua frame, resolusi penuh
        if (frames.length === 0) continue;
        r = await analyzeChunkWithOllama(frames, cs, ce, actualModel, chunkTranscript, previousNarration);
      }

      if (r.scenes.length > 0) {
        const scenesWithGlobalIds = r.scenes.map((scene, index) => ({
          ...scene,
          id: `scene_${allScenes.length + index + 1}`
        }));
        allScenes.push(...scenesWithGlobalIds);
        const recentNarrations = scenesWithGlobalIds
          .slice(-3)
          .map(function(s) { return "[" + s.start_sec + "s-" + s.end_sec + "s] " + s.narration_text; })
          .join("; ");
        previousNarration = recentNarrations;
      }
    }
    console.log("[5/5] Analysis done. " + allScenes.length + " scenes");
  } finally {
    if (geminiVideo) {
      try {
        await deleteVideoFromGemini(geminiVideo);
      } catch (error) {
        console.warn("[Gemini] Cloud cleanup gagal:", (error as Error).message);
      }
    }
  }

  const stage1Manifest = path.join(outputDir, "manifest_stage1.json");
  await fs.writeFile(
    stage1Manifest,
    JSON.stringify({ videoFile: path.basename(videoPath), scenes: allScenes }, null, 2)
  );

  const stage1Narasi = path.join(outputDir, "narasi_stage1.txt");
  await fs.writeFile(
    stage1Narasi,
    allScenes.map(function(s) { return "[" + s.start_sec + "s - " + s.end_sec + "s] " + s.narration_text; }).join("\n\n")
  );

  console.log("- Stage 1 manifest: " + stage1Manifest);
  console.log("- Stage 1 narasi: " + stage1Narasi);

  if (isGemini) {
    const finalManifestPath = path.join(outputDir, "manifest.json");
    await fs.writeFile(
      finalManifestPath,
      JSON.stringify({ videoFile: path.basename(videoPath), scenes: allScenes }, null, 2)
    );
    await fs.writeFile(
      path.join(outputDir, "narasi.txt"),
      allScenes.map(function(s) { return "[" + s.start_sec + "s - " + s.end_sec + "s] " + s.narration_text; }).join("\n\n")
    );
    console.log("[Stage 2] Skipped: Gemini narration is final.");
    return finalManifestPath;
  }

  const manifestPath = await synthesizeNarration(stage1Manifest, outputDir, transcript);
  return manifestPath;
}
