// Sidepanel init and event wiring

const ui = {
  textEl: null,
  voiceSelect: null,
  languageSelect: null,
  playBtn: null,
  downloadBtn: null,
  volumeSlider: null,
  volumeValue: null,
  highlightCheckbox: null,
  overlay: null,

  getText() {
    return this.textEl.value.trim();
  },
  updateUI() {
    const icon = this.playBtn.querySelector(".play-icon");
    icon.innerHTML = isPlaying
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<path d="M8 5v14l11-7z"/>';
    if (this.downloadBtn) this.downloadBtn.disabled = !hasCachedAudio();
  },
  updateHighlight() {
    updateHighlight(this.textEl, this.overlay, isPlaying);
  },
  clearHighlight() {
    clearHighlight(this.textEl, this.overlay);
  },
  enableControls(enabled) {
    this.textEl.disabled = !enabled;
    this.languageSelect.disabled = !enabled;
    this.voiceSelect.disabled = !enabled;
  },
};

async function init() {
  ui.textEl = document.getElementById("selected-text");
  ui.voiceSelect = document.getElementById("voice-select");
  ui.languageSelect = document.getElementById("language-select");
  ui.playBtn = document.getElementById("play-btn");
  ui.downloadBtn = document.getElementById("download-btn");
  ui.volumeSlider = document.getElementById("volume-slider");
  ui.volumeValue = document.getElementById("volume-value");
  ui.highlightCheckbox = document.getElementById("highlight-checkbox");
  ui.overlay = document.getElementById("text-highlight-overlay");

  const retryBtn = document.getElementById("retry-btn");
  retryBtn?.addEventListener("click", async () => {
    retryBtn.textContent = "Checking...";
    retryBtn.disabled = true;
    await checkServer();
    retryBtn.textContent = "Retry Connection";
    retryBtn.disabled = false;
  });

  await loadSettings();
  applySettings();
  bindEvents();
  await checkServer();
  listenForMessages();
}

function applySettings() {
  ui.languageSelect.value = settings.language;
  updateVoiceOptions(ui.languageSelect, ui.voiceSelect);
  ui.voiceSelect.value = settings.voice;
  if (ui.volumeSlider) {
    ui.volumeSlider.value = settings.volume;
    ui.volumeValue.textContent = settings.volume + "%";
  }
  if (ui.highlightCheckbox) ui.highlightCheckbox.checked = settings.highlightChunk;
  if (settings.text) {
    ui.textEl.value = settings.text;
    ui.playBtn.disabled = false;
  }
}

function bindEvents() {
  ui.languageSelect.addEventListener("change", () => {
    settings.language = ui.languageSelect.value;
    updateVoiceOptions(ui.languageSelect, ui.voiceSelect);
    saveSettings();
    clearCache();
  });

  ui.voiceSelect.addEventListener("change", () => {
    settings.voice = ui.voiceSelect.value;
    saveSettings();
    clearCache();
  });

  ui.textEl.addEventListener("input", () => {
    settings.text = ui.getText();
    ui.playBtn.disabled = !settings.text;
    clearCache();
    saveSettings();
  });

  ui.volumeSlider?.addEventListener("input", () => {
    settings.volume = parseInt(ui.volumeSlider.value);
    ui.volumeValue.textContent = settings.volume + "%";
    setVolume(settings.volume / 100);
    saveSettings();
  });

  ui.highlightCheckbox?.addEventListener("change", () => {
    settings.highlightChunk = ui.highlightCheckbox.checked;
    saveSettings();
    isPlaying ? ui.updateHighlight() : ui.clearHighlight();
  });

  ui.playBtn.addEventListener("click", () => togglePlayback(ui));
  ui.downloadBtn?.addEventListener("click", download);
}

function listenForMessages() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TEXT_SELECTED" || msg.type === "PLAY_TEXT") {
      const text = msg.text.trim();
      if (text && text !== ui.getText()) {
        stopPlayback(ui);
        clearCache();
        ui.textEl.value = text;
        ui.playBtn.disabled = false;
      }
      if (msg.type === "PLAY_TEXT") togglePlayback(ui);
    }
  });
}

async function download() {
  if (!hasCachedAudio() || !(await checkServer())) return;

  ui.downloadBtn.disabled = true;
  ui.downloadBtn.innerHTML = '<div class="spinner small"></div>';

  try {
    const blob = await fetchAudio(getCachedText(), settings.voice, "wav");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "out-loud-audio.wav";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {}

  ui.downloadBtn.disabled = !hasCachedAudio();
  ui.downloadBtn.innerHTML =
    '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
}

document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
