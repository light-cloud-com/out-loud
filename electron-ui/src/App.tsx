import { useCallback, useEffect, useRef, useState } from "react";
import { TextInput } from "./components/TextInput";
import { VoiceSelect } from "./components/VoiceSelect";
import { VolumeSlider } from "./components/VolumeSlider";
import { PlaybackControls } from "./components/PlaybackControls";
import { ProgressBar } from "./components/ProgressBar";
import { SettingsCheckbox } from "./components/SettingsCheckbox";
import { UpdateBanner } from "./components/UpdateBanner";
import { AboutDialog } from "./components/AboutDialog";
import { RecentsSidebar } from "./components/RecentsSidebar";
import { useLibrary } from "./hooks/useLibrary";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useSettings } from "./hooks/useSettings";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { playClick } from "./lib/sound";
import { track, lengthBucket } from "./lib/analytics";
import { DEFAULT_TEXT } from "./constants";
import iconUrl from "./assets/icon.png";
import bmcButtonUrl from "./assets/bmc-button.svg";

function App() {
  const { settings, updateSetting } = useSettings();
  const { update, skipUpdate, open } = useUpdateCheck();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [version, setVersion] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setVersion);
  }, []);

  // Read settings.text verbatim. DEFAULT_TEXT is seeded into settings once on
  // first launch (see useSettings); after that, the empty string is a legit
  // value the user chose.
  const text = settings.text;
  const setText = useCallback((newText: string) => updateSetting("text", newText), [updateSetting]);

  const getVolume = useCallback(() => settings.volume, [settings.volume]);
  const player = useAudioPlayer(getVolume);
  const { setVolume } = player;

  // Update player volume when slider changes
  useEffect(() => {
    setVolume(settings.volume);
  }, [settings.volume, setVolume]);

  // ---- Library: sidebar recents (files + text sessions) + file→text ----
  const lib = useLibrary();

  // Open/close the sidebar; the main process grows the window by ~20% so the
  // existing content keeps its size.
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((isOpen) => {
      const next = !isOpen;
      window.electronAPI?.setSidebar(next);
      return next;
    });
  }, []);

  // Loading a file or a past session just drops its text into the editor.
  const loadIntoEditor = useCallback(
    (t: string | null) => {
      if (t != null) {
        setText(t);
        textareaRef.current?.focus();
      }
    },
    [setText]
  );

  const onOpenFileDialog = useCallback(async () => {
    loadIntoEditor(await lib.openViaDialog());
  }, [lib, loadIntoEditor]);

  const onPickFile = useCallback(
    async (rec: RecentFile) => {
      loadIntoEditor(await lib.openRecentFile(rec));
    },
    [lib, loadIntoEditor]
  );

  const onPickSession = useCallback(
    (rec: RecentSession) => {
      loadIntoEditor(lib.loadSession(rec));
    },
    [lib, loadIntoEditor]
  );

  const handlePlayPause = () => {
    // Fire only on the start transition (not pause/resume) with non-empty text.
    if (!player.isPlaying && text.trim()) {
      track("quick_speak_initiated", {
        text_length_bucket: lengthBucket(text.length),
        language: settings.language,
        voice_id: settings.voice,
        trigger_type: "button",
      });
      lib.addSession(text, settings.voice, settings.language);
    }
    player.play(text, settings.voice, settings.language);
  };

  // Keyboard-driven "speak now": Enter (or ⌘/Ctrl+Enter) speaks the text and
  // clears the box for the next line; Shift+Enter inserts a newline.
  const speak = useCallback(() => {
    if (!text.trim()) return;
    track("quick_speak_initiated", {
      text_length_bucket: lengthBucket(text.length),
      language: settings.language,
      voice_id: settings.voice,
      trigger_type: "keyboard",
    });
    lib.addSession(text, settings.voice, settings.language);
    playClick();
    player.play(text, settings.voice, settings.language, { forceRestart: true });
    setText("");
  }, [text, settings.voice, settings.language, player, setText, lib]);

  // Drag-and-drop a file anywhere on the content → load its text into the editor.
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) loadIntoEditor(await lib.openDroppedFile(file));
    },
    [lib, loadIntoEditor]
  );

  // Esc returns focus to the text box, or closes the About panel.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (aboutOpen) {
        setAboutOpen(false);
      } else {
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aboutOpen]);

  const handleQuit = () => {
    window.electronAPI?.quit();
  };

  const controlsDisabled = player.isPlaying && !player.isPaused;

  // The Electron main window is only frameless on macOS (titleBarStyle:
  // "hiddenInset"). On Windows/Linux the OS draws a real title bar, so making
  // the top strip a drag region would intercept clicks and "fight" the user.
  const isMacFrameless = window.electronAPI?.platform === "darwin";
  const topStripStyle = isMacFrameless
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;
  const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

  return (
    <div className="flex h-screen select-none flex-col overflow-hidden">
      {/* Full-width top: drag strip + header (the sidebar sits below this) */}
      <div className="px-5">
        <div className="h-8 w-full" style={topStripStyle} />
        <div className="mb-4 flex items-center justify-between">
          <h1 className="flex items-center gap-2.5 text-lg">
            <img src={iconUrl} alt="Out Loud" className="h-7 w-7" />
            Out Loud
          </h1>
          <a
            href="https://buymeacoffee.com/julia_hk"
            onClick={(e) => {
              e.preventDefault();
              window.open("https://buymeacoffee.com/julia_hk", "_blank");
            }}
            aria-label="Buy me a coffee"
            title="Buy me a coffee"
            className="inline-flex cursor-pointer items-center transition-opacity hover:opacity-90"
            style={noDrag}
          >
            <img src={bmcButtonUrl} alt="Buy me a coffee" className="h-8 w-auto" />
          </a>
        </div>
      </div>

      {/* Row: hidden-by-default sidebar | normal-mode content */}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <RecentsSidebar
            recents={lib.recents}
            onOpenFileDialog={onOpenFileDialog}
            onPickFile={onPickFile}
            onPickSession={onPickSession}
            onRemove={lib.removeRecent}
          />
        )}

        <div
          className="relative flex min-h-0 flex-1 flex-col px-5 pb-5"
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => {
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) setDragging(false);
          }}
          onDrop={onDrop}
        >
          {/* Subtle sidebar toggle: a slim handle in the left gutter (so it
              doesn't shift the content). ‹ collapses, › reveals. */}
          <button
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? "Hide recents" : "Show recents"}
            aria-pressed={sidebarOpen}
            title="Recent files & sessions"
            style={noDrag}
            className="absolute bottom-0 left-0 top-0 z-10 flex w-5 items-center justify-center text-gray-600 opacity-70 transition-all duration-200 hover:bg-gray-800/40 hover:text-gray-300 hover:opacity-100"
          >
            <span className="text-sm leading-none">{sidebarOpen ? "‹" : "›"}</span>
          </button>

          {/* "New version available" notice */}
          <UpdateBanner update={update} onOpen={open} onSkip={skipUpdate} />

          {/* Main content */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 items-stretch gap-3">
              <div className="flex min-h-0 flex-1 flex-col">
                <TextInput
                  value={text}
                  onChange={setText}
                  // The box stays editable while audio plays, so you can type the
                  // next line before the last one finishes.
                  highlightChunk={settings.highlightChunk}
                  currentChunkIndex={player.currentChunkIndex}
                  totalChunks={player.totalChunks}
                  isPlaying={player.isPlaying}
                  exampleText={DEFAULT_TEXT}
                  onSpeak={speak}
                  inputRef={textareaRef}
                />
                <VoiceSelect
                  language={settings.language}
                  voice={settings.voice}
                  onLanguageChange={(lang) => {
                    track("language_changed", { new_language: lang });
                    updateSetting("language", lang);
                  }}
                  onVoiceChange={(v) => {
                    track("voice_changed", { new_voice_id: v, language: settings.language });
                    updateSetting("voice", v);
                  }}
                  disabled={controlsDisabled}
                />
                <PlaybackControls
                  isPlaying={player.isPlaying}
                  isPaused={player.isPaused}
                  canDownload={player.canDownload}
                  isExporting={player.isExporting}
                  exportProgress={player.chunkProgress}
                  onPlayPause={handlePlayPause}
                  onDownload={player.download}
                  onCancelExport={player.cancelExport}
                />
              </div>

              {/* Volume slider */}
              <VolumeSlider value={settings.volume} onChange={(v) => updateSetting("volume", v)} />
            </div>

            {/* Error banner — TTS failures and file-open failures */}
            {(player.error || lib.error) && (
              <div
                role="alert"
                className="mt-3 flex max-h-32 items-start justify-between gap-3 overflow-auto rounded-md border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200"
              >
                <div className="min-w-0">
                  <div className="mb-1 font-semibold text-red-100">
                    {player.error ? "TTS error" : "Couldn't open file"}
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
                    {player.error || lib.error}
                  </pre>
                </div>
                {lib.error && !player.error && (
                  <button
                    onClick={lib.clearError}
                    className="shrink-0 text-red-300 hover:text-red-100"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}

            {/* Progress section */}
            <ProgressBar
              chunkProgress={player.chunkProgress}
              playProgress={player.playProgress}
              stats={player.stats}
            />

            {/* Screen-reader status */}
            <div className="sr-only" role="status" aria-live="polite">
              {player.error
                ? "Error generating speech"
                : !player.isPlaying
                  ? ""
                  : player.chunkProgress < 100
                    ? "Generating speech"
                    : "Speaking"}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-auto flex items-center justify-between pt-2">
            <div className="mt-3 flex flex-col gap-2">
              <SettingsCheckbox
                label="Highlight & auto-scroll current text"
                checked={settings.highlightChunk}
                onChange={(checked) => updateSetting("highlightChunk", checked)}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  track("about_dialog_opened");
                  setAboutOpen(true);
                }}
                aria-label="Help and about"
                title="Help & About"
                className="h-[38px] w-[38px] cursor-pointer rounded-md border border-gray-600/50 bg-gray-700/80 text-xs font-medium text-gray-300 transition-all duration-200 hover:border-gray-500/50 hover:bg-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-500/30 active:bg-gray-700"
              >
                ?
              </button>
              <button
                onClick={handleQuit}
                className="h-[38px] w-[50px] cursor-pointer rounded-md border border-gray-600/50 bg-gray-700/80 py-2.5 text-xs font-medium text-gray-300 transition-all duration-200 hover:border-gray-500/50 hover:bg-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-500/30 active:bg-gray-700"
              >
                Quit
              </button>
            </div>
          </div>

          {/* Drop overlay — full-bleed, no border/radius */}
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-indigo-950/60 text-sm font-medium text-indigo-100">
              Drop a TXT, EPUB, or PDF to load its text
            </div>
          )}
        </div>
      </div>

      <AboutDialog
        open={aboutOpen}
        version={version}
        onClose={() => setAboutOpen(false)}
        onOpen={open}
      />
    </div>
  );
}

export default App;
