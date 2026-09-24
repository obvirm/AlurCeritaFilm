import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getJobs, type JobsListItem } from "@/app/api/client";
import { StatusBadge } from "@/ui/components/StatusBadge";
import { Clock, FileVideo, AlertCircle, Loader2, Plus } from "lucide-react";

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function durStr(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${ss}dtk`;
  return `${ss}dtk`;
}

export function Dashboard() {
  const [jobs, setJobs] = useState<JobsListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      const j = await getJobs();
      setJobs(j);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const done = jobs.filter((j) => j.status === "done").length;
  const running = jobs.filter((j) => j.status === "running").length;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">projects</h1>
          <p className="text-sm text-[#a1a1aa]">
            {jobs.length} total · <span className="text-white">{done} done</span>
            {running ? <span className="text-amber-400"> · {running} running</span> : null} · refresh 5s
          </p>
        </div>
        <Link to="/new" className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#B6FF3B] px-4 py-2 text-sm font-bold text-black hover:bg-[#9AE600]">
          <Plus className="h-4 w-4" /> new clip
        </Link>
      </div>

      {/* stats — not three identical cards, vary width */}
      <div className="grid gap-3 sm:grid-cols-7">
        <div className="sm:col-span-3 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4">
          <p className="text-xs text-[#71717a]">total jobs</p>
          <p className="mt-1 text-2xl font-semibold text-white">{jobs.length}</p>
          <p className="text-xs text-[#a1a1aa]">stored in data/output/jobs</p>
        </div>
        <div className="sm:col-span-2 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4">
          <p className="text-xs text-[#71717a]">ready to download</p>
          <p className="mt-1 text-2xl font-semibold text-white">{done}</p>
          <p className="text-xs text-[#a1a1aa]">mp4 + srt</p>
        </div>
        <div className="sm:col-span-2 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4">
          <p className="text-xs text-[#71717a]">pipeline</p>
          <p className="mt-1 text-sm font-semibold text-white">{running ? `${running} running — only one at a time` : "idle — host can take one job"}</p>
          <p className="text-xs text-[#71717a]">single worker, vram bound</p>
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4 text-sm text-[#a1a1aa]">
          <Loader2 className="h-4 w-4 animate-spin text-[#B6FF3B]" /> loading…
        </div>
      ) : err ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#27272A] bg-[#0A0A0A] p-8 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#1A1A1A] border border-[#27272A] text-[#B6FF3B]">
            <FileVideo className="h-5 w-5" />
          </div>
          <p className="mt-3 font-medium text-white">no clips yet</p>
          <p className="mt-1 text-sm text-[#a1a1aa]">upload a long video — we cut it to 9:16, 3–8s scenes, narration is the timeline.</p>
          <Link to="/new" className="mt-4 inline-flex rounded-full bg-[#B6FF3B] px-5 py-2 text-sm font-bold text-black">
            create first clip
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => (
            <Link
              key={j.id}
              to={`/jobs/${encodeURIComponent(j.id)}`}
              className="flex items-center gap-4 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-3 hover:border-[#B6FF3B]/20 hover:bg-[#1A1A1A]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#000000] border border-[#27272A] text-[#71717a]">
                <FileVideo className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={j.status} stage={j.stage} />
                  <span className="font-mono text-xs text-[#a1a1aa] truncate">{j.id}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-[#71717a]">
                  <Clock className="h-3 w-3" /> {fmtDate(j.createdAt)}
                  {durStr(j.createdAt, j.finishedAt) ? <span>· {durStr(j.createdAt, j.finishedAt)}</span> : null}
                  {j.artifacts.length ? <span className="truncate">· {j.artifacts.slice(0, 2).join(" · ")}</span> : null}
                </div>
              </div>
              <span className="text-xs font-medium text-[#B6FF3B]">open →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
