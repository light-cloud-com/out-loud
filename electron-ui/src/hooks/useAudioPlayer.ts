import { useState, useRef, useCallback, useEffect } from "react";
import { track } from "../lib/analytics";

// How many chunks ahead of the playhead the worker may generate during normal
// playback (backpressure). Download/export lifts this cap to generate fully.
const AHEAD = 20;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface ChunkTiming {
  startTime: number;
  endTime: number;
}

interface AudioPlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  chunkProgress: number;
  playProgress: number;
  stats: string;
  info: string;
  error: string | null;
  currentChunkIndex: number;
  totalChunks: number;
  canDownload: boolean;
  isExporting: boolean;
}

export function useAudioPlayer(getVolume: () => number) {
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    isPaused: false,
    chunkProgress: 0,
    playProgress: 0,
    stats: "-",
    info: "Ready",
    error: null,
    currentChunkIndex: -1,
    totalChunks: 0,
    canDownload: false,
    isExporting: false,
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const lastPlayedTextRef = useRef("");
  const cachedAudioBuffersRef = useRef<AudioBuffer[]>([]);
  const cachedKeyRef = useRef("");
  const animationFrameRef = useRef<number | null>(null);

  // Refs for playback tracking (to avoid stale closures)
  const playbackStartTimeRef = useRef<number>(0);
  const scheduledEndTimeRef = useRef<number>(0);
  const totalScheduledDurationRef = useRef<number>(0);
  const allChunksReceivedRef = useRef<boolean>(false);
  const chunksReceivedRef = useRef<number>(0);
  const totalChunksRef = useRef<number>(0);
  const textBasedEstimateRef = useRef<number>(0);
  const chunkTimingsRef = useRef<ChunkTiming[]>([]);

  // Cleanup listeners ref
  const cleanupListenersRef = useRef<(() => void)[]>([]);

  // Flow control: the active generation's id, the last buffer-target we sent
  // (monotonic during normal playback), and export bookkeeping.
  const currentReqIdRef = useRef<string | null>(null);
  const lastSentTargetRef = useRef<number>(-1);
  const pendingExportRef = useRef<boolean>(false);
  const exportWavRef = useRef<() => void>(() => {});

  const stopAudio = useCallback(() => {
    // Cancel any in-flight worker generation so it doesn't keep running (and a
    // backpressure-parked generation doesn't sit idle) after teardown/Stop.
    if (currentReqIdRef.current) {
      window.electronAPI?.cancelGeneration(currentReqIdRef.current);
      currentReqIdRef.current = null;
    }
    pendingExportRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    scheduledSourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch (_) {
        /* ignore */
      }
    });
    scheduledSourcesRef.current = [];
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    gainNodeRef.current = null;
    setState((s) => ({
      ...s,
      isPlaying: false,
      isPaused: false,
      isExporting: false,
      canDownload: false,
      currentChunkIndex: -1,
    }));
    // Notify main process
    window.electronAPI?.setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    stopAudio();
    setState((s) => ({
      ...s,
      playProgress: 0,
      stats: "Stopped",
      info: "Stopped",
    }));
  }, [stopAudio]);

  const setVolume = useCallback((vol: number) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = vol / 100;
    }
  }, []);

  // Find current chunk based on playback time
  const getCurrentChunkIndex = useCallback((currentTime: number): number => {
    const timings = chunkTimingsRef.current;
    for (let i = 0; i < timings.length; i++) {
      if (currentTime >= timings[i].startTime && currentTime < timings[i].endTime) {
        return i;
      }
    }
    // If past all chunks, return last chunk
    if (timings.length > 0 && currentTime >= timings[timings.length - 1].endTime) {
      return timings.length - 1;
    }
    return -1;
  }, []);

  // Playback progress updater for streaming
  const updatePlayback = useCallback(() => {
    if (!audioCtxRef.current || playbackStartTimeRef.current === 0) return;

    const now = audioCtxRef.current.currentTime;
    const elapsed = Math.max(0, now - playbackStartTimeRef.current);
    const remaining = Math.max(0, scheduledEndTimeRef.current - now);
    const currentChunk = getCurrentChunkIndex(now);

    // Backpressure: keep the worker generating ~AHEAD chunks past the playhead.
    // Monotonic during normal playback (only send when the target grows); a
    // forced full export sets lastSentTargetRef to MAX so these no-op until an
    // export-cancel re-arms it. Pausing stops this loop, so generation idles.
    if (currentChunk >= 0 && !allChunksReceivedRef.current && currentReqIdRef.current) {
      const target = currentChunk + AHEAD;
      if (target > lastSentTargetRef.current) {
        lastSentTargetRef.current = target;
        window.electronAPI?.setBufferTarget(currentReqIdRef.current, target);
      }
    }

    // Calculate display duration with estimation during streaming
    let displayDuration: number;
    if (allChunksReceivedRef.current) {
      // All chunks received - use actual duration
      displayDuration = scheduledEndTimeRef.current - playbackStartTimeRef.current;
    } else if (chunksReceivedRef.current > 0 && totalChunksRef.current > 0) {
      // Estimate based on chunks received so far
      const actualDuration = scheduledEndTimeRef.current - playbackStartTimeRef.current;
      const avgChunkDuration = totalScheduledDurationRef.current / chunksReceivedRef.current;
      const remainingChunks = totalChunksRef.current - chunksReceivedRef.current;
      const chunkBasedEstimate = actualDuration + remainingChunks * avgChunkDuration;
      const weight = chunksReceivedRef.current / totalChunksRef.current;
      displayDuration = textBasedEstimateRef.current * (1 - weight) + chunkBasedEstimate * weight;
    } else {
      // No chunks yet - use text-based estimate
      displayDuration = textBasedEstimateRef.current;
    }

    if (displayDuration > 0) {
      const pct = Math.min(100, (elapsed / displayDuration) * 100);
      const suffix = allChunksReceivedRef.current ? "" : "~";
      setState((s) => ({
        ...s,
        playProgress: pct,
        stats: `${formatTime(elapsed)} / ${suffix}${formatTime(displayDuration)}`,
        currentChunkIndex: currentChunk,
        totalChunks: totalChunksRef.current,
      }));
    }

    if (remaining > 0.05 || !allChunksReceivedRef.current) {
      animationFrameRef.current = requestAnimationFrame(updatePlayback);
    } else {
      const finalDuration = scheduledEndTimeRef.current - playbackStartTimeRef.current;
      setState((s) => ({
        ...s,
        isPlaying: false,
        playProgress: 100,
        stats: `Done (${formatTime(finalDuration)})`,
        info: `Finished! (${formatTime(finalDuration)})`,
        currentChunkIndex: -1,
      }));
      window.electronAPI?.setPlaying(false);
    }
  }, [getCurrentChunkIndex]);

  // Playback progress updater for cached audio
  const updateCachedPlayback = useCallback(() => {
    if (!audioCtxRef.current) return;

    const now = audioCtxRef.current.currentTime;
    const elapsed = Math.max(0, now - playbackStartTimeRef.current);
    const totalDuration = scheduledEndTimeRef.current - playbackStartTimeRef.current;
    const pct = Math.min(100, (elapsed / totalDuration) * 100);
    const currentChunk = getCurrentChunkIndex(now);

    setState((s) => ({
      ...s,
      playProgress: pct,
      stats: `${formatTime(elapsed)} / ${formatTime(totalDuration)}`,
      currentChunkIndex: currentChunk,
      totalChunks: chunkTimingsRef.current.length,
    }));

    if (now < scheduledEndTimeRef.current - 0.05) {
      animationFrameRef.current = requestAnimationFrame(updateCachedPlayback);
    } else {
      setState((s) => ({
        ...s,
        isPlaying: false,
        playProgress: 100,
        stats: `Done (${formatTime(totalDuration)})`,
        info: `Finished! (${formatTime(totalDuration)})`,
        currentChunkIndex: -1,
      }));
      window.electronAPI?.setPlaying(false);
    }
  }, [getCurrentChunkIndex]);

  const play = useCallback(
    async (text: string, voice: string, language: string, opts?: { forceRestart?: boolean }) => {
      if (!text.trim()) return;

      // Check if electronAPI is available
      if (!window.electronAPI) {
        setState((s) => ({
          ...s,
          info: "ERROR: Not running in Electron",
          error: "Not running in Electron",
        }));
        return;
      }

      // If playing, toggle pause — unless the caller forces a fresh start
      // (talker mode: each Enter re-speaks the new line, never pauses).
      if (!opts?.forceRestart && state.isPlaying && audioCtxRef.current) {
        if (state.isPaused) {
          // Resume - but if text changed, start over
          if (text !== lastPlayedTextRef.current) {
            stopAudio();
            // Fall through to start fresh
          } else {
            audioCtxRef.current.resume();
            setState((s) => ({ ...s, isPaused: false, info: "Playing..." }));
            // Restart the animation frame
            animationFrameRef.current = requestAnimationFrame(
              cachedKeyRef.current === `${text}|${voice}|${language}` &&
                allChunksReceivedRef.current
                ? updateCachedPlayback
                : updatePlayback
            );
            return;
          }
        } else {
          // Pause
          const now = audioCtxRef.current.currentTime;
          const elapsed = Math.max(0, now - playbackStartTimeRef.current);
          const duration = scheduledEndTimeRef.current - playbackStartTimeRef.current;
          const wasCached =
            cachedKeyRef.current === `${text}|${voice}|${language}` && allChunksReceivedRef.current;
          audioCtxRef.current.suspend();
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }
          setState((s) => ({ ...s, isPaused: true, info: "Paused" }));
          track("quick_speak_paused", {
            ...(duration > 0
              ? { progress_pct: Math.min(100, Math.max(0, (elapsed / duration) * 100)) }
              : {}),
            was_cached: wasCached,
          });
          return;
        }
      }

      stopAudio();
      lastPlayedTextRef.current = text;

      // Reset tracking refs
      playbackStartTimeRef.current = 0;
      scheduledEndTimeRef.current = 0;
      totalScheduledDurationRef.current = 0;
      allChunksReceivedRef.current = false;
      chunksReceivedRef.current = 0;
      totalChunksRef.current = 0;
      chunkTimingsRef.current = [];

      setState((s) => ({
        ...s,
        isPlaying: true,
        isPaused: false,
        chunkProgress: 0,
        playProgress: 0,
        stats: "-",
        info: "Starting...",
        error: null,
        canDownload: false,
      }));
      window.electronAPI.setPlaying(true);

      const currentKey = `${text}|${voice}|${language}`;

      // Check if we have cached audio for this text/voice/lang
      if (cachedKeyRef.current === currentKey && cachedAudioBuffersRef.current.length > 0) {
        setState((s) => ({
          ...s,
          chunkProgress: 100,
          stats: "Cached",
          info: "Playing from cache...",
          canDownload: true,
        }));

        try {
          audioCtxRef.current = new AudioContext();
          gainNodeRef.current = audioCtxRef.current.createGain();
          gainNodeRef.current.gain.value = getVolume() / 100;
          gainNodeRef.current.connect(audioCtxRef.current.destination);
          scheduledSourcesRef.current = [];
          chunkTimingsRef.current = [];

          let scheduledEndTime = audioCtxRef.current.currentTime + 0.1;
          playbackStartTimeRef.current = scheduledEndTime;

          for (const buffer of cachedAudioBuffersRef.current) {
            const source = audioCtxRef.current.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNodeRef.current);
            source.start(scheduledEndTime);

            // Record chunk timing
            chunkTimingsRef.current.push({
              startTime: scheduledEndTime,
              endTime: scheduledEndTime + buffer.duration,
            });

            scheduledEndTime += buffer.duration;
            scheduledSourcesRef.current.push(source);
          }

          scheduledEndTimeRef.current = scheduledEndTime;
          allChunksReceivedRef.current = true;
          totalChunksRef.current = cachedAudioBuffersRef.current.length;

          animationFrameRef.current = requestAnimationFrame(updateCachedPlayback);
          return;
        } catch (e: unknown) {
          console.error("Cache playback error:", e);
        }
      }

      // Clear cache for new generation
      cachedAudioBuffersRef.current = [];
      cachedKeyRef.current = currentKey;

      // Mint a request id for this generation so we can drive its buffer target
      // and cancel it. (stopAudio above already cancelled any previous one.)
      const reqId = crypto.randomUUID();
      currentReqIdRef.current = reqId;
      lastSentTargetRef.current = -1;
      pendingExportRef.current = false;

      // Set text-based estimate
      const CHARS_PER_SECOND = 14;
      textBasedEstimateRef.current = text.trim().length / CHARS_PER_SECOND;

      setState((s) => ({
        ...s,
        chunkProgress: 0,
        playProgress: 0,
        stats: "Starting...",
        info: "Generating speech...",
      }));

      try {
        // Set up audio context
        audioCtxRef.current = new AudioContext();
        gainNodeRef.current = audioCtxRef.current.createGain();
        gainNodeRef.current.gain.value = getVolume() / 100;
        gainNodeRef.current.connect(audioCtxRef.current.destination);
        scheduledSourcesRef.current = [];

        let firstChunkTime: number | null = null;
        const BUFFER_TIME = 0.1;
        let playbackTrackingStarted = false;

        // Clean up previous listeners
        cleanupListenersRef.current.forEach((cleanup) => cleanup());
        cleanupListenersRef.current = [];

        // Set up IPC listeners for audio chunks
        const cleanupChunk = window.electronAPI.onAudioChunk(async (data) => {
          // Ignore stale chunks from a just-cancelled request that arrive after
          // this play() swapped in its listener (rapid restart race).
          if (data.requestId && data.requestId !== reqId) return;
          const { chunkIndex, totalChunks, base64 } = data;
          totalChunksRef.current = totalChunks;
          chunksReceivedRef.current++;

          if (!firstChunkTime && audioCtxRef.current) {
            firstChunkTime = performance.now();
            playbackStartTimeRef.current = audioCtxRef.current.currentTime + BUFFER_TIME;
            scheduledEndTimeRef.current = playbackStartTimeRef.current;
            if (!playbackTrackingStarted) {
              playbackTrackingStarted = true;
              animationFrameRef.current = requestAnimationFrame(updatePlayback);
            }
          }

          // Decode and schedule this chunk
          try {
            if (!audioCtxRef.current || !gainNodeRef.current) return;

            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            const audioBuffer = await audioCtxRef.current.decodeAudioData(bytes.buffer.slice(0));
            cachedAudioBuffersRef.current.push(audioBuffer);
            const source = audioCtxRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(gainNodeRef.current);

            const now = audioCtxRef.current.currentTime;
            if (scheduledEndTimeRef.current < now) {
              scheduledEndTimeRef.current = now + 0.01;
            }

            chunkTimingsRef.current.push({
              startTime: scheduledEndTimeRef.current,
              endTime: scheduledEndTimeRef.current + audioBuffer.duration,
            });

            source.start(scheduledEndTimeRef.current);
            scheduledEndTimeRef.current += audioBuffer.duration;
            totalScheduledDurationRef.current += audioBuffer.duration;
            scheduledSourcesRef.current.push(source);
          } catch (decodeErr) {
            console.error("Decode error:", decodeErr);
          }

          const pct =
            totalChunks > 0
              ? Math.round(((chunkIndex + 1) / totalChunks) * 100)
              : Math.min(95, (chunksReceivedRef.current / (chunksReceivedRef.current + 2)) * 100);
          setState((s) => ({
            ...s,
            chunkProgress: pct,
            info: `Generating...`,
            // Download is usable mid-stream — it's the "make an audio file"
            // action that forces full generation (see download()).
            canDownload: true,
          }));
        });

        const cleanupComplete = window.electronAPI.onStreamComplete(() => {
          allChunksReceivedRef.current = true;

          if (chunksReceivedRef.current === 0) {
            setState((s) => ({
              ...s,
              info: "ERROR: No audio chunks received",
              error: "No audio chunks received. The TTS worker finished without producing audio.",
              isPlaying: false,
            }));
            stopAudio();
            return;
          }

          setState((s) => ({
            ...s,
            info: "Playing...",
            canDownload: true,
          }));

          // If a Download/export was waiting on full generation, build it now.
          if (pendingExportRef.current) {
            pendingExportRef.current = false;
            setState((s) => ({ ...s, isExporting: false }));
            exportWavRef.current();
          }
        });

        const cleanupError = window.electronAPI.onError((error) => {
          setState((s) => ({
            ...s,
            info: `ERROR: ${error}`,
            error,
            isPlaying: false,
          }));
          stopAudio();
        });

        cleanupListenersRef.current = [cleanupChunk, cleanupComplete, cleanupError];

        // Start TTS generation via IPC. initialTarget caps generation to ~AHEAD
        // chunks until updatePlayback advances it (backpressure for long docs).
        await window.electronAPI.generateStreamingTTS({
          voice,
          text,
          speed: 1,
          requestId: reqId,
          initialTarget: AHEAD,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setState((s) => ({
          ...s,
          info: `ERROR: ${message}`,
          error: message,
          isPlaying: false,
        }));
        stopAudio();
      }
    },
    [state.isPlaying, state.isPaused, stopAudio, getVolume, updatePlayback, updateCachedPlayback]
  );

  // Cleanup listeners + cancel any active generation on unmount.
  useEffect(() => {
    return () => {
      cleanupListenersRef.current.forEach((cleanup) => cleanup());
      if (currentReqIdRef.current) {
        window.electronAPI?.cancelGeneration(currentReqIdRef.current);
        currentReqIdRef.current = null;
      }
    };
  }, []);

  // Build a WAV from all generated chunks and trigger a browser download.
  const exportWav = useCallback(() => {
    if (cachedAudioBuffersRef.current.length === 0) return;

    const buffers = cachedAudioBuffersRef.current;
    const sampleRate = buffers[0].sampleRate;
    const numChannels = buffers[0].numberOfChannels;
    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);

    const offlineCtx = new OfflineAudioContext(numChannels, totalLength, sampleRate);
    let offset = 0;
    for (const buffer of buffers) {
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(offlineCtx.destination);
      source.start(offset / sampleRate);
      offset += buffer.length;
    }

    offlineCtx.startRendering().then((renderedBuffer) => {
      const wavData = audioBufferToWav(renderedBuffer);
      const blob = new Blob([wavData], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);

      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.T]/g, "-").slice(0, 19);
      const filename = `out-loud-${timestamp}.wav`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      track("audio_downloaded", { duration_seconds: renderedBuffer.duration });
    });
  }, []);

  // Keep a stable ref so the per-play onStreamComplete handler can build the WAV
  // once a forced full generation finishes.
  useEffect(() => {
    exportWavRef.current = exportWav;
  }, [exportWav]);

  // Download = "turn this into an audio file". If everything is already
  // generated (cache or stream complete), export now; otherwise force full
  // generation (lift the backpressure cap) and export when it completes.
  const download = useCallback(() => {
    if (allChunksReceivedRef.current) {
      exportWav();
      return;
    }
    if (!currentReqIdRef.current) return;
    pendingExportRef.current = true;
    setState((s) => ({ ...s, isExporting: true }));
    // Pin the sent-target to MAX so updatePlayback's monotonic guard stops
    // sending currentChunk+AHEAD, which would otherwise re-cap (the worker SETS
    // the target). cancelExport resets this to re-arm normal buffering.
    lastSentTargetRef.current = Number.MAX_SAFE_INTEGER;
    window.electronAPI?.forceFullGeneration(currentReqIdRef.current);
  }, [exportWav]);

  // Cancel an in-progress export: stop forcing full generation and re-arm the
  // normal ~AHEAD buffer from the playhead, so playback continues uninterrupted.
  const cancelExport = useCallback(() => {
    if (!pendingExportRef.current) return;
    pendingExportRef.current = false;
    setState((s) => ({ ...s, isExporting: false }));
    if (currentReqIdRef.current && audioCtxRef.current) {
      const currentChunk = getCurrentChunkIndex(audioCtxRef.current.currentTime);
      const target = Math.max(0, currentChunk) + AHEAD;
      lastSentTargetRef.current = target;
      window.electronAPI?.setBufferTarget(currentReqIdRef.current, target);
    }
  }, [getCurrentChunkIndex]);

  return {
    ...state,
    play,
    stop,
    setVolume,
    download,
    cancelExport,
  };
}

// Convert AudioBuffer to WAV format
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  // Interleave channels and write samples
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let writeOffset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(writeOffset, int16, true);
      writeOffset += 2;
    }
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
