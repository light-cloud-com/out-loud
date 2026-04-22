// Text chunking for highlight sync (matches server logic)

function splitIntoChunks(text) {
  const chunks = [];
  const splitRegex = /([.,;:!?]\s+|\n+)/g;
  let lastIndex = 0;
  let match;

  while ((match = splitRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore.trim()) {
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

    const punct = match[0].charAt(0);
    if (punct !== "!" && punct !== "?") {
      chunks.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        isSilence: true,
      });
    } else if (match[0].length > 1) {
      chunks.push({
        text: match[0].slice(1),
        start: match.index + 1,
        end: match.index + match[0].length,
        isSilence: true,
      });
    }

    lastIndex = match.index + match[0].length;
  }

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

function getTextChunks(text) {
  return splitIntoChunks(text)
    .filter((chunk) => !chunk.isSilence)
    .map((chunk, i) => ({
      text: chunk.text,
      start: chunk.start,
      end: chunk.end,
      index: i,
    }));
}
