// Slack content script — adds a speaker button on message hover (and a context
// menu entry) that reads the message aloud through the local Out Loud app at
// SERVER_URL. Playback runs inline in the page via the shared
// StreamingAudioPlayer; nothing is sent anywhere except the local server.
//
// Loaded after constants.js (SERVER_URL, DEFAULT_VOICE, DEFAULT_VOLUME) and
// src/streaming-player.js (StreamingAudioPlayer), which share this isolated
// world.

(() => {
  // Slack's web DOM is React-managed; these selectors occasionally drift and
  // may need a touch-up. We degrade gracefully (fall back to container text).
  const MSG_SELECTOR = '[data-qa="message_container"]';
  const TEXT_SELECTORS = [
    '[data-qa="message-text"]',
    ".c-message_kit__blocks",
    ".p-rich_text_section",
  ];
  const BTN_CLASS = "ol-speak-btn";

  const ICON_SPEAK =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.06a7 7 0 0 1 0 13.48v2.06A9 9 0 0 0 14 3.2z"/></svg>';
  const ICON_STOP =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  let player = null;
  let activeBtn = null;
  let lastContextText = "";

  function getMessageText(container) {
    for (const sel of TEXT_SELECTORS) {
      const el = container.querySelector(sel);
      const text = el && el.innerText.trim();
      if (text) return text;
    }
    return container.innerText.trim();
  }

  // Prefer the running app's current voice/volume so it matches the desktop UI;
  // fall back to the extension defaults if the server can't be reached.
  async function getSettings() {
    let voice = typeof DEFAULT_VOICE !== "undefined" ? DEFAULT_VOICE : "af_heart";
    let volume = typeof DEFAULT_VOLUME !== "undefined" ? DEFAULT_VOLUME : 80;
    try {
      const res = await fetch(`${SERVER_URL}/api/v1/settings`, {
        headers: { Authorization: "Bearer x" },
      });
      if (res.ok) {
        const s = await res.json();
        if (s.voice) voice = s.voice;
        if (typeof s.volume === "number") volume = s.volume;
      }
    } catch (e) {
      // Server offline — use defaults; the play attempt below will no-op.
    }
    return { voice, volume };
  }

  function reset() {
    if (player) {
      try {
        player.stop();
      } catch (e) {}
      player = null;
    }
    if (activeBtn) {
      activeBtn.classList.remove("ol-playing");
      activeBtn.innerHTML = ICON_SPEAK;
      activeBtn = null;
    }
  }

  async function speak(text, btn) {
    if (!text) return;
    // Clicking the button that's already playing stops it.
    if (player && activeBtn === btn && btn) {
      reset();
      return;
    }
    reset();

    const { voice, volume } = await getSettings();
    player = new StreamingAudioPlayer();
    player.setVolume(volume / 100);
    player.onEnd = reset;
    player.onError = reset;

    activeBtn = btn || null;
    if (btn) {
      btn.classList.add("ol-playing");
      btn.innerHTML = ICON_STOP;
    }

    try {
      await player.playStreaming(`${SERVER_URL}/api/v1/audio/speech/stream`, {
        model: "model_q8f16",
        voice,
        input: text,
        speed: 1,
      });
    } catch (e) {
      // Local app not running / blocked — silently reset (offline-first).
      reset();
    }
  }

  function makeButton() {
    const btn = document.createElement("button");
    btn.className = BTN_CLASS;
    btn.type = "button";
    btn.title = "Read aloud with Out Loud";
    btn.setAttribute("aria-label", "Read aloud with Out Loud");
    btn.innerHTML = ICON_SPEAK;
    // Don't let clicks bubble into Slack's own message handlers.
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const container = btn.closest(MSG_SELECTOR);
      if (container) speak(getMessageText(container), btn);
    });
    return btn;
  }

  function inject(container) {
    if (container.querySelector(`:scope > .${BTN_CLASS}`)) return;
    if (!getMessageText(container)) return;
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(makeButton());
  }

  // Event delegation survives Slack's virtualized list (messages mount/unmount
  // on scroll) — we inject lazily the first time a message is hovered.
  document.addEventListener(
    "mouseover",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest(MSG_SELECTOR) : null;
      if (el) inject(el);
    },
    true
  );

  // Remember the right-clicked message so the background context-menu item can
  // ask us to read it.
  document.addEventListener(
    "contextmenu",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest(MSG_SELECTOR) : null;
      lastContextText = el ? getMessageText(el) : "";
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "SLACK_PLAY_LAST" && lastContextText) {
      speak(lastContextText, null);
    } else if (msg.type === "SLACK_STOP") {
      reset();
    }
    return false;
  });
})();
