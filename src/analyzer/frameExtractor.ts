import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

export interface ExtractedFrame {
  timestamp: number; // in seconds
  base64: string;
}

/**
 * Extracts frames from a video directly into memory (RAM) as Base64 strings.
 * Supports extracting from a specific time range (startSec to endSec).
 *
 * @param videoPath Path to the input video
 * @param intervalSec How often to extract a frame
 * @param maxWidth Scale width down to save memory and Ollama context
 * @param startSec Start time in seconds (default: 0)
 * @param endSec End time in seconds (default: full video)
 * @returns Array of base64 images ready for VLM
 */
export async function extractFramesToMemory(
  videoPath: string,
  intervalSec: number = 2,
  maxWidth: number = 0, // 0 = resolusi penuh (tanpa kompromi)
  startSec: number = 0,
  endSec?: number
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const frames: ExtractedFrame[] = [];
    let currentFrameIdx = 0;

    const fps = 1 / intervalSec;
    const duration = endSec ? endSec - startSec : undefined;

    const passthrough = new PassThrough();
    let currentBuffer = Buffer.alloc(0);

    passthrough.on('data', (chunk: Buffer) => {
      currentBuffer = Buffer.concat([currentBuffer, chunk]);

      let endIdx = currentBuffer.indexOf(Buffer.from([0xff, 0xd9]));

      while (endIdx !== -1) {
        const jpegBuffer = currentBuffer.subarray(0, endIdx + 2);

        frames.push({
          timestamp: startSec + (currentFrameIdx * intervalSec),
          base64: jpegBuffer.toString('base64')
        });
        currentFrameIdx++;

        currentBuffer = currentBuffer.subarray(endIdx + 2);
        endIdx = currentBuffer.indexOf(Buffer.from([0xff, 0xd9]));
      }
    });

    passthrough.on('end', () => {
      resolve(frames);
    });

    passthrough.on('error', (err) => {
      reject(err);
    });

    let cmd = ffmpeg(videoPath);

    // Add seek options for time range
    if (startSec > 0) {
      cmd = cmd.seekInput(startSec);
    }
    if (duration) {
      cmd = cmd.duration(duration);
    }

    const scaleFilter = maxWidth > 0 ? `,scale=${maxWidth}:-1` : "";
    cmd.outputOptions([
        `-vf fps=${fps}${scaleFilter}`,
        '-f image2pipe',
        '-vcodec mjpeg'
      ])
      .on('error', (err) => {
        reject(new Error(`FFmpeg error extracting frames: ${err.message}`));
      })
      .pipe(passthrough, { end: true });
  });
}