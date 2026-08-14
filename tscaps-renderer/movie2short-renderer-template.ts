/**
 * GENERIC tscaps renderer (browser-side) — memakai template tscaps apa pun.
 *
 * Config template (template.json + style.css + filters.svg) di-generate oleh
 * render-movie2short-template.ts menjadi movie2short-template-bundle.generated.ts
 * lalu di-import di sini. Halaman yang dibuka: movie2short-renderer-template.html
 */
import {
  RenderPipelineBuilder,
  SrtTranscriber,
  CompositeSegmentSplitter,
  BoundarySegmentSplitter,
  LimitByScaledCharsSegmentSplitter,
  SvgFilterDefinitionsParser,
  SvgFilterScope,
  SvgFilterBundle,
  type SvgFilterRenderContext,
  type SvgFilterScopeProvider,
  type SvgFilterLengthFactors,
  type PipelineProgressEvent,
} from '@tscaps/engine';
import {
  TEMPLATE_ID,
  TEMPLATE_JSON,
  TEMPLATE_CSS,
  TEMPLATE_FILTERS,
} from './movie2short-template-bundle.generated';

declare global {
  interface Window {
    renderMovie2short(): Promise<void>;
  }
}

const PRESET_CHARS: Record<string, readonly string[]> = {
  none: [],
  sentence: ['.', '?', '!', '...', '."', '?"', '!"', '..."'],
  clause: ['.', '?', '!', '...', ',', ';', ':', '."', '?"', '!"', '..."', ',"', ';"', ':"'],
};

// typography + styleControls -> --tscaps-* vars
const typo = TEMPLATE_JSON.typography || {};
const FONT_SIZE_CQH = Number(typo.fontSize ?? 3);
const STYLE_VALUES: Record<string, string> = {
  '--tscaps-font-family': `'${typo.fontFamily ?? 'sans-serif'}'`,
  '--tscaps-font-size': `${FONT_SIZE_CQH}cqh`,
  '--tscaps-font-weight': String(typo.fontWeight ?? 400),
  '--tscaps-letter-spacing': `${typo.letterSpacing ?? 0}em`,
  '--tscaps-word-spacing': `${typo.wordSpacing ?? 0.1}em`,
  '--tscaps-line-spacing': `${typo.lineSpacing ?? 0.1}em`,
  '--tscaps-text-transform': typo.textCase ?? 'none',
  '--tscaps-text-align': typo.textAlign ?? 'center',
  '--tscaps-font-style': typo.italic ? 'italic' : 'normal',
};
for (const c of TEMPLATE_JSON.styleControls || []) {
  const v = c.default;
  if (v === undefined || v === null) continue;
  const key = `--tscaps-${c.id}`;
  if (c.type === 'color') STYLE_VALUES[key] = String(v);
  else if (c.type === 'float' || c.type === 'integer') STYLE_VALUES[key] = c.unit ? `${v}${c.unit}` : String(v);
  else if (c.type === 'toggle') STYLE_VALUES[key] = v ? (c.valueOn ?? '1') : (c.valueOff ?? '0');
  else STYLE_VALUES[key] = String(v);
}

// segment splitter
const splitterInstances: any[] = [];
for (const s of TEMPLATE_JSON.segmentSplitters || []) {
  if (s.type === 'boundary') {
    const mode = s.mode === 'clause' ? 'clause' : s.mode === 'custom' ? 'clause' : 'sentence';
    splitterInstances.push(new BoundarySegmentSplitter({ separators: PRESET_CHARS[mode] || PRESET_CHARS.sentence }));
  } else if (s.type === 'limit_by_scaled_chars') {
    splitterInstances.push(new LimitByScaledCharsSegmentSplitter({
      maxChars: Number(s.maxChars ?? 22),
      minChars: Number(s.minChars ?? 0),
      scale: 1,
    }));
  } else {
    console.warn(`[tscaps-template] splitter tidak didukung: ${s.type}`);
  }
}
const segmentSplitter = splitterInstances.length > 1
  ? new CompositeSegmentSplitter(splitterInstances)
  : splitterInstances[0];

