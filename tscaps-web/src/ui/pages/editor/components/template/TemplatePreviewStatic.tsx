import { useMemo, type CSSProperties } from 'react';
import type { Template } from '@core/templates/domain/Template';
import { Line, Segment, TimeFragment, Word, type LineSplitter, type WordSplitter } from '@tscaps/engine';
import { LetterAnimationStyleBuilder } from '@presentation/editor/services/LetterAnimationStyleBuilder';
import { TemplatePreviewMock } from '@presentation/editor/services/TemplatePreviewMock';

const letterAnimationStyleBuilder = new LetterAnimationStyleBuilder();
const previewMock = new TemplatePreviewMock();

interface TemplatePreviewStaticProps {
  template: Template;
  letterSplitter: WordSplitter | null;
  /** Optional caption copy used by larger previews; cards default to the template name. */
  text?: string;
  /**
   * When provided, the copy is split into balanced lines with the template's
   * real line splitter before rendering, so each `.line` maps to exactly one
   * visual row (matching the final render's row count). Without it, words
   * wrap naturally inside the preview box.
   */
  lineSplitter?: LineSplitter | null;
}

/**
 * Resting frame of the preview, rendered while the card is not hovered.
 * Shows the template name as a single highlighted word.
 *
 * CSS vars must be passed at every level — templates often gate animations
 * on `--on-word-being-narrated-starts` and friends; without them the
 * `var()` call invalidates the whole `animation` shorthand and any
 * `opacity:0` base state stays hidden.
 */
export function TemplatePreviewStatic({ template, letterSplitter, text, lineSplitter }: TemplatePreviewStaticProps) {
  const displayText = text ?? template.metadata.name;
  const wordTexts = useMemo(
    () => displayText.trim().split(/\s+/).filter((w) => w.length > 0),
    [displayText],
  );
  // Letter-mode templates need t close to word.end so every letter's slot has
  // fired (all letters visible) but the last letter's cursor window is still
  // active. Non-letter-mode keeps t mid-word so any BEING_NARRATED highlight
  // is on at peak.
  const t = letterSplitter ? previewMock.wordDuration * 0.99 : previewMock.wordDuration / 2;

  const segment = useMemo(() => {
    if (lineSplitter) {
      // All words share one narration window so the frozen frame paints every
      // word in the same state (same look as the single-word card preview).
      const words = wordTexts.map(
        (wt) => new Word({ text: wt, time: new TimeFragment(0, previewMock.wordDuration) }),
      );
      const source = new Segment({ lines: [new Line({ words })] });
      return lineSplitter.split([source])[0] ?? source;
    }
    if (wordTexts.length > 1) return previewMock.buildFrameForWords(wordTexts).segment;
    return previewMock.singleWordFrame.segment;
  }, [lineSplitter, wordTexts]);

  const segTime = segment.time;
  const segVars = segment.getCssVariables(t, { indexInSection: 0 }) as CSSProperties;

  // Inline play-state pause overrides the template's `animation:` shorthand,
  // which CSS specs reset to `running`. Without this, templates with
  // `animation: ... infinite` (e.g. wave/bob, glow pulses) keep ticking on
  // every visible card, even though the preview is a single frozen frame.
  const segStyle = { animationPlayState: 'paused', animationFillMode: 'both', ...segVars } as CSSProperties;

  return (
    <div className={segment.getCssClasses(t).join(' ')} style={segStyle}>
      {[...segment.lines].map((entryLine, lineIndex) => {
        const lineVars = entryLine.getCssVariables(t, { segTime }) as CSSProperties;
        const lineStyle = { animationPlayState: 'paused', animationFillMode: 'both', ...lineVars } as CSSProperties;
        return (
          <div key={lineIndex} className={entryLine.getCssClasses(t).join(' ')} style={lineStyle}>
            {entryLine.words.map((entryWord, indexInLine) => {
              const wordVars = entryWord.getCssVariables(t, { segTime, indexInLine }) as Record<string, string>;
              const wordClass = entryWord.getCssClasses(t).join(' ');
              if (letterSplitter) {
                const letters = letterSplitter.split(entryWord.text);
                return (
                  <span
                    key={entryWord.text}
                    className={wordClass}
                    style={{
                      animationPlayState: 'paused',
                      animationFillMode: 'both',
                      ...wordVars,
                      ...letterAnimationStyleBuilder.buildWordContainerVars(letters.length),
                    }}
                  >
                    {letters.map((letter, i) => (
                      <span
                        key={i}
                        className="letter"
                        style={{
                          animationPlayState: 'paused',
                          animationFillMode: 'both',
                          ...letterAnimationStyleBuilder.buildLetterVars(i),
                        }}
                      >
                        {letter}
                      </span>
                    ))}
                  </span>
                );
              }
              return (
                <span
                  key={entryWord.text}
                  className={wordClass}
                  style={{
                    animationPlayState: 'paused',
                    animationFillMode: 'both',
                    ...wordVars,
                  } as CSSProperties}
                >
                  {entryWord.text}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
