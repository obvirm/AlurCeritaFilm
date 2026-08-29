import { Download, FileVideo, FileAudio, FileText, FileJson, File } from "lucide-react";
import { fileUrl, type JobArtifact } from "@/app/api/client";

export function ArtifactList({ jobId, artifacts }: { jobId: string; artifacts: JobArtifact[] }) {
  if (artifacts.length === 0) return <p className="text-sm text-[#71717a]">Belum ada artifact.</p>;

  const iconFor = (kind: string) => {
    switch (kind) {
      case "video":
        return <FileVideo className="h-4 w-4 text-[#B6FF3B]" />;
      case "audio":
        return <FileAudio className="h-4 w-4 text-emerald-400" />;
      case "srt":
      case "text":
        return <FileText className="h-4 w-4 text-[#a1a1aa]" />;
      case "json":
        return <FileJson className="h-4 w-4 text-[#71717a]" />;
      default:
        return <File className="h-4 w-4" />;
    }
  };

  return (
    <ul className="space-y-2">
      {artifacts.map((a) => (
        <li key={a.name} className="flex items-center justify-between gap-3 rounded-xl border border-[#27272A] bg-[#000000] px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1A1A1A] border border-[#27272A]">{iconFor(a.kind)}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{a.name}</p>
              <p className="text-xs text-[#a1a1aa]">{a.kind} · {a.name.split(".").pop()}</p>
            </div>
          </div>
          <a
            href={fileUrl(jobId, a.name)}
            download
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#B6FF3B] px-3 py-1.5 text-xs font-black text-black hover:bg-[#9AE600]"
          >
            <Download className="h-3.5 w-3.5" /> Unduh
          </a>
        </li>
      ))}
    </ul>
  );
}
