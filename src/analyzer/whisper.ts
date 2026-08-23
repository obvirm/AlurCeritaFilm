import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export async function transcribeAudio(audioPath: string, outputDir: string): Promise<string> {
  const whisperExe = path.resolve("whisper/Release/whisper-cli.exe");
  const modelPath = path.resolve("whisper/ggml-large-v3-turbo.bin");
  const outputBase = path.join(outputDir, "transcript");

  console.log(`[Whisper.cpp] Transcribing ${(await fs.stat(audioPath)).size / 1024 / 1024 | 0}MB audio...`);

  const cmd = `"${whisperExe}" -m "${modelPath}" -f "${audioPath}" -otxt -ovtt -of "${outputBase}" 2>&1`;

  try {
    const { stdout } = await execAsync(cmd, { 
      maxBuffer: 1024 * 1024 * 10, 
      timeout: 1800000  // 30 minutes: full 660s audio needs ~19min on CPU
    });

    const txtPath = outputBase + ".txt";
    const vttPath = outputBase + ".vtt";

    let transcript = "";
    try {
      transcript = await fs.readFile(txtPath, "utf8");
    } catch {
      throw new Error(`No transcript output`);
    }

    if (!transcript.trim()) {
      console.warn(`[Whisper.cpp] Empty transcript`);
      return "";
    }

    // Parse VTT for timestamped segments
    const segments: TranscriptSegment[] = [];
    try {
      const vtt = await fs.readFile(vttPath, "utf8");
      for (const line of vtt.split("\n")) {
        const m = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
        if (m) {
          const start = +m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000;
          const end = +m[5]*3600 + +m[6]*60 + +m[7] + +m[8]/1000;
          const lines = vtt.split("\n");
          const idx = lines.indexOf(line);
          const text = (lines[idx + 1] || "").trim();
          if (text) segments.push({ start, end, text });
        }
      }
      if (segments.length > 0) {
        await fs.writeFile(path.join(outputDir, "transcript_timestamps.json"), JSON.stringify(segments, null, 2));
        console.log(`[Whisper.cpp] ${segments.length} timestamped segments`);
      }
    } catch {}

    console.log(`[Whisper.cpp] Done. ${transcript.length} chars`);
    return transcript.trim();

  } catch (error: any) {
    throw new Error(`Whisper.cpp: ${error.message.substring(0, 80)}`);
  }
}
