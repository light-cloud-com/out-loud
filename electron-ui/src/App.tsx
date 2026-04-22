import { useCallback, useEffect } from "react";
import { TextInput } from "./components/TextInput";
import { VoiceSelect } from "./components/VoiceSelect";
import { VolumeSlider } from "./components/VolumeSlider";
import { PlaybackControls } from "./components/PlaybackControls";
import { ProgressBar } from "./components/ProgressBar";
import { SettingsCheckbox } from "./components/SettingsCheckbox";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useSettings } from "./hooks/useSettings";
import { DEFAULT_TEXT } from "./constants";

function App() {
  const { settings, updateSetting } = useSettings();
  const text = settings.text || DEFAULT_TEXT;
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

  const handleQuit = () => {
    window.electronAPI?.quit();
  };

  const handleFooterClick = (e: React.MouseEvent) => {
    e.preventDefault();
    window.open("https://labs.light-cloud.com", "_blank");
  };

  const controlsDisabled = player.isPlaying && !player.isPaused;

  return (
    <div className="flex h-screen select-none flex-col overflow-hidden p-5 pt-0">
      {/* Drag region for frameless window */}
      <div className="h-8 w-full" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />

      {/* Header */}
      <h1 className="mb-4 flex items-center gap-2.5 text-lg">
        <img src="./icon.png" alt="Out Loud" className="h-7 w-7" />
        Out Loud
      </h1>

      {/* Main content */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-stretch gap-3">
          {/* Left column */}
          <div className="flex min-h-0 flex-1 flex-col">
            <TextInput
              value={text}
              onChange={setText}
              disabled={controlsDisabled}
              highlightChunk={settings.highlightChunk}
              currentChunkIndex={player.currentChunkIndex}
              totalChunks={player.totalChunks}
              isPlaying={player.isPlaying}
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

        {/* Progress section */}
        <ProgressBar
          chunkProgress={player.chunkProgress}
          playProgress={player.playProgress}
          stats={player.stats}
        />

        {/* Settings */}
        <div className="mt-3">
          <SettingsCheckbox
            label="Highlight current chunk"
            checked={settings.highlightChunk}
            onChange={(checked) => updateSetting("highlightChunk", checked)}
          />
        </div>

        {/* Info display (hidden by default) */}
        <div className="mt-2 hidden text-xs text-gray-500">{player.info}</div>
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
        <button
          onClick={handleQuit}
          className="w-[50px] cursor-pointer rounded-md border border-gray-600/50 bg-gray-700/80 py-2.5 text-xs font-medium text-gray-300 transition-all duration-200 hover:border-gray-500/50 hover:bg-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-gray-500/30 active:bg-gray-700"
        >
          Quit
        </button>
      </div>
    </div>
  );
}

export default App;
