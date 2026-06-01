// A short, quiet "click" played the instant speech generation starts, so the
// talker user gets immediate eyes-closed feedback that their Enter registered.
let ctx: AudioContext | null = null;

export function playClick() {
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    // Quick percussive envelope (~120ms) that won't clash with the speech.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  } catch {
    // Audio is best-effort feedback; never let it break speaking.
  }
}
