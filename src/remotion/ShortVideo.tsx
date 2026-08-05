import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig, staticFile } from 'remotion';
import { z } from 'zod';
import { shortVideoSchema } from './Root';

type ShortVideoProps = z.infer<typeof shortVideoSchema>;

export const ShortVideo: React.FC<ShortVideoProps> = ({ videoFile, scenes }) => {
  const { fps } = useVideoConfig();

  // If no valid data is provided, show a placeholder
  if (!videoFile || !scenes || scenes.length === 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: 'black', color: 'white', justifyContent: 'center', alignItems: 'center' }}>
        <h2>Invalid or Missing Manifest Data</h2>
      </AbsoluteFill>
    );
  }

  // Construct the proper public URL using staticFile helper
  // videoFile from manifest is just the filename (e.g., "getvid.mp4")
  const videoSrc = staticFile(videoFile);

  // Determine global video bounds
  const firstStartSec = Math.min(...scenes.map(s => s.start_sec));
  const lastEndSec = Math.max(...scenes.map(s => s.end_sec));

  // A helper function to safely map seconds to frames
  const secToFrames = (sec: number) => Math.ceil(sec * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* We only render the sections defined as "scenes" by the VLM */}
      {scenes.map((scene, idx) => {
        const fromFrame = secToFrames(scene.start_sec);
        const durationFrames = secToFrames(scene.end_sec - scene.start_sec);

        return (
          <Sequence
            key={scene.id || `scene_${idx}`}
            from={fromFrame}
            durationInFrames={durationFrames}
          >
            {/* 1) BACKGROUND LAYER (Blurred duplicate) */}
            <AbsoluteFill style={{ overflow: 'hidden' }}>
              <OffthreadVideo
                src={videoSrc}
                startFrom={fromFrame}
                endAt={fromFrame + durationFrames}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: 'blur(35px) brightness(0.6)',
                  transform: 'scale(1.1)', // prevent white edges due to blur
                }}
                muted={true} // mute original audio always
              />
            </AbsoluteFill>

            {/* 2) FOREGROUND LAYER (Zoomed Original) */}
            <AbsoluteFill
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <OffthreadVideo
                src={videoSrc}
                startFrom={fromFrame}
                endAt={fromFrame + durationFrames}
                style={{
                  width: '100%',
                  height: 'auto', // Keep original aspect ratio
                  transform: 'scale(1.25)', // The zoom-in effect you requested
                  boxShadow: '0 0 50px rgba(0,0,0,0.8)' // Nice separation from background
                }}
                muted={true} // mute original audio
              />
            </AbsoluteFill>

            {/* 3) OPTIONAL: Debug text to see scene narration on screen (can be disabled) */}
            <AbsoluteFill
              style={{
                justifyContent: 'flex-end',
                paddingBottom: '100px',
                paddingLeft: '50px',
                paddingRight: '50px'
              }}
            >
              <p
                style={{
                  fontFamily: 'sans-serif',
                  color: 'white',
                  fontSize: '40px',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  textShadow: '2px 2px 10px black',
                  WebkitTextStroke: '2px black'
                }}
              >
                {scene.narration_text}
              </p>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
