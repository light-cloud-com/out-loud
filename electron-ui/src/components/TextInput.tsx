import { useMemo } from "react";

// Replicate server's text splitting logic exactly
// Server splits on punctuation followed by space, creating text chunks and silence chunks
function splitIntoChunks(
  text: string
): { text: string; start: number; end: number; isSilence: boolean }[] {
  const chunks: { text: string; start: number; end: number; isSilence: boolean }[] = [];

  // Split pattern: punctuation followed by whitespace
  // Server replaces: .\s+ ,\s+ ;\s+ :\s+ !\s+ ?\s+ \n+
  const splitRegex = /([.,;:!?]\s+|\n+)/g;

  let lastIndex = 0;
  let match;

  while ((match = splitRegex.exec(text)) !== null) {
    // Text before the punctuation
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        // For ! and ?, the punctuation stays with the text
        const punct = match[0].charAt(0);
        if (punct === "!" || punct === "?") {
          chunks.push({
            text: textBefore + punct,
            start: lastIndex,
            end: match.index + 1,
            isSilence: false,
          });
        } else {
          chunks.push({
            text: textBefore,
            start: lastIndex,
            end: match.index,
            isSilence: false,
          });
        }
      }
    }

    // The punctuation/whitespace becomes a silence chunk (not displayed but counted)
    const punct = match[0].charAt(0);
    if (punct !== "!" && punct !== "?") {
      chunks.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        isSilence: true,
      });
    } else {
      // For ! and ?, only the whitespace after is silence
      if (match[0].length > 1) {
        chunks.push({
          text: match[0].slice(1),
          start: match.index + 1,
          end: match.index + match[0].length,
          isSilence: true,
        });
      }
    }

    lastIndex = match.index + match[0].length;
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
}

export function TextInput({
  value,
  onChange,
  disabled,
  highlightChunk = false,
  currentChunkIndex = -1,
  totalChunks = 0,
  isPlaying = false,
}: TextInputProps) {
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

  return (
    <div className="mb-4 flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`h-full w-full select-text resize-none rounded-md border border-gray-700/50 bg-gray-800/50 px-3.5 py-3 text-base leading-relaxed text-gray-100 transition-all duration-200 placeholder:text-gray-500 hover:border-gray-600 hover:bg-gray-800/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${showHighlight ? "text-transparent caret-gray-100" : ""}`}
          placeholder="Enter text to speak..."
        />
        {showHighlight && (
          <div
            className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap rounded-md px-3.5 py-3 text-base leading-relaxed"
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
