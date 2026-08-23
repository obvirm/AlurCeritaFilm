import ffmpeg from 'fluent-ffmpeg';

/**
 * Extracts the audio track from a video file and saves it as a WAV file.
 * This file is needed for Whisper to transcribe the audio.
 *
 * @param videoPath Path to the input video
 * @param outputAudioPath Path to save the extracted .wav file
 */
export async function extractAudio(videoPath: string, outputAudioPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000) // 16kHz is ideal for Whisper
      .save(outputAudioPath)
      .on('end', () => {
        resolve();
      })
      .on('error', (err) => {
        reject(new Error(`Failed to extract audio: ${err.message}`));
      });
  });
}
