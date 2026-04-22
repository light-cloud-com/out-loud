// Text highlighting

let currentChunkIndex = -1;
let totalChunks = 0;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function updateHighlight(textEl, overlay, isPlaying) {
  if (!overlay || !settings.highlightChunk || !isPlaying) {
    overlay?.classList.add("hidden");
    textEl?.classList.remove("highlighting");
    return;
  }

  const text = textEl.value;
  if (!text) {
    overlay.classList.add("hidden");
    textEl.classList.remove("highlighting");
    return;
  }

  const chunks = getTextChunks(text);
  if (chunks.length === 0) {
    overlay.classList.add("hidden");
    textEl.classList.remove("highlighting");
    return;
  }

  let idx = currentChunkIndex;
  if (idx < 0) idx = 0;
  if (idx >= chunks.length) idx = chunks.length - 1;

  let html = "";
  let lastEnd = 0;

  chunks.forEach((chunk, i) => {
    if (chunk.start > lastEnd) {
      html += `<span class="chunk">${escapeHtml(text.slice(lastEnd, chunk.start))}</span>`;
    }
    const active = i === idx ? " active" : "";
    html += `<span class="chunk${active}">${escapeHtml(text.slice(chunk.start, chunk.end))}</span>`;
    lastEnd = chunk.end;
  });

  if (lastEnd < text.length) {
    html += `<span class="chunk">${escapeHtml(text.slice(lastEnd))}</span>`;
  }

  overlay.innerHTML = html;
  overlay.classList.remove("hidden");
  textEl.classList.add("highlighting");

  overlay.querySelector(".chunk.active")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearHighlight(textEl, overlay) {
  currentChunkIndex = -1;
  totalChunks = 0;
  overlay?.classList.add("hidden");
  textEl?.classList.remove("highlighting");
}
