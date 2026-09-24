/**
 * GENERIC tscaps renderer (browser-side) — memakai template tscaps apa pun.
 *
 * Config template (template.json + style.css + filters.svg) di-generate oleh
 * render.ts menjadi bundle.generated.ts
 * lalu di-import di sini. Halaman yang dibuka: template.html
 */
import {
  RenderPipelineBuilder,
  CompositeSegmentSplitter,
  BoundarySegmentSplitter,
  LimitByScaledCharsSegmentSplitter,
  BoundaryScoreLimitByCharsSegmentSplitter,
  FixedTailLineSplitter,
  SvgFilterDefinitionsParser,
  SrtSubtitleFileSerializer,
  WhisperTranscriber,
  MediaBunnyAudioDecoder,
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
  TEMPLATE_FONTS_CSS,
  TEMPLATE_FILTERS,
} from './bundle.generated';

declare global {
  interface Window {
    renderMovie2short(): Promise<void>;
    m2sSaveChunk(payload: { index: number; b64: string; last: boolean }): Promise<void>;
    m2sSaveSrt(srt: string): Promise<void>;
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
  } else if (s.type === 'boundary_score_limit_by_chars') {
    splitterInstances.push(new BoundaryScoreLimitByCharsSegmentSplitter({
      maxChars: Number(s.maxChars ?? 40),
      minChars: Number(s.minChars ?? 0),
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
  // Scope filter = nilai mentah TANPA unit (filter SVG makan token polos,
  // bukan nilai CSS — '0.12emem' invalid bikin outline hilang). Mirror
  // SheetSvgFilterScopeProvider studio.
  const FILTER_VALUES: Record<string, string> = {};
  for (const c of TEMPLATE_JSON.styleControls || []) {
    const v = c.default;
    if (v === undefined || v === null) continue;
    const key = `--tscaps-${c.id}`;
    if (c.type === 'toggle') FILTER_VALUES[key] = v ? String(c.valueOn ?? '1') : String(c.valueOff ?? '0');
    else FILTER_VALUES[key] = String(v);
  }
  class TemplateSvgFilterScopeProvider implements SvgFilterScopeProvider {
    scopeAt(context: SvgFilterRenderContext): SvgFilterScope {
      const t = Number(context.currentTime ?? 0);
      return SvgFilterScope.fromEntries(Object.entries({
        ...FILTER_VALUES,
        '--tscaps-tick': String(Math.floor(t * 30)),
        '--tscaps-tick-60': String(Math.floor(t * 60)),
        '--tscaps-time': String(t),
      }));
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
  const videoUrl = params.get('video') ?? '/input.mp4';
  const filename = params.get('output') ?? `final_short_captioned_${TEMPLATE_ID}.mp4`;
  const w = Number(params.get('width') || 1080);
  const h = Number(params.get('height') || 1920);

  console.log(`[tscaps-template] ${TEMPLATE_ID}: fetching ${videoUrl}`);
  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok) throw new Error(`Video fetch failed: ${videoResponse.status}`);
  // Font template harus ikut di-embed ke SVG (SVG-as-image tidak bisa baca
  // font dokumen). Engine menanam url() jadi base64 via CssResourceEmbedder.
  // TEMPLATE_FONTS_CSS ditanam saat generate bundle (Node) — bukan fetch,
  // karena Vite dev mengubah fetch *.css menjadi modul JS HMR.
  const fontsCss = TEMPLATE_FONTS_CSS || '';
  console.log(`[tscaps-template] fonts.css: ${fontsCss.length} chars`);
  // Pastikan font template ke-load sebelum render (tanpa ini fallback font
  // bikin metrik teks beda -> overflow kepotong kayak kasus Loki/Komika).
  try {
    const fam = String(typo.fontFamily ?? 'sans-serif');
    await Promise.all([
      document.fonts.load(`400 16px '${fam}'`),
      document.fonts.load(`700 16px '${fam}'`),
      document.fonts.load(`italic 400 16px '${fam}'`),
    ]);
  } catch { /* abaikan, lanjut dengan font yang ada */ }
  await document.fonts.ready;
  const inputBlob = await videoResponse.blob();

  // Patch transformers.js fetch to serve models from local HTTP cache instead of HF Hub.
  // The container runs a static file server on port 8877 with the model cache.
  // Different whisper models use different snapshot dirs (default, abc123, etc).
  const _origFetch = typeof globalThis.fetch !== 'undefined' ? globalThis.fetch.bind(globalThis) : undefined;
  if (_origFetch) {
    (globalThis as any).fetch = async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('huggingface.co') && url.includes('resolve/main')) {
        // HF URL: https://huggingface.co/onnx-community/whisper-X/resolve/main/path/to/file
        // Local: http://localhost:8877/models--onnx-community--whisper-X/snapshots/default/path/to=file
        const withoutDomain = url.replace('https://huggingface.co/', '');
        // Replace /resolve/main/ but keep the trailing slash before filename
        const withoutResolve = withoutDomain.replace('/resolve/main/', '/');
        const segs = withoutResolve.split('/').filter(s => s.length > 0);
        const local = 'http://localhost:8877/models--' + segs[0] + '--' + segs[1] + '/snapshots/default/' + segs.slice(2).join('/');
        console.log('[tscaps-template] HF redirect -> ' + local);
        return _origFetch(local, init);
      }
      return _origFetch(url, init);
    };
  }

  // Default transcriber is WhisperTranscriber with MediaBunnyAudioDecoder.
  // It listens to the audio from final_short.mp4 and produces word-level timing.
  const whisperModel = (params.get('whisper_quality') || 'medium') as 'tiny' | 'base' | 'small' | 'medium';
  const builder = new RenderPipelineBuilder()
    .withInputVideo(inputBlob)
    // Model whisper HANYA dibaca di constructor transcriber (default 'base').
    // withTranscriberOptions({model}) diabaikan engine 0.4.0 — inject eksplisit.
    .withTranscriber(new WhisperTranscriber(new MediaBunnyAudioDecoder(), { model: whisperModel }))
    .withTranscriberOptions({ language: params.get('language') || 'id', model: whisperModel });
  if (segmentSplitter) builder.withSegmentSplitter(segmentSplitter);
  if (line.type === 'fixed-tail') {
    builder.withLineSplitter(new FixedTailLineSplitter({
      tailWordCount: Number(line.tailWordCount ?? 3),
    }));
  } else {
    builder.withDefaultLineSplitterConfig(lineConfig);
  }
  builder
    .withSubtitleStyle({
      css: `${fontsCss}\n${TEMPLATE_CSS}`,
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
  // Simpan SRT dari Document (whisper transcript + timing) — gagal simpan
  // SRT tidak boleh menggagalkan video.
  try {
    const doc = pipeline.getDocument();
    if (doc) {
      const srt = new SrtSubtitleFileSerializer().serialize({ document: doc, granularity: 'segment' });
      await window.m2sSaveSrt(srt);
      console.log(`[tscaps-template] sent srt (${srt.length} chars)`);
    }
  } catch (e) {
    console.log(`[tscaps-template] srt skip: ${e instanceof Error ? e.message : String(e)}`);
  }
  await sendBlobChunked(result.blob);
};

const CHUNK_BYTES = 16 * 1024 * 1024;

async function sendBlobChunked(blob: Blob): Promise<void> {
  const total = blob.size;
  let index = 0;
  for (let offset = 0; offset < total; offset += CHUNK_BYTES) {
    const slice = blob.slice(offset, offset + CHUNK_BYTES);
    const b64 = await blobToBase64(slice);
    await window.m2sSaveChunk({ index, b64, last: offset + CHUNK_BYTES >= total });
    index += 1;
  }
  console.log(`[tscaps-template] sent ${index} chunks (${total} bytes)`);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const url = String(reader.result || '');
      const comma = url.indexOf(',');
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function describe(event: PipelineProgressEvent): string {
  if (event.stage === 'rendering') {
    return `[tscaps-template] Rendering ${event.inner.percent}% (${event.inner.currentFrame}/${event.inner.totalFrames})`;
  }
  if ('status' in event) return `[tscaps-template] ${event.stage}: ${event.status}`;
  return `[tscaps-template] ${event.stage}`;
}
