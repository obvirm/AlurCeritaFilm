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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">templates</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…" className="rounded-full border border-[#27272A] bg-[#0A0A0A] px-4 py-2 text-sm placeholder:text-[#71717a] focus:outline-none focus:border-[#B6FF3B]/30" />
      </div>

      <TemplateGrid templates={filtered} selectedId={sel} onSelect={setSel} />
    </div>
  );
}
