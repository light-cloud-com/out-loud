// Settings management

let settings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get("ttsSettings");
    if (stored.ttsSettings) settings = { ...settings, ...stored.ttsSettings };

    const serverSettings = await fetchSettings();
    if (serverSettings) {
      settings = {
        ...settings,
        language: serverSettings.language || settings.language,
        voice: serverSettings.voice || settings.voice,
        volume: serverSettings.volume ?? settings.volume,
        highlightChunk: serverSettings.highlightChunk ?? settings.highlightChunk,
        text: serverSettings.text || settings.text,
      };
    }
  } catch (e) {}
}

async function saveSettings() {
  try {
    await chrome.storage.sync.set({ ttsSettings: settings });
    await postSettings(settings);
  } catch (e) {}
}

function updateVoiceOptions(languageSelect, voiceSelect) {
  const voices = VOICES[languageSelect.value] || VOICES["en-us"];
  voiceSelect.innerHTML = "";
  voices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = `${v.name} (${v.gender})`;
    voiceSelect.appendChild(opt);
  });
  if (!voices.find((v) => v.id === settings.voice)) {
    settings.voice = voices[0].id;
  }
  voiceSelect.value = settings.voice;
}
