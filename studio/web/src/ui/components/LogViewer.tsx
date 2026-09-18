import { useEffect, useRef } from "react";
import type { JobLogEntry } from "@/app/api/client";

export function LogViewer({ logs, autoScroll = true }: { logs: JobLogEntry[]; autoScroll?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, autoScroll]);

  return (
    <div ref={ref} className="h-[420px] overflow-auto rounded-xl bg-[#000000] border border-[#27272A] p-3 font-mono text-xs leading-relaxed">
      {logs.length === 0 ? (
        <span className="text-[#71717a]">Menunggu log…</span>
      ) : (
        logs.map((e, i) => (
          <div
            key={i}
            className={
              e.level === "err"
                ? "text-red-400"
                : e.level === "warn"
                  ? "text-amber-400"
                  : e.level === "out"
                    ? "text-[#B6FF3B]"
                    : "text-[#a1a1aa]"
            }
          >
            <span className="mr-2 select-none text-[#71717a]">{new Date(e.t).toLocaleTimeString()}</span>
            {e.line}
          </div>
        ))
      )}
    </div>
  );
}
