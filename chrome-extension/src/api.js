// Server API

let isConnected = false;
let healthCheckInterval = null;

async function checkServer() {
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/audio/voices`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      const voices = Array.isArray(data) ? data : data?.voices;
      if (voices?.length > 0) {
        isConnected = true;
        document.getElementById("download-banner")?.classList.add("hidden");
        startHealthCheck(10000);
        return true;
      }
    }
  } catch (e) {}

  isConnected = false;
  document.getElementById("download-banner")?.classList.remove("hidden");
  startHealthCheck(3000);
  return false;
}

function startHealthCheck(interval) {
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  healthCheckInterval = setInterval(checkServer, interval);
}

async function fetchSettings() {
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/settings`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (res.ok) return res.json();
  } catch (e) {}
  return null;
}

async function postSettings(settings) {
  if (!isConnected) return;
  try {
    await fetch(`${SERVER_URL}/api/v1/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
      signal: AbortSignal.timeout(2000),
    });
  } catch (e) {}
}

async function fetchAudio(text, voice, format = "wav") {
  const res = await fetch(`${SERVER_URL}/api/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer x" },
    body: JSON.stringify({
      model: "model_q8f16",
      voice,
      input: text,
      response_format: format,
      speed: 1,
    }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.blob();
}
