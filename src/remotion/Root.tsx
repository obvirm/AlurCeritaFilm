import { Composition, getInputProps } from 'remotion';
import { ShortVideo } from './ShortVideo';
import { z } from 'zod';

// We define the schema of the props we expect
export const shortVideoSchema = z.object({
  videoFile: z.string(),
  scenes: z.array(
    z.object({
      id: z.string(),
      start_sec: z.number(),
      end_sec: z.number(),
      description: z.string(),
      narration_text: z.string()
    })
  )
});

export const RemotionRoot: React.FC = () => {
  // We'll pass manifest data via getInputProps() when invoking Remotion CLI
  const inputProps = getInputProps() as z.infer<typeof shortVideoSchema>;

  // Calculate total duration in frames
  const FPS = 30;
  // If no scenes, just do 10 seconds
  const maxEndSec = inputProps.scenes?.length > 0
    ? Math.max(...inputProps.scenes.map(s => s.end_sec))
    : 10;
  const totalFrames = Math.max(1, Math.ceil(maxEndSec * FPS));

  return (
    <>
      <Composition
        id="MovieShort"
        component={ShortVideo}
        schema={shortVideoSchema}
        durationInFrames={totalFrames}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          videoFile: inputProps.videoFile || '',
          scenes: inputProps.scenes || []
        }}
      />
    </>
  );
};
