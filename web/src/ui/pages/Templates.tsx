import { useEffect, useState } from "react";
import { getTemplates, type TemplateMeta } from "@/app/api/client";
import { TemplateGrid } from "@/ui/components/TemplateGrid";
import { Loader2, AlertCircle } from "lucide-react";

export function Templates() {
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    getTemplates()
      .then((t) => {
        setTemplates(t);
        if (t[0]) setSel(t[0].id);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const active = templates.find((t) => t.id === sel) || null;
  const filtered = q ? templates.filter((t) => t.id.toLowerCase().includes(q.toLowerCase()) || (t.name || "").toLowerCase().includes(q.toLowerCase())) : templates;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4 text-sm text-[#a1a1aa]">
        <Loader2 className="h-4 w-4 animate-spin text-[#B6FF3B]" /> loading templates…
      </div>
    );
  }
  if (err) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">
        <AlertCircle className="h-4 w-4" /> {err}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">templates</h1>
          <p className="text-sm text-[#a1a1aa]">
            {templates.length} found · from <code className="rounded bg-[#0A0A0A] border border-[#27272A] px-1 text-xs">GET /api/templates</code> · loki is safest, others clip faces sometimes
          </p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…" className="rounded-full border border-[#27272A] bg-[#0A0A0A] px-4 py-2 text-sm placeholder:text-[#71717a] focus:outline-none focus:border-[#B6FF3B]/30" />
      </div>

      <TemplateGrid templates={filtered} selectedId={sel} onSelect={setSel} />

      {active && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4">
            <p className="font-medium text-white">{active.name || active.id}</p>
            <p className="font-mono text-xs text-[#71717a]">{active.id}</p>
            <div className="mt-3 h-16 rounded-lg border border-[#27272A]" style={{ background: active.swatch }} />
            <p className="mt-3 text-xs font-medium text-[#a1a1aa]">css — first 800 chars</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-[#000000] border border-[#27272A] p-3 font-mono text-xs text-[#a1a1aa]">{active.css.slice(0, 800) || "(empty)"}</pre>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-[#a1a1aa]">template.json</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#000000] border border-[#27272A] p-3 font-mono text-xs text-[#a1a1aa]">{JSON.stringify(active.json, null, 2)}</pre>
            </details>
          </div>

          <div className="rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4">
            <p className="font-medium text-white">preview</p>
            <p className="text-xs text-[#a1a1aa]">html caption with this style — not the ffmpeg burn, just a quick check</p>
            <div className="mt-3 overflow-hidden rounded-lg border border-[#27272A] bg-black">
              <iframe
                title="preview"
                sandbox="allow-scripts"
                srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${active.css}</style><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:180px;color:white;font-family:sans-serif}</style></head><body><div style="padding:12px;text-align:center"><div style="font-size:24px;font-weight:700">ini preview loki</div><div style="font-size:12px;opacity:.6">1080×1920 burn via tscaps engine</div></div></body></html>`}
                className="h-[240px] w-full border-0"
              />
            </div>
            <p className="mt-2 text-xs text-[#71717a]">
              real burn: <code className="rounded bg-[#000000] border border-[#27272A] px-1">tscaps-renderer/render-movie2short-template.ts</code> + chromium
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
