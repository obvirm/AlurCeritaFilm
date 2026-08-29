import type { JobStatus, JobStage } from "@/app/api/client";

export function StatusBadge({ status, stage }: { status: JobStatus; stage?: JobStage }) {
  const map: Record<JobStatus, string> = {
    queued: "bg-[#1A1A1A] text-[#a1a1aa] border border-[#27272A]",
    running: "bg-amber-500 text-black animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.5)]",
    done: "bg-[#B6FF3B] text-black shadow-[0_0_12px_rgba(182,255,59,0.4)]",
    error: "bg-red-500 text-white",
    cancelled: "bg-zinc-700 text-zinc-300",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black ${map[status]}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-80" />
      {status}
      {stage ? <span className="opacity-80">· {stage}</span> : null}
    </span>
  );
}

export function StageBadge({ stage }: { stage: JobStage }) {
  if (!stage) return null;
  const labels: Record<string, string> = {
    analysis: "Analysis",
    condense: "Condense",
    tts: "TTS",
    split: "Split",
    render: "Render",
    caption: "Caption",
  };
  return <span className="rounded-full bg-[#1A1A1A] border border-[#27272A] px-2.5 py-1 text-xs font-semibold text-[#B6FF3B]">{labels[stage] || stage}</span>;
}
