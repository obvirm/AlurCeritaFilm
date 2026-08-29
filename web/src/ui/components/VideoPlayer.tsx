import { useEffect, useRef } from "react";

interface Props {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
}

export function VideoPlayer({ src, poster, autoPlay, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.load();
  }, [src]);

  return (
    <div className={`overflow-hidden rounded-xl bg-black ${className || ""}`}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