// line splitter
const line = TEMPLATE_JSON.lineSplitter || {};
const lineConfig = {
  maxLines: Number(line.maxLines ?? 2),
  minLines: Number(line.minLines ?? 1),
  maxWidthRatio: Number(line.maxWidthRatio ?? 0.8),
};

// alignment
const align = TEMPLATE_JSON.alignment || {};
const alignment = {
  verticalAlign: (align.verticalAlign ?? 'bottom') as any,
  verticalOffset: Number(align.verticalOffset ?? 0.8),
  horizontalAlign: (align.horizontalAlign ?? 'center') as any,
  horizontalOffset: Number(align.horizontalOffset ?? 0.5),
};

// svg filters (jika template punya filters.svg)
let svgFilters: any;
if (TEMPLATE_FILTERS) {
  class TemplateSvgFilterScopeProvider implements SvgFilterScopeProvider {
    scopeAt(_context: SvgFilterRenderContext): SvgFilterScope {
      return SvgFilterScope.fromEntries(Object.entries(STYLE_VALUES));
    }
    lengthFactorsAt(context: SvgFilterRenderContext): SvgFilterLengthFactors {
      const pxPerCqh = context.renderHeightPx / 100;
      return { pxPerCqh, pxPerEm: FONT_SIZE_CQH * pxPerCqh };
    }
  }
  svgFilters = new SvgFilterBundle(
    new SvgFilterDefinitionsParser().parse(TEMPLATE_FILTERS),
    new TemplateSvgFilterScopeProvider(),
  );
}

window.renderMovie2short = async () => {
  const params = new URLSearchParams(window.location.search);
  const videoUrl = params.get('video') ?? '/movie2short-input.mp4';
  const srtUrl = params.get('srt') ?? '/movie2short-captions.srt';
  const filename = params.get('output') ?? `final_short_captioned_${TEMPLATE_ID}.mp4`;
  const w = Number(params.get('width') || 1080);
  const h = Number(params.get('height') || 1920);

  console.log(`[tscaps-template] ${TEMPLATE_ID}: fetching ${videoUrl} + ${srtUrl}`);
  const [videoResponse, srtResponse] = await Promise.all([fetch(videoUrl), fetch(srtUrl)]);
  if (!videoResponse.ok) throw new Error(`Video fetch failed: ${videoResponse.status}`);
  if (!srtResponse.ok) throw new Error(`SRT fetch failed: ${srtResponse.status}`);
  const [inputBlob, srt] = await Promise.all([videoResponse.blob(), srtResponse.text()]);

  const builder = new RenderPipelineBuilder()
    .withInputVideo(inputBlob)
    .withTranscriber(new SrtTranscriber(srt));
  if (segmentSplitter) builder.withSegmentSplitter(segmentSplitter);
  builder
    .withDefaultLineSplitterConfig(lineConfig)
    .withSubtitleStyle({
      css: TEMPLATE_CSS,
      inlineStyles: STYLE_VALUES,
      alignment,
      rendering: {
        splitWordsIntoLetters: false,
        videoFrame: { required: false, jpegQuality: 0.8 },
        padding: null,
      },
      ...(svgFilters ? { svgFilters } : {}),
    })
    .withOutputFormat('mp4')
    .withOutputResolution(w, h)
    .withQuality('high');

  const pipeline = builder.build();
  const result = await pipeline.run((event) => console.log(describe(event)));
  if (result.blob === null) throw new Error('tscaps returned no output blob');
  triggerDownload(result.blob, filename);
};

function describe(event: PipelineProgressEvent): string {
  if (event.stage === 'rendering') {
    return `[tscaps-template] Rendering ${event.inner.percent}% (${event.inner.currentFrame}/${event.inner.totalFrames})`;
  }
  if ('status' in event) return `[tscaps-template] ${event.stage}: ${event.status}`;
  return `[tscaps-template] ${event.stage}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
