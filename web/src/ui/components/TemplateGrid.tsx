import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

function expandTscapsFilter(svg: string): string {
  let out = svg;
  out = out.replace(/<tscaps:outline\s+([^>]*?)\/>/g, (_m, attrs: string) => {
    const g = (n: string, d: string) => { const m = attrs.match(new RegExp(`${n}="([^"]*)"`)); return m ? m[1] : d; };
    const thickness = g("thickness", "0.12");
    const ink = g("ink", "#000000");
    const tin = g("in", "SourceAlpha");
    const result = g("result", "outline");
    return `<feMorphology in="${tin}" operator="dilate" radius="${thickness}em" result="${result}-shape"/><feFlood flood-color="${ink}" result="${result}-ink"/><feComposite in="${result}-ink" in2="${result}-shape" operator="in" result="${result}"/>`;
  });
  out = out.replace(/<tscaps:drop-shadow\s+([^>]*?)\/>/g, (_m, attrs: string) => {
    const g = (n: string, d: string) => { const m = attrs.match(new RegExp(`${n}="([^"]*)"`)); return m ? m[1] : d; };
    const distance = g("distance", "0.04");
    const blur = g("blur", "0.04");
    const ink = g("ink", "#000000");
    const tin = g("in", "SourceAlpha");
    const result = g("result", "shadow");
    return `<feOffset in="${tin}" dx="0" dy="${distance}em" result="${result}-offset"/><feGaussianBlur in="${result}-offset" stdDeviation="${blur}em" result="${result}-spread"/><feFlood flood-color="${ink}" result="${result}-ink"/><feComposite in="${result}-ink" in2="${result}-spread" operator="in" result="${result}"/>`;
  });
  return out;
}

function materializeFilter(body: string, controls: Record<string, string>, pxPerEm: number): string {
  let out = body.replace(/var\(\s*--([a-zA-Z_][a-zA-Z0-9_-]*)\s*(?:,\s*([^)]*))?\s*\)/g, (_m, name: string, fallback: string) => {
    if (controls[`--${name}`]) return controls[`--${name}`];
    if (fallback !== undefined) return fallback.trim();
    return _m;
  });
  out = out.replace(/(-?\d*\.?\d+)em/g, (_m, num: string) => String(Math.round(parseFloat(num) * pxPerEm * 1000) / 1000));
  return out;
}

