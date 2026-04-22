interface ProgressBarProps {
  chunkProgress: number;
  playProgress: number;
  stats: string;
}

export function ProgressBar({ chunkProgress, playProgress, stats }: ProgressBarProps) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-center text-[11px] font-medium tabular-nums tracking-wide text-gray-400">
        {stats}
      </div>
      <div className="relative mb-2.5 h-2 overflow-hidden rounded-full bg-gray-800/80 shadow-inner">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-amber-500/40 transition-all duration-150 ease-out"
          style={{ width: `${chunkProgress}%` }}
        />
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-sm shadow-emerald-500/30 transition-all duration-150 ease-out"
          style={{ width: `${playProgress}%` }}
        />
      </div>
    </div>
  );
}
