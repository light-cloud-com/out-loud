import { useEffect, useMemo, useRef } from "react";
import { track } from "../lib/analytics";

// Pause tags the worker turns into silence (mirrors normalizePauseTags in
// tts-worker.ts): [1s] / [500ms] / <pause=1s> / <break time="1s"/>.
const PAUSE_TAG_SOURCE =
  String.raw`\[\s*\d*\.?\d+\s*(?:ms|s)\s*\]` +
  String.raw`|<\s*pause\s*=\s*"?\d*\.?\d+\s*(?:ms|s)?"?\s*\/?\s*>` +
  String.raw`|<\s*break\s+time\s*=\s*["']?\d*\.?\d+\s*(?:ms|s)?["']?\s*\/?\s*>`;
const PAUSE_TAG_RE = new RegExp(`^(?:${PAUSE_TAG_SOURCE})$`, "i");

// Replicate server's text splitting logic exactly
// Server splits on punctuation followed by space, creating text chunks and silence chunks
function splitIntoChunks(
  text: string
): { text: string; start: number; end: number; isSilence: boolean }[] {
  const chunks: { text: string; start: number; end: number; isSilence: boolean }[] = [];

  // Split pattern: punctuation that the worker turns into a pause, newlines, OR
  // an explicit pause tag. Mirrors sanitizeText() in tts-worker.ts (keep in
  // sync) so the highlight stays aligned with the audio through every pause:
  // ellipsis (…/...), em-dash (—), spaced en-dash/hyphen, then .,;:!? + space.
  const splitRegex = new RegExp(
    `(\\s*(?:…|\\.{3,})\\s*|\\s*—\\s*|\\s+[–-]\\s+|[.,;:!?]\\s+|\\n+|${PAUSE_TAG_SOURCE})`,
    "gi"
  );

  let lastIndex = 0;
  let match;

  while ((match = splitRegex.exec(text)) !== null) {
    const delimiter = match[0];
    const isPause = PAUSE_TAG_RE.test(delimiter);
    const punct = delimiter.charAt(0);
    // For ! and ?, the punctuation stays with the spoken text; pause tags don't.
    const keepsPunct = !isPause && (punct === "!" || punct === "?");

    // Text before the delimiter
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        chunks.push({
          text: keepsPunct ? textBefore + punct : textBefore,
          start: lastIndex,
          end: keepsPunct ? match.index + 1 : match.index,
          isSilence: false,
        });
      }
    }

    // The delimiter (punctuation/whitespace/pause tag) becomes a silence chunk:
    // counted toward the chunk index, never highlighted as spoken text.
    if (keepsPunct) {
      // For ! and ?, only the whitespace after is silence
      if (delimiter.length > 1) {
        chunks.push({
          text: delimiter.slice(1),
          start: match.index + 1,
          end: match.index + delimiter.length,
          isSilence: true,
        });
      }
    } else {
      chunks.push({
        text: delimiter,
        start: match.index,
        end: match.index + delimiter.length,
        isSilence: true,
      });
    }

    lastIndex = match.index + delimiter.length;
  }

  // Remaining text after last match
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining.trim()) {
      chunks.push({
        text: remaining,
        start: lastIndex,
        end: text.length,
        isSilence: false,
      });
    }
  }

  return chunks;
}

// Get only text chunks (not silence) for display
function getTextChunks(
  text: string
): { text: string; start: number; end: number; index: number }[] {
  const allChunks = splitIntoChunks(text);
  const textChunks: { text: string; start: number; end: number; index: number }[] = [];

  allChunks.forEach((chunk, i) => {
    if (!chunk.isSilence) {
      textChunks.push({
        text: chunk.text,
        start: chunk.start,
        end: chunk.end,
        index: i, // Index in ALL chunks (including silence)
      });
    }
  });

  return textChunks;
}

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  highlightChunk?: boolean;
  currentChunkIndex?: number;
  totalChunks?: number;
  isPlaying?: boolean;
  /**
   * If set, an inline "Load example" link appears when the field is empty.
   * Lets users who cleared the field recover the demo text without DevTools.
   */
  exampleText?: string;
  /** Called when the user asks to speak via the keyboard. */
  onSpeak?: () => void;
  /** Ref to the underlying textarea so the app can refocus it (Esc hotkey). */
  inputRef?: React.RefObject<HTMLTextAreaElement>;
}

