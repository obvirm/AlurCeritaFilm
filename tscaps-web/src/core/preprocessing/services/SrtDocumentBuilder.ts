import {
  Document,
  Line,
  NarrationPace,
  Section,
  Segment,
  TimeFragment,
  Word,
} from '@tscaps/engine';
import { MAIN_SHEET_ID } from '@core/sheets/domain/Sheet';

const SRT_TIMECODE_RE =
  /^(\d{1,2}):(\d{2}):(\d{2})[,.](.{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](.{1,3})/;
const FORMATTING_TAG_RE = /<[^>]+>|\{[^}]+\}/g;
const BOM_RE = /^\uFEFF/;

interface SrtCue {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

/**
 * Builds an editable tscaps `Document` from a SubRip (SRT) caption
 * file. Each cue becomes one `Segment` carrying the cue's time range;
 * the cue text becomes a single `Line` whose `Word` timings are spread
 * across the range proportionally to character length (so karaoke
 * highlighting lights words in sequence). The section uses the main
 * sheet id so the editor treats it as the primary caption sheet.
 *
 * This mirrors the engine's internal `SrtTranscriber` — duplicated
 * here so the web app can build documents from the Movie2Short
 * pipeline's SRT output without touching the engine package.
 */
export function parseSrtToDocument(source: string): Document {
  const allWords: Word[] = [];
  const segments = parseCues(source).map((cue) => {
    const { segment, words } = buildSegmentFromCue(cue);
    allWords.push(...words);
    return segment;
  });
  return new Document({
    sections: [new Section({ segments, kind: MAIN_SHEET_ID })],
    narrationPace: NarrationPace.fromWords(allWords),
  });
}

function parseCues(source: string): SrtCue[] {
  const normalized = source.replace(BOM_RE, '').replace(/\r\n?/g, '\n').trim();
  if (normalized.length === 0) return [];
  return normalized
    .split(/\n{2,}/)
    .map((block) => parseCueBlock(block))
    .filter((cue): cue is SrtCue => cue !== null);
}

function parseCueBlock(block: string): SrtCue | null {
  const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const timecodeIndex = lines.findIndex((line) => SRT_TIMECODE_RE.test(line));
  if (timecodeIndex === -1) {
    throw new Error(`SRT block has no timecode line: ${JSON.stringify(block)}`);
  }
  const match = SRT_TIMECODE_RE.exec(lines[timecodeIndex]!);
  if (match === null) throw new Error(`Malformed SRT timecode: ${JSON.stringify(lines[timecodeIndex])}`);
  const startSeconds = toSeconds(match[1]!, match[2]!, match[3]!, match[4]!);
  const endSeconds = toSeconds(match[5]!, match[6]!, match[7]!, match[8]!);
  const text = lines.slice(timecodeIndex + 1).join(' ').replace(FORMATTING_TAG_RE, '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return null;
  return { startSeconds, endSeconds, text };
}

function toSeconds(hours: string, minutes: string, seconds: string, milliseconds: string): number {
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds.padEnd(3, '0')) / 1000
  );
}

function buildSegmentFromCue(cue: SrtCue): { segment: Segment; words: Word[] } {
  const tokens = cue.text.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return { segment: new Segment({ lines: [new Line({ words: [] })] }), words: [] };
  }
  const words = distributeWords(tokens, cue.startSeconds, cue.endSeconds);
  return { segment: new Segment({ lines: [new Line({ words })] }), words };
}

function distributeWords(
  tokens: ReadonlyArray<string>,
  startSeconds: number,
  endSeconds: number,
): Word[] {
  const totalWeight = tokens.reduce((sum, token) => sum + token.length, 0);
  const cueDuration = endSeconds - startSeconds;
  if (totalWeight === 0 || cueDuration <= 0) {
    return tokens.map((token) => new Word({ text: token, time: new TimeFragment(startSeconds, endSeconds) }));
  }
  const words: Word[] = [];
  let elapsedWeight = 0;
  for (const token of tokens) {
    const wordStart = startSeconds + (elapsedWeight / totalWeight) * cueDuration;
    elapsedWeight += token.length;
    const wordEnd = startSeconds + (elapsedWeight / totalWeight) * cueDuration;
    words.push(new Word({ text: token, time: new TimeFragment(wordStart, wordEnd) }));
  }
  return words;
}
