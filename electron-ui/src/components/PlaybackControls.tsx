interface PlaybackControlsProps {
  isPlaying: boolean;
  isPaused: boolean;
  canDownload: boolean;
  onPlayPause: () => void;
  onDownload: () => void;
}

export function PlaybackControls({
  isPlaying,
  isPaused,
  canDownload,
  onPlayPause,
  onDownload,
}: PlaybackControlsProps) {
  const buttonText = isPlaying && !isPaused ? "Pause" : "Play";

  return (
    <div className="mt-2.5 flex gap-2.5">
      <button
        onClick={onPlayPause}
        className="flex-1 cursor-pointer rounded-md border-none bg-indigo-500 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition-all duration-200 hover:bg-indigo-400 hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:ring-offset-2 focus:ring-offset-gray-900 active:bg-indigo-600 active:shadow-none"
      >
        {buttonText}
      </button>
      <button
        onClick={onDownload}
        disabled={!canDownload}
        className="cursor-pointer rounded-md border-none bg-gray-700 px-4 py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500/50 focus:ring-offset-2 focus:ring-offset-gray-900 active:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-700"
        title={canDownload ? "Download audio" : "Generate audio first"}
      >
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
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    </div>
  );
}