export function TextInput({
  value,
  onChange,
  disabled,
  highlightChunk = false,
  currentChunkIndex = -1,
  totalChunks = 0,
  isPlaying = false,
  exampleText,
  onSpeak,
  inputRef,
}: TextInputProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const textChunks = useMemo(() => getTextChunks(value), [value]);

  const showHighlight = highlightChunk && isPlaying && currentChunkIndex >= 0 && totalChunks > 0;

  // Find which text chunk corresponds to current audio chunk
  const highlightedTextChunkIndex = useMemo(() => {
    if (!showHighlight || textChunks.length === 0) return -1;

    // Find the text chunk that matches or is closest to currentChunkIndex
    for (let i = 0; i < textChunks.length; i++) {
      if (textChunks[i].index === currentChunkIndex) {
        return i;
      }
      // If current chunk is a silence chunk, highlight the text chunk before it
      if (textChunks[i].index > currentChunkIndex) {
        return Math.max(0, i - 1);
      }
    }

    // If past all chunks, return last text chunk
    return textChunks.length - 1;
  }, [showHighlight, textChunks, currentChunkIndex]);

  // Keep the spoken chunk centered in view while highlighting (auto-scroll is
  // part of the same option as the highlight). The textarea is the source of
  // truth for scroll position; the overlay mirrors it (here and via the
  // textarea's onScroll handler), so the two never drift apart.
  useEffect(() => {
    if (!showHighlight) return;
    const span = highlightRef.current;
    const ta = inputRef?.current;
    if (!span || !ta) return;
    const target = Math.max(0, span.offsetTop - ta.clientHeight / 2 + span.offsetHeight / 2);
    ta.scrollTop = target;
    if (overlayRef.current) overlayRef.current.scrollTop = target;
  }, [highlightedTextChunkIndex, showHighlight, inputRef]);

  return (
    <div className="mb-4 flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter (or ⌘/Ctrl+Enter) speaks; Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSpeak?.();
            }
          }}
          onScroll={(e) => {
            // The highlight overlay is a separate element; mirror the textarea's
            // scroll onto it so the visible text never lags the caret/selection.
            const overlay = overlayRef.current;
            if (overlay) {
              overlay.scrollTop = e.currentTarget.scrollTop;
              overlay.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          disabled={disabled}
          autoFocus
          aria-label="Text to speak"
          className={`h-full w-full select-text resize-none overflow-x-hidden break-words rounded-md border border-gray-700/50 bg-gray-800/50 px-3.5 py-3 text-base leading-relaxed text-gray-100 transition-all duration-200 placeholder:text-gray-500 hover:border-gray-600 hover:bg-gray-800/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${showHighlight ? "text-transparent caret-gray-100" : ""}`}
          placeholder="Type, Enter to speak (Shift+Enter for a new line)…"
        />
        {!value && !disabled && exampleText && (
          <button
            type="button"
            onClick={() => {
              track("example_text_loaded");
              onChange(exampleText);
            }}
            className="absolute bottom-3 right-3 cursor-pointer rounded-md border border-gray-700/60 bg-gray-900/70 px-2 py-1 text-[11px] text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-200"
          >
            Load example
          </button>
        )}
        {showHighlight && (
          <div
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-transparent px-3.5 py-3 text-base leading-relaxed"
            aria-hidden="true"
          >
            {(() => {
              // Build segments preserving all text including spaces between chunks
              const segments: { text: string; isHighlighted: boolean }[] = [];
              let lastEnd = 0;

              textChunks.forEach((chunk, i) => {
                // Add text before this chunk (spaces, punctuation)
                if (chunk.start > lastEnd) {
                  segments.push({
                    text: value.slice(lastEnd, chunk.start),
                    isHighlighted: false,
                  });
                }
                // Add the chunk itself
                segments.push({
                  text: value.slice(chunk.start, chunk.end),
                  isHighlighted: i === highlightedTextChunkIndex,
                });
                lastEnd = chunk.end;
              });

              // Add any remaining text after last chunk
              if (lastEnd < value.length) {
                segments.push({
                  text: value.slice(lastEnd),
                  isHighlighted: false,
                });
              }

              return segments.map((seg, i) => (
                <span
                  key={i}
                  ref={seg.isHighlighted ? highlightRef : undefined}
                  className={
                    seg.isHighlighted ? "rounded-sm bg-indigo-500/90 text-white" : "text-gray-400"
                  }
                  style={
                    seg.isHighlighted
                      ? { boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }
                      : undefined
                  }
                >
                  {seg.text}
                </span>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
