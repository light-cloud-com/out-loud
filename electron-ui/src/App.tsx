import { useCallback, useEffect, useRef, useState } from "react";
import { TextInput } from "./components/TextInput";
import { VoiceSelect } from "./components/VoiceSelect";
import { VolumeSlider } from "./components/VolumeSlider";
import { PlaybackControls } from "./components/PlaybackControls";
import { ProgressBar } from "./components/ProgressBar";
import { SettingsCheckbox } from "./components/SettingsCheckbox";
import { UpdateBanner } from "./components/UpdateBanner";
import { AboutDialog } from "./components/AboutDialog";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useSettings } from "./hooks/useSettings";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { playClick } from "./lib/sound";
import { DEFAULT_TEXT } from "./constants";

function App() {
  const { settings, updateSetting } = useSettings();
  const { update, skipUpdate, open } = useUpdateCheck();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [version, setVersion] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setVersion);
  }, []);
  // Read settings.text verbatim. DEFAULT_TEXT is seeded into settings once on
  // first launch (see useSettings); after that, the empty string is a legit
  // value the user chose. Falling back to DEFAULT_TEXT here would make the
  // textarea impossible to clear and look like the value "flickers" back.
  // The "Load example" button in TextInput re-injects DEFAULT_TEXT on demand
  // for users who cleared the field and want the demo back.
  const text = settings.text;
  const setText = (newText: string) => updateSetting("text", newText);

  const getVolume = useCallback(() => settings.volume, [settings.volume]);
  const player = useAudioPlayer(getVolume);
  const { setVolume } = player;

  // Update player volume when slider changes
  useEffect(() => {
    setVolume(settings.volume);
  }, [settings.volume, setVolume]);

  const handlePlayPause = () => {
    player.play(text, settings.voice, settings.language);
  };

  // Keyboard-driven "speak now" (Enter in talker mode, ⌘/Ctrl+Enter anywhere).
  // Always re-speaks the current text; in talker mode it clears the box and
  // gives an immediate audio click so it works with eyes closed.
  const speak = useCallback(() => {
    if (!text.trim()) return;
    if (settings.talkerMode) playClick();
    player.play(text, settings.voice, settings.language, { forceRestart: true });
    if (settings.talkerMode) setText("");
  }, [text, settings.talkerMode, settings.voice, settings.language, player]);

  // Esc returns focus to the single text box from anywhere (or closes the
  // About panel first). So the cursor is never "lost" off-screen.
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

  const handleFooterClick = (e: React.MouseEvent) => {
    e.preventDefault();
    window.open("https://labs.light-cloud.com", "_blank");
  };

  const controlsDisabled = player.isPlaying && !player.isPaused;

  // The Electron main window is only frameless on macOS (titleBarStyle:
  // "hiddenInset"). On Windows/Linux the OS draws a real title bar, so making
  // the top strip a drag region would intercept clicks and "fight" the user.
  const isMacFrameless = window.electronAPI?.platform === "darwin";
  const topStripStyle = isMacFrameless
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;

  return (
    <div className="flex h-screen select-none flex-col overflow-hidden p-5 pt-0">
      {/* Top strip: drag handle on macOS, plain spacer elsewhere */}
      <div className="h-8 w-full" style={topStripStyle} />

      {/* Header */}
      <h1 className="mb-4 flex items-center gap-2.5 text-lg">
        <img src="./icon.png" alt="Out Loud" className="h-7 w-7" />
        Out Loud
      </h1>

      {/* "New version available" notice (GitHub latest release vs running version) */}
      <UpdateBanner update={update} onOpen={open} onSkip={skipUpdate} />

      {/* Main content */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-stretch gap-3">
          {/* Left column */}
          <div className="flex min-h-0 flex-1 flex-col">
            <TextInput
              value={text}
              onChange={setText}
              // In talker mode the box stays editable while audio plays, so you
              // can type the next line before the last one finishes.
              disabled={controlsDisabled && !settings.talkerMode}
              highlightChunk={settings.highlightChunk}
              currentChunkIndex={player.currentChunkIndex}
              totalChunks={player.totalChunks}
              isPlaying={player.isPlaying}
              exampleText={DEFAULT_TEXT}
              talkerMode={settings.talkerMode}
              onSpeak={speak}
              inputRef={textareaRef}
            />
            <VoiceSelect
              language={settings.language}
              voice={settings.voice}
              onLanguageChange={(lang) => updateSetting("language", lang)}
              onVoiceChange={(v) => updateSetting("voice", v)}
              disabled={controlsDisabled}
            />
            <PlaybackControls
              isPlaying={player.isPlaying}
              isPaused={player.isPaused}
              canDownload={player.canDownload}
              onPlayPause={handlePlayPause}
              onDownload={player.download}
            />
          </div>

          {/* Volume slider */}
          <VolumeSlider value={settings.volume} onChange={(v) => updateSetting("volume", v)} />
        </div>

        {/* Error banner — visible when TTS fails so users can report it */}
        {player.error && (
          <div
            role="alert"
            className="mt-3 max-h-32 overflow-auto rounded-md border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200"
          >
            <div className="mb-1 font-semibold text-red-100">TTS error</div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
              {player.error}
            </pre>
          </div>
        )}

        {/* Progress section */}
        <ProgressBar
          chunkProgress={player.chunkProgress}
          playProgress={player.playProgress}
          stats={player.stats}
        />

        {/* Settings */}
        <div className="mt-3 flex flex-col gap-2">
          <SettingsCheckbox
            label="Highlight current chunk"
            checked={settings.highlightChunk}
            onChange={(checked) => updateSetting("highlightChunk", checked)}
          />
          <SettingsCheckbox
            label="Talker mode (Enter speaks, then clears)"
            checked={settings.talkerMode}
            onChange={(checked) => updateSetting("talkerMode", checked)}
          />
        </div>

        {/* Info display (hidden by default) */}
        <div className="mt-2 hidden text-xs text-gray-500">{player.info}</div>

        {/* Screen-reader status: announces generation/playback transitions */}
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
        <span
          onClick={handleFooterClick}
          className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-gray-600 no-underline hover:text-gray-400"
        >
          <img src="./lightcloud-logo.png" alt="Light Cloud Labs" className="h-5 w-auto" />
          Light Cloud Labs
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAboutOpen(true)}
            aria-label="Help and about"
            title="Help & About"
            className="h-[34px] w-[34px] cursor-pointer rounded-md border border-gray-600/50 bg-gray-700/80 text-xs font-medium text-gray-300 transition-all duration-200 hover:border-gray-500/50 hover:bg-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-500/30 active:bg-gray-700"
          >
            ?
          </button>
          <button
            onClick={handleQuit}
            className="w-[50px] cursor-pointer rounded-md border border-gray-600/50 bg-gray-700/80 py-2.5 text-xs font-medium text-gray-300 transition-all duration-200 hover:border-gray-500/50 hover:bg-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-500/30 active:bg-gray-700"
          >
            Quit
          </button>
        </div>
      </div>

      <AboutDialog
        open={aboutOpen}
        version={version}
        talkerMode={settings.talkerMode}
        onClose={() => setAboutOpen(false)}
        onOpen={open}
      />
    </div>
  );
}

export default App;
