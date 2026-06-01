import type { UpdateInfo } from "../hooks/useUpdateCheck";

// "A newer version is available" notice. The Download button opens the
// platform installer directly in the browser (Tier A — no in-place
// auto-install). The user can skip a version to silence it until a newer one
// ships.

interface UpdateBannerProps {
  update: UpdateInfo | null;
  onOpen: (url: string) => void;
  onSkip: (version: string) => void;
}

export function UpdateBanner({ update, onOpen, onSkip }: UpdateBannerProps) {
  if (!update?.available) return null;

  return (
    <div className="mb-3 mt-3 rounded-md border border-sky-500/40 bg-sky-950/40 p-3 text-xs text-sky-100">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Update available — v{update.latest}</div>
          <p className="mt-0.5 leading-snug opacity-90">
            A newer version of Out Loud is ready to download.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => onOpen(update.downloadUrl)}
              className="rounded border border-sky-400/50 bg-sky-500/20 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-sky-500/30 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            >
              Download
            </button>
            <button
              onClick={() => onSkip(update.latest)}
              className="rounded px-2 py-1 text-[11px] opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
            >
              Skip this version
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
