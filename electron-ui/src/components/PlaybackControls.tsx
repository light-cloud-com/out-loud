import { useState } from "react";
import type { AudioFormat } from "../hooks/useAudioPlayer";

interface PlaybackControlsProps {
  isPlaying: boolean;
  isPaused: boolean;
  canDownload: boolean;
  /** Export in progress: the worker is generating the full file. */
  isExporting?: boolean;
  /** Export generation progress (0–100), shown on the button while exporting. */
  exportProgress?: number;
  onPlayPause: () => void;
  onDownload: (format: AudioFormat) => void;
  /** Cancel an in-progress export (keeps playback running). */
  onCancelExport?: () => void;
  /** Optional trailing control (e.g. reader speed) rendered after Download. */
  rightSlot?: React.ReactNode;
}

const FORMATS: { id: AudioFormat; label: string }[] = [
  { id: "mp3", label: "MP3" },
  { id: "wav", label: "WAV" },
];

export function PlaybackControls({
  isPlaying,
  isPaused,
  canDownload,
  isExporting = false,
  exportProgress = 0,
  onPlayPause,
  onDownload,
  onCancelExport,
  rightSlot,
}: PlaybackControlsProps) {
  const buttonText = isPlaying && !isPaused ? "Pause" : "Play";
  const pct = Math.max(0, Math.min(100, Math.round(exportProgress)));
  const [menuOpen, setMenuOpen] = useState(false);

  const pick = (format: AudioFormat) => {
    setMenuOpen(false);
    onDownload(format);
  };

  return (
    <div className="mt-2.5 flex gap-2.5">
      <button
        onClick={onPlayPause}
        className="flex-1 cursor-pointer rounded-md border-none bg-indigo-500 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition-all duration-200 hover:bg-indigo-400 hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-2 focus:ring-offset-gray-900 active:bg-indigo-600 active:shadow-none"
      >
        {buttonText}
      </button>
      <div className="relative">
        <button
          onClick={isExporting ? onCancelExport : () => setMenuOpen((o) => !o)}
          disabled={!isExporting && !canDownload}
          aria-haspopup={isExporting ? undefined : "menu"}
          aria-expanded={isExporting ? undefined : menuOpen}
          className="relative flex min-w-[52px] cursor-pointer items-center justify-center gap-1 overflow-hidden rounded-md border-none bg-gray-700 px-4 py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500/50 focus:ring-offset-2 focus:ring-offset-gray-900 active:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-700"
          title={
            isExporting
              ? `Generating full audio… ${pct}% — click to cancel`
              : canDownload
                ? "Download as audio file (choose a format)"
                : "Generate audio first"
          }
          aria-label={isExporting ? `Cancel export, ${pct}% generated` : "Download audio"}
        >
          {isExporting ? (
            <span className="text-xs font-semibold tabular-nums">{pct}%</span>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="opacity-70"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </>
          )}
          {isExporting && (
            <span
              className="absolute bottom-0 left-0 h-[3px] bg-indigo-400 transition-[width] duration-200"
              style={{ width: `${pct}%` }}
              aria-hidden="true"
            />
          )}
        </button>

        {menuOpen && !isExporting && (
          <>
            {/* Click-away backdrop. */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              className="absolute bottom-full right-0 z-20 mb-1.5 w-28 overflow-hidden rounded-md border border-gray-600/60 bg-gray-800 shadow-xl"
            >
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  role="menuitem"
                  onClick={() => pick(f.id)}
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-gray-200 transition-colors hover:bg-indigo-600/80 hover:text-white"
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {rightSlot}
    </div>
  );
}
