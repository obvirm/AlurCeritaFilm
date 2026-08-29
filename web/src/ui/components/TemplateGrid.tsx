import type { TemplateMeta } from "@/app/api/client";
import { Check, Sparkles } from "lucide-react";

export function TemplateGrid({
  templates,
  selectedId,
  onSelect,
}: {
  templates: TemplateMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (templates.length === 0) return <p className="text-sm text-[#a1a1aa]">Tidak ada template.</p>;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {templates.map((t) => {
        const active = t.id === selectedId;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`group relative overflow-hidden rounded-2xl border text-left transition ${
              active ? "border-[#B6FF3B] ring-2 ring-[#B6FF3B]/30 shadow-[0_0_16px_rgba(182,255,59,0.2)]" : "border-[#27272A] hover:border-[#B6FF3B]/30"
            }`}
          >
            <div className="h-20 w-full relative">
              <div className="absolute inset-0" style={{ background: t.swatch }} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between">
                <span className="rounded-full bg-black/70 backdrop-blur px-2 py-1 text-[10px] font-bold text-white flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-[#B6FF3B]" /> {t.id === "loki" ? "Opus pick" : "style"}
                </span>
              </div>
            </div>
            <div className="bg-[#0A0A0A] p-2.5">
              <p className="truncate text-sm font-black text-white">{t.name || t.id}</p>
              <p className="truncate text-xs text-[#a1a1aa]">{t.id}</p>
            </div>
            {active && (
              <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#B6FF3B] text-black shadow-[0_0_10px_rgba(182,255,59,0.5)]">
                <Check className="h-4 w-4" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
