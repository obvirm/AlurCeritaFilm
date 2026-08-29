import { useLayoutEffect, useRef, useState } from "react";
import type { TemplateMeta } from "@/app/api/client";
import { Check } from "lucide-react";

function colorsOf(t: TemplateMeta) {
  const sc = (t.json as unknown as { styleControls?: Array<{ id: string; default?: string }> })?.styleControls;
  const get = (id: string) => sc?.find((c) => c.id === id)?.default;
  const primary = get("primary-color") || "#ffffff";
  const highlight = get("highlight-color") || primary;
  return { primary, highlight };
}

function scopeCss(css: string, tid: string): string {
  const p = `[data-tid="${tid}"]`;
  return css
    .replaceAll(".segment", `${p} .segment`)
    .replaceAll(".line", `${p} .line`)
    .replaceAll(".word", `${p} .word`)
    .replaceAll(".emphasis", `${p} .emphasis`)
    .replaceAll(".accent", `${p} .accent`)
    .replaceAll(".entity", `${p} .entity`)
    .replaceAll(".quote", `${p} .quote`)
    .replaceAll(".tscaps-", `${p} .tscaps-`);
}

const CHECKERED = "rgb(255 255 255 / 0.06)";
const CHECK_BG: React.CSSProperties = {
  backgroundColor: "#0A0A0A",
  backgroundImage: `linear-gradient(45deg, ${CHECKERED} 25%, transparent 25%), linear-gradient(-45deg, ${CHECKERED} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${CHECKERED} 75%), linear-gradient(-45deg, transparent 75%, ${CHECKERED} 75%)`,
  backgroundSize: "14px 14px",
  backgroundPosition: "0 0, 0 7px, 7px -7px, -6px 0px",
};

export function TemplateGrid({
  templates,
  selectedId,
  onSelect,
}: {
  templates: TemplateMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (templates.length === 0) return <p className="text-sm text-zinc-500">Tidak ada template.</p>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {templates.map((t) => (
        <Cell key={t.id} template={t} active={t.id === selectedId} onSelect={onSelect} />
      ))}
      <style>{`@keyframes thumbPop{0%{transform:scale(0.82);opacity:0}55%{transform:scale(1.12)}75%{transform:scale(0.96)}100%{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

function Cell({ template: t, active, onSelect }: { template: TemplateMeta; active: boolean; onSelect: (id: string) => void }) {
  const { primary, highlight } = colorsOf(t);
  const [hover, setHover] = useState(false);
  // static = judul template (nama), hover = kuota 2-3 kata THIS IS TSCAPS biar highlight & animasi kepakai — luca fallback single biar tidak blank
  const words = hover ? (t.id === "luca" ? ["Luca"] : ["THIS", "IS", "TSCAPS"]) : [t.name || t.id];
  const [scale, setScale] = useState(1);
  const previewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // fitScale — biar thumb 4:2 gak kosong luas kayak screenshot selene pill kecil
  // dulu cap 1 jadi selene 90px di preview 284px dibiarin kecil, sekarang boleh scale up 2.2x biar ngisi
  useLayoutEffect(() => {
    const p = previewRef.current;
    const c = contentRef.current;
    if (!p || !c) return;
    const pad = 4; // dulu 8 → kosong 16px tiap sisi, sekarang 4 biar ngisi
    const measure = () => {
      const cw = p.clientWidth - pad * 2;
      const ch = p.clientHeight - pad * 2;
      const w = c.offsetWidth;
      const h = c.offsetHeight;
      if (!w || !h || cw <= 0 || ch <= 0) return;
      setScale(Math.min(cw / w, ch / h, 2.4));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(p);
    ro.observe(c);
    return () => ro.disconnect();
  }, [t.id, hover]);

  return (
    <button
      onClick={() => onSelect(t.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`group relative overflow-hidden rounded-xl border bg-black text-left transition ${
        active ? "border-[#B6FF3B] ring-1 ring-[#B6FF3B]/40" : "border-zinc-800 hover:border-zinc-700"
      }`}
      aria-label={t.name || t.id}
    >
      <div ref={previewRef} data-tid={t.id} className="relative flex aspect-[4/2] w-full items-center justify-center overflow-hidden p-2" style={CHECK_BG}>
        {t.css ? <style>{scopeCss(t.css, t.id)}</style> : null}
        {/* virtual video 720x1280 biar cqh jalan — container-type:size agar cqh valid per thumb */}
        <div
          className="flex items-center justify-center"
          style={
            {
              width: 720,
              height: 1280,
              flexShrink: 0,
              transform: `scale(${scale})`,
              transformOrigin: "center",
              containerType: "size",
            } as React.CSSProperties
          }
        >
          <div ref={contentRef} style={{ width: "max-content" } as React.CSSProperties}>
            <div key={hover ? "hov" : "idle"} className="segment flex items-center justify-center"
              style={
                {
                  // inject primary/highlight biar static sesuai template, bukan putih generik
                  ["--tscaps-primary-color" as string]: primary,
                  ["--tscaps-highlight-color" as string]: highlight,
                  // kuota 2-3 kata biar highlight & line wrapping kepakai — THIS IS TSCAPS (14 chars), fallback single untuk luca
                  ["--segment-char-count" as string]: String(words.join(" ").length),
                  ["--m2s-ctl-dynamic-font-size" as string]: "12",
                  // trigger animasi bawaan template pas hover — di luar hover delay negatif biar static visible
                  ["--on-segment-starts" as string]: hover ? "0s" : "-10s",
                } as React.CSSProperties
              }
            >
              <div className="line">
                {words.map((w, i) => (
                  <span
                    key={i}
                    className={hover ? "word word-being-narrated" : "word"}
                    style={
                      {
                        ["--on-word-being-narrated-starts" as string]: hover ? `${i * 0.35}s` : "-10s",
                        ["--word-being-narrated-duration" as string]: "0.3s",
                      } as React.CSSProperties
                    }
                  >
                    {w}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {active && (
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#B6FF3B] text-black">
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </button>
  );
}