function buildFilterArtifacts(t: TemplateMeta, scopeKey: string, pxPerEm: number): { defsHtml: string; urlVars: Record<string, string> } | null {
  if (!t.filters) return null;
  const sc = (t.json as unknown as { styleControls?: Array<{ id: string; default?: string }> })?.styleControls;
  const controls: Record<string, string> = {};
  sc?.forEach((c) => { if (c.default) controls[`--tscaps-${c.id}`] = String(c.default); });

  const expanded = expandTscapsFilter(t.filters);
  const doc = new DOMParser().parseFromString(expanded, "image/svg+xml");
  const filterEl = doc.querySelector("filter");
  if (!filterEl) return null;

  const localId = filterEl.getAttribute("id") || "filter";
  const scopedId = `tscaps-filter-${scopeKey}-${localId}`;
  const attrs = Array.from(filterEl.attributes).filter((a) => a.name !== "id").map((a) => `${a.name}="${a.value}"`).join(" ");
  const materializedBody = materializeFilter(filterEl.innerHTML, controls, pxPerEm);
  const defsHtml = `<filter id="${scopedId}" ${attrs}>${materializedBody}</filter>`;
  const urlVars: Record<string, string> = {};
  urlVars[`--svg-filter-${localId}`] = `url(#${scopedId})`;
  return { defsHtml, urlVars };
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
  const words = hover ? ["THIS", "IS", "TEMPLATE"] : [t.name || t.id];
  const [activeIdx, setActiveIdx] = useState(0);
  const iv = useRef<number | null>(null);
  useEffect(() => {
    if (!hover || words.length <= 1) {
      setActiveIdx(0);
      if (iv.current) { window.clearInterval(iv.current); iv.current = null; }
      return;
    }
    setActiveIdx(0);
    iv.current = window.setInterval(() => setActiveIdx((i) => (i + 1) % words.length), 900);
    return () => { if (iv.current) { window.clearInterval(iv.current); iv.current = null; } };
  }, [hover, words.length]);
  const [scale, setScale] = useState(1);
  const previewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const p = previewRef.current;
    const c = contentRef.current;
    if (!p || !c) return;
    const pad = 4;
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

  const FONT_SIZE_PX = 57.6;
  const filterArtifacts = buildFilterArtifacts(t, t.id, FONT_SIZE_PX);
  const scopedCss = t.css
    ? scopeCss(t.css, t.id).replace(/filter:\s*url\(#([a-zA-Z0-9_-]+)\)/g, (_m, fid: string) => `filter: var(--svg-filter-${fid})`)
    : "";
  const splitLetters = !!t.json?.rendering?.splitWordsIntoLetters;

  const controlVars: Record<string, string> = {};
  if (t.json?.styleControls) {
    for (const ctl of t.json.styleControls) {
      const v =
        ctl.type === "toggle"
          ? ctl.default
            ? (ctl.valueOn ?? "1")
            : (ctl.valueOff ?? "0")
          : ctl.type === "color"
            ? String(ctl.default ?? "#ffffff")
            : String(ctl.default ?? 0) + (ctl.unit ?? "");
      controlVars[`--m2s-ctl-${ctl.id}`] = v;
    }
  }

  return (
    <button
      onClick={() => onSelect(t.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`group relative overflow-hidden rounded-xl border bg-black text-left transition-colors ${
        active ? "border-[#B6FF3B]" : "border-zinc-800 hover:border-zinc-700"
      }`}
      aria-label={t.name || t.id}
    >
      <div ref={previewRef} data-tid={t.id} className="relative flex aspect-[4/2] w-full items-center justify-center overflow-hidden p-2" style={CHECK_BG}>
        {scopedCss ? <style>{scopedCss}</style> : null}
        {filterArtifacts && (
          <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
            <defs dangerouslySetInnerHTML={{ __html: filterArtifacts.defsHtml }} />
          </svg>
        )}
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
              ...filterArtifacts?.urlVars,
            } as React.CSSProperties
          }
        >
          <div ref={contentRef} style={{ width: "max-content" } as React.CSSProperties}>
            <div key={hover ? "hov" : "idle"} className="segment flex items-center justify-center"
              style={
                {
                  ["--tscaps-primary-color" as string]: primary,
                  ["--tscaps-highlight-color" as string]: highlight,
                  ["--segment-char-count" as string]: String(words.join(" ").length),
                  ["--word-count" as string]: String(words.length),
                  ["--last-word-char-count" as string]: String(words[words.length - 1].length),
                  ["--segment-index" as string]: "0",
                  ["--segment-duration" as string]: "2",
                  ["--tscaps-text-direction" as string]: "ltr",
                  ["--on-segment-starts" as string]: hover ? "0s" : "-10s",
                  ...controlVars,
                } as React.CSSProperties
              }
            >
              <div className="line"
                style={
                  {
                    ["--word-count" as string]: String(words.length),
                    ["--last-word-char-count" as string]: String(words[words.length - 1].length),
                  } as React.CSSProperties
                }
              >
                {words.map((w, i) => {
                  const isHL = hover && i === activeIdx;
                  const isLast = i === words.length - 1;
                  const cls = [
                    "word",
                    isHL ? "word-being-narrated" : "",
                    isLast ? "last-word-in-line" : "",
                    i === 0 ? "first-word-in-line" : "",
                  ].filter(Boolean).join(" ");
                  const wordStyle = {
                    ["--on-word-being-narrated-starts" as string]: isHL ? "0s" : "-10s",
                    ["--word-being-narrated-duration" as string]: "0.9s",
                    ["--word-index" as string]: String(i),
                    ["--word-char-count" as string]: String(w.length),
                    ["--word-count" as string]: String(words.length),
                  } as React.CSSProperties;
                  if (!splitLetters) {
                    return (
                      <span
                        key={isHL ? `a-${activeIdx}` : `w-${i}`}
                        className={cls}
                        style={wordStyle}
                      >
                        {w}
                      </span>
                    );
                  }
                  const letters = w.split("");
                  const letterCount = letters.length;
                  return (
                    <span
                      key={isHL ? `a-${activeIdx}` : `w-${i}`}
                      className={cls}
                      style={wordStyle}
                    >
                      {letters.map((ch, li) => (
                        <span
                          key={li}
                          className="letter"
                          style={
                            {
                              ["--letter-index" as string]: String(li),
                              ["--letter-count" as string]: String(letterCount),
                            } as React.CSSProperties
                          }
                        >
                          {ch}
                        </span>
                      ))}
                    </span>
                  );
                })}
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
