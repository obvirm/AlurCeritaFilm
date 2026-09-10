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
    .replaceAll(".letter", `${p} .letter`)
    .replaceAll(".word-decoration", `${p} .word-decoration`)
    .replaceAll(".segment-decorations-above", `${p} .segment-decorations-above`)
    .replaceAll(".segment-decorations-below", `${p} .segment-decorations-below`)
    .replaceAll(".tscaps-video-frame-layer", `${p} .tscaps-video-frame-layer`)
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
  out = out.replace(/<tscaps:chromatic-split\s+([^>]*?)\/>/g, (_m, attrs: string) => {
    const g = (n: string, d: string) => { const m = attrs.match(new RegExp(`${n}="([^"]*)"`)); return m ? m[1] : d; };
    const x = g("x", "0.045");
    const y = g("y", "0.03");
    const colorA = g("color-a", "#ff2e63");
    const colorB = g("color-b", "#1fffd0");
    return `<feOffset in="SourceAlpha" dx="${x}em" dy="${y}em" result="split-a-shape"/><feFlood flood-color="${colorA}" result="split-a-ink"/><feComposite in="split-a-ink" in2="split-a-shape" operator="in" result="split-a"/><feOffset in="SourceAlpha" dx="-${x}em" dy="-${y}em" result="split-b-shape"/><feFlood flood-color="${colorB}" result="split-b-ink"/><feComposite in="split-b-ink" in2="split-b-shape" operator="in" result="split-b"/>`;
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
  const filterEls = doc.querySelectorAll("filter");
  if (!filterEls.length) return null;

  let defsHtml = "";
  const urlVars: Record<string, string> = {};
  for (const filterEl of filterEls) {
    const localId = filterEl.getAttribute("id") || "filter";
    const scopedId = `tscaps-filter-${scopeKey}-${localId}`;
    const attrs = Array.from(filterEl.attributes).filter((a) => a.name !== "id").map((a) => `${a.name}="${a.value}"`).join(" ");
    const materializedBody = materializeFilter(filterEl.innerHTML, controls, pxPerEm);
    defsHtml += `<filter id="${scopedId}" ${attrs}>${materializedBody}</filter>`;
    urlVars[`--svg-filter-${localId}`] = `url(#${scopedId})`;
  }
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
    <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
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
  const WORD_DUR = 0.5;
  const hoverWords = ["This", "is", "tscaps"];
  const idleWord = [t.name || t.id];
  const words = hover ? hoverWords : idleWord;
  const [currentTime, setCurrentTime] = useState(0);

  // Idle: time = WORD_DUR/2 (word-being-narrated active, all letters visible for letter mode)
  // Hover: rAF drives currentTime from 0..totalDuration, cycling every 1.5s.
  const totalDuration = hoverWords.length * WORD_DUR;
  const idleTime = WORD_DUR / 2;

  useEffect(() => {
    if (!hover) {
      setCurrentTime(0);
      return;
    }
    let startTime: number | null = null;
    let rafId: number;
    const tick = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = (timestamp - startTime) / 1000;
      setCurrentTime(elapsed % totalDuration);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [hover, totalDuration]);

  const time = hover ? currentTime : idleTime;

  // Build mock segment/line/word state exactly like tscaps engine.
  // Single word (idle): word spans 0..WORD_DUR, t = WORD_DUR/2 (being narrated).
  // Multi-word (hover): words span 0..WORD_DUR, WORD_DUR..2*WORD_DUR, etc.
  // Segment spans 0..totalDuration (or WORD_DUR for idle).
  const segStart = 0;
  const segEnd = hover ? totalDuration : WORD_DUR;
  const segDuration = segEnd - segStart;
  const segCharCount = words.join(" ").length;
  const wordCount = words.length;
  const lastWordCharCount = words[words.length - 1]?.length || 0;

  // Segment vars
   const segVars: Record<string, string> = {
     ["--on-segment-starts" as string]: `${(segStart - time).toFixed(3)}s`,
     ["--on-segment-ends" as string]: `${(segEnd - time).toFixed(3)}s`,
     ["--segment-duration" as string]: `${segDuration.toFixed(3)}s`,
     ["--segment-char-count" as string]: String(segCharCount),
     ["--segment-index" as string]: "0",
     ["--word-count" as string]: String(wordCount),
     ["--last-word-char-count" as string]: String(lastWordCharCount),
     ["--tscaps-primary-color" as string]: primary,
     ["--tscaps-highlight-color" as string]: highlight,
     ["--tscaps-text-direction" as string]: "ltr",
   };

  // Line vars (single line, spans full segment)
  const lineStart = segStart;
  const lineEnd = segEnd;
   const lineVars: Record<string, string> = {
     ["--on-line-not-narrated-yet-starts" as string]: `${(segStart - time).toFixed(3)}s`,
     ["--on-line-not-narrated-yet-ends" as string]: `${(lineStart - time).toFixed(3)}s`,
     ["--line-not-narrated-yet-duration" as string]: `${(lineStart - segStart).toFixed(3)}s`,
     ["--on-line-being-narrated-starts" as string]: `${(lineStart - time).toFixed(3)}s`,
     ["--on-line-being-narrated-ends" as string]: `${(lineEnd - time).toFixed(3)}s`,
     ["--line-being-narrated-duration" as string]: `${(lineEnd - lineStart).toFixed(3)}s`,
     ["--on-line-already-narrated-starts" as string]: `${(lineEnd - time).toFixed(3)}s`,
     ["--on-line-already-narrated-ends" as string]: `${(segEnd - time).toFixed(3)}s`,
     ["--line-already-narrated-duration" as string]: `${(segEnd - lineEnd).toFixed(3)}s`,
     ["--word-count" as string]: String(wordCount),
     ["--last-word-char-count" as string]: String(lastWordCharCount),
   };

   // Determine line state class
   let lineState = "line-being-narrated";
   if (time < lineStart) lineState = "line-not-narrated-yet";
   else if (time >= lineEnd) lineState = "line-already-narrated";
  const lineClasses = ["line", lineState].filter(Boolean).join(" ");

  // Build wrapper vars (styleControls + typography) — copied from previous implementation
  const renderControlValue = (ctl: {
    type: string;
    default?: string | number | boolean;
    unit?: string;
    valueOn?: string;
    valueOff?: string;
    options?: Array<{ value: string | number | boolean; cssValue?: string }>;
  }): string | null => {
    const d = ctl.default;
    if (ctl.type === "toggle") return d ? (ctl.valueOn ?? "1") : (ctl.valueOff ?? "0");
    if (ctl.type === "select") {
      const m = ctl.options?.find((o) => o.value === d);
      return m?.cssValue ?? String(d ?? "");
    }
    if (ctl.type === "text") return `"${String(d ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    if (ctl.type === "image") return null;
    if (ctl.type === "font") return String(d ?? "");
    if (typeof d === "number" && ctl.unit) return `${d}${ctl.unit}`;
    return String(d ?? "");
  };

  const tscapsVars: Record<string, string> = {};
  if (t.json?.styleControls) {
    for (const ctl of t.json.styleControls) {
      const v = renderControlValue(ctl);
      if (v !== null) tscapsVars[`--tscaps-${ctl.id}`] = v;
    }
  }
  const ty = t.json?.typography;
  if (ty) {
    if (ty.fontFamily) tscapsVars["--tscaps-font-family"] = String(ty.fontFamily);
    if (ty.fontSize != null) tscapsVars["--tscaps-font-size"] = `${ty.fontSize}cqh`;
    if (ty.fontWeight != null) tscapsVars["--tscaps-font-weight"] = String(ty.fontWeight);
    if (ty.letterSpacing != null) tscapsVars["--tscaps-letter-spacing"] = `${ty.letterSpacing}em`;
    if (ty.wordSpacing != null) tscapsVars["--tscaps-word-spacing"] = `${ty.wordSpacing}em`;
    if (ty.lineSpacing != null) tscapsVars["--tscaps-line-spacing"] = `${ty.lineSpacing}em`;
    if (ty.textCase) tscapsVars["--tscaps-text-transform"] = String(ty.textCase);
    if (ty.textAlign) {
      tscapsVars["--tscaps-text-align"] =
        ty.textAlign === "start" ? "left" : ty.textAlign === "end" ? "right" : String(ty.textAlign);
    }
    tscapsVars["--tscaps-font-style"] = ty.italic ? "italic" : "normal";
    const decos: string[] = [];
    if (ty.underline) decos.push("underline");
    if (ty.strikethrough) decos.push("line-through");
    if (decos.length > 0) tscapsVars["--tscaps-text-decoration"] = decos.join(" ");
  }

  // pxPerEm from typography
  const fontSizeCqh = t.json?.typography?.fontSize ?? 4.5;
  const pxPerEm = fontSizeCqh * (1280 / 100);
  const filterArtifacts = buildFilterArtifacts(t, t.id, pxPerEm);

  // FROZEN_FRAME_CSS
  const FROZEN_FRAME_CSS = '*, *::before, *::after { animation-play-state: paused !important; animation-fill-mode: both !important; }';
  const scopedCss = t.css
    ? `${scopeCss(FROZEN_FRAME_CSS, t.id)}\n${scopeCss(t.css, t.id).replace(/filter:\s*url\(#([a-zA-Z0-9_-]+)\)/g, (_m, fid: string) => `filter: var(--svg-filter-${fid})`)}`
    : scopeCss(FROZEN_FRAME_CSS, t.id);

  const splitLetters = !!t.json?.rendering?.splitWordsIntoLetters;

  // Scaling
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
            <div className="segment flex items-center justify-center" style={{ ...segVars, ...tscapsVars } as React.CSSProperties}>
              <div className={lineClasses} style={lineVars as React.CSSProperties}>
                {words.map((w, i) => {
                  const wordStart = i * WORD_DUR;
                  const wordEnd = (i + 1) * WORD_DUR;
                  const wordDuration = wordEnd - wordStart;

                  // Determine word state
                  let state: "not-narrated-yet" | "being-narrated" | "already-narrated";
                  if (time < wordStart) state = "not-narrated-yet";
                  else if (time >= wordEnd) state = "already-narrated";
                  else state = "being-narrated";

                  const stateClass = `word-${state}`;

                  const isFirst = i === 0;
                  const isLast = i === words.length - 1;

                   const wordVars: Record<string, string> = {
                     ["--on-word-not-narrated-yet-starts" as string]: `${(segStart - time).toFixed(3)}s`,
                     ["--on-word-not-narrated-yet-ends" as string]: `${(wordStart - time).toFixed(3)}s`,
                     ["--word-not-narrated-yet-duration" as string]: `${(wordStart - segStart).toFixed(3)}s`,
                     ["--on-word-being-narrated-starts" as string]: `${(wordStart - time).toFixed(3)}s`,
                     ["--on-word-being-narrated-ends" as string]: `${(wordEnd - time).toFixed(3)}s`,
                     ["--word-being-narrated-duration" as string]: `${wordDuration.toFixed(3)}s`,
                     ["--on-word-already-narrated-starts" as string]: `${(wordEnd - time).toFixed(3)}s`,
                     ["--on-word-already-narrated-ends" as string]: `${(segEnd - time).toFixed(3)}s`,
                     ["--word-already-narrated-duration" as string]: `${(segEnd - wordEnd).toFixed(3)}s`,
                     ["--word-index" as string]: String(i),
                     ["--word-char-count" as string]: String(w.length),
                     ["--word-count" as string]: String(wordCount),
                   };

                  const cls = [
                    "word",
                    stateClass,
                    isFirst ? "first-word-in-line" : "",
                    isLast ? "last-word-in-line" : "",
                  ].filter(Boolean).join(" ");

                  if (!splitLetters) {
                    return (
                      <span key={`w-${i}`} className={cls} style={wordVars as React.CSSProperties}>
                        {w}
                      </span>
                    );
                  }

                  const letters = w.split("");
                  const letterCount = letters.length;
                  return (
                    <span key={`w-${i}`} className={cls} style={wordVars as React.CSSProperties}>
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