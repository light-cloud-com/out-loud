// Playback control

let streamingPlayer = null;
let audio = null;
let isPlaying = false;
let isPaused = false;
let cachedAudio = { text: "", voice: "", chunks: [] };

function createPlayerCallbacks(ui) {
  return {
    onStart: () => {
      isPlaying = true;
      isPaused = false;
      ui.updateUI();
      ui.playBtn.disabled = false;
    },
    onChunkChange: (idx, total) => {
      currentChunkIndex = idx;
      totalChunks = total;
      ui.updateHighlight();
    },
    onEnd: () => {
      isPlaying = false;
      isPaused = false;
      ui.clearHighlight();
      ui.updateUI();
      ui.enableControls(true);
    },
    onError: () => {
      isPlaying = false;
      isPaused = false;
      ui.clearHighlight();
      ui.updateUI();
      ui.enableControls(true);
    },
  };
}

async function togglePlayback(ui) {
  if (isPaused && streamingPlayer) {
    await streamingPlayer.resume();
    isPaused = false;
    isPlaying = true;
    ui.updateUI();
    return;
  }

  if (isPlaying && streamingPlayer) {
    await streamingPlayer.pause();
    isPaused = true;
    isPlaying = false;
    ui.updateUI();
    return;
  }

  const text = ui.getText();
  if (!text) return;

  const canUseCache =
    cachedAudio.text === text &&
    cachedAudio.voice === settings.voice &&
    cachedAudio.chunks.length > 0;

  if (canUseCache) {
    await playCached(ui);
    return;
  }

  if (!(await checkServer())) return;

  stopPlayback(ui);
  ui.playBtn.disabled = true;
  ui.enableControls(false);

  try {
    await playStream(ui);
  } catch (e) {
    try {
      await playBlocking(ui);
    } catch (e2) {
      isPlaying = false;
      isPaused = false;
      ui.updateUI();
      ui.enableControls(true);
      ui.playBtn.disabled = !text;
    }
  }
}

async function playCached(ui) {
  streamingPlayer = new StreamingAudioPlayer();
  streamingPlayer.setVolume(settings.volume / 100);
  ui.playBtn.disabled = true;
  ui.enableControls(false);

  const cb = createPlayerCallbacks(ui);
  streamingPlayer.onStart = cb.onStart;
  streamingPlayer.onChunkChange = cb.onChunkChange;
  streamingPlayer.onEnd = cb.onEnd;
  streamingPlayer.onError = cb.onError;

  await streamingPlayer.playCached(cachedAudio.chunks);
  ui.playBtn.disabled = !ui.getText();
}

async function playStream(ui) {
  streamingPlayer = new StreamingAudioPlayer();
  streamingPlayer.setVolume(settings.volume / 100);

  const cb = createPlayerCallbacks(ui);
  streamingPlayer.onStart = cb.onStart;
  streamingPlayer.onChunkChange = cb.onChunkChange;
  streamingPlayer.onEnd = () => {
    cachedAudio = {
      text: ui.getText(),
      voice: settings.voice,
      chunks: streamingPlayer.getChunks(),
    };
    cb.onEnd();
  };
  streamingPlayer.onError = () => {
    streamingPlayer = null;
    cb.onError();
  };

  await streamingPlayer.playStreaming(`${SERVER_URL}/api/v1/audio/speech/stream`, {
    model: "model_q8f16",
    voice: settings.voice,
    input: ui.getText(),
    speed: 1,
  });

  ui.playBtn.disabled = !ui.getText();
}

async function playBlocking(ui) {
  try {
    const blob = await fetchAudio(ui.getText(), settings.voice, "mp3");
    const url = URL.createObjectURL(blob);

    audio = new Audio(url);
    audio.volume = settings.volume / 100;
    audio.onended = () => {
      isPlaying = false;
      ui.updateUI();
      ui.enableControls(true);
      URL.revokeObjectURL(url);
    };

    await audio.play();
    isPlaying = true;
    ui.updateUI();
  } catch (e) {
    ui.enableControls(true);
    document.getElementById("download-banner")?.classList.remove("hidden");
  } finally {
    ui.playBtn.disabled = !ui.getText();
  }
}

function stopPlayback(ui) {
  streamingPlayer?.stop();
  streamingPlayer = null;

  if (audio) {
    audio.pause();
    URL.revokeObjectURL(audio.src);
    audio = null;
  }

  isPlaying = false;
  isPaused = false;
  ui.clearHighlight();
  ui.updateUI();
  ui.enableControls(true);
}

function setVolume(vol) {
  streamingPlayer?.setVolume(vol);
  if (audio) audio.volume = vol;
}

function clearCache() {
  cachedAudio = { text: "", voice: "", chunks: [] };
}

function hasCachedAudio() {
  return cachedAudio.chunks.length > 0;
}

function getCachedText() {
  return cachedAudio.text;
}
