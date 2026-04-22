// Options page for Out Loud TTS Reader
// Uses shared constants from constants.js

const OPTIONS_DEFAULTS = {
  serverUrl: SERVER_URL,
  apiKey: "",
  voice: DEFAULT_VOICE,
  language: DEFAULT_LANGUAGE,
  speed: 1.0,
  format: "wav",
  autoPlay: false,
};

// DOM Elements
const form = document.getElementById("settings-form");
const serverUrlInput = document.getElementById("server-url");
const apiKeyInput = document.getElementById("api-key");
const languageSelect = document.getElementById("default-language");
const voiceSelect = document.getElementById("default-voice");
const speedSlider = document.getElementById("default-speed");
const speedDisplay = document.getElementById("speed-display");
const formatSelect = document.getElementById("default-format");
const autoPlayCheckbox = document.getElementById("auto-play");
const testConnectionBtn = document.getElementById("test-connection");
const connectionResult = document.getElementById("connection-result");
const resetBtn = document.getElementById("reset-btn");
const notification = document.getElementById("save-notification");

let settings = { ...OPTIONS_DEFAULTS };

// Initialize
async function init() {
  await loadSettings();
  setupEventListeners();
}

// Load settings from storage
async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get("outLoudSettings");
    if (stored.outLoudSettings) {
      settings = { ...OPTIONS_DEFAULTS, ...stored.outLoudSettings };
    }
    applySettingsToForm();
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

// Apply settings to form
function applySettingsToForm() {
  serverUrlInput.value = settings.serverUrl;
  apiKeyInput.value = settings.apiKey;
  languageSelect.value = settings.language;
  updateVoiceOptions();
  voiceSelect.value = settings.voice;
  speedSlider.value = settings.speed;
  speedDisplay.textContent = settings.speed.toFixed(1);
  formatSelect.value = settings.format;
  autoPlayCheckbox.checked = settings.autoPlay;
}

// Update voice options based on language
function updateVoiceOptions() {
  const lang = languageSelect.value;
  const voices = VOICES[lang] || VOICES["en-us"];

  voiceSelect.innerHTML = "";
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = `${voice.name} (${voice.gender})`;
    voiceSelect.appendChild(option);
  });

  // Select saved voice or first available
  const savedVoice = voices.find((v) => v.id === settings.voice);
  if (savedVoice) {
    voiceSelect.value = settings.voice;
  } else {
    voiceSelect.value = voices[0].id;
  }
}

// Setup event listeners
function setupEventListeners() {
  form.addEventListener("submit", handleSave);
  languageSelect.addEventListener("change", () => {
    updateVoiceOptions();
  });
  speedSlider.addEventListener("input", () => {
    speedDisplay.textContent = parseFloat(speedSlider.value).toFixed(1);
  });
  testConnectionBtn.addEventListener("click", testConnection);
  resetBtn.addEventListener("click", resetToDefaults);
}

// Save settings
async function handleSave(e) {
  e.preventDefault();

  settings = {
    serverUrl: serverUrlInput.value.trim() || OPTIONS_DEFAULTS.serverUrl,
    apiKey: apiKeyInput.value.trim(),
    language: languageSelect.value,
    voice: voiceSelect.value,
    speed: parseFloat(speedSlider.value),
    format: formatSelect.value,
    autoPlay: autoPlayCheckbox.checked,
  };

  try {
    await chrome.storage.sync.set({ outLoudSettings: settings });
    showNotification();
  } catch (e) {
    console.error("Failed to save settings:", e);
    alert("Failed to save settings. Please try again.");
  }
}

// Test connection to server
async function testConnection() {
  const url = serverUrlInput.value.trim() || OPTIONS_DEFAULTS.serverUrl;
  connectionResult.textContent = "Testing...";
  connectionResult.className = "connection-result";

  try {
    const headers = {};
    if (apiKeyInput.value.trim()) {
      headers["Authorization"] = `Bearer ${apiKeyInput.value.trim()}`;
    }

    const response = await fetch(`${url}/api/v1/audio/voices`, {
      method: "GET",
      headers,
    });

    if (response.ok) {
      connectionResult.textContent = "Connected!";
      connectionResult.className = "connection-result success";
    } else {
      connectionResult.textContent = `Error: ${response.status}`;
      connectionResult.className = "connection-result error";
    }
  } catch (e) {
    connectionResult.textContent = "Connection failed";
    connectionResult.className = "connection-result error";
  }
}

// Reset to defaults
function resetToDefaults() {
  if (confirm("Are you sure you want to reset all settings to defaults?")) {
    settings = { ...OPTIONS_DEFAULTS };
    applySettingsToForm();
  }
}

// Show save notification
function showNotification() {
  notification.classList.remove("hidden");
  setTimeout(() => {
    notification.classList.add("hidden");
  }, 3000);
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", init);
