import { recentKey } from "../hooks/useLibrary";

interface RecentsSidebarProps {
  recents: RecentEntry[];
  onOpenFileDialog: () => void;
  onPickFile: (rec: RecentFile) => void;
  onPickSession: (rec: RecentSession) => void;
  onRemove: (key: string) => void;
}

// Hidden-by-default left panel: the unified "recents" — files the user opened
// and text sessions they listened to. Picking either loads its text into the
// editor. Full height; the window grows ~20% when this is shown. Toggled via
// the ☰ button in the app header (so no header/close button needed here).
export function RecentsSidebar({
  recents,
  onOpenFileDialog,
  onPickFile,
  onPickSession,
  onRemove,
}: RecentsSidebarProps) {
  return (
    <aside className="flex h-full w-1/5 min-w-[140px] shrink-0 flex-col border-r border-gray-700/40 bg-gray-900/40">
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {recents.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-relaxed text-gray-500">
            Nothing yet. Open or drop a file, or play some text — it'll show up here.
          </p>
        ) : (
          recents.map((r) =>
            r.kind === "file" ? (
              <RecentRow
                key={recentKey(r)}
                label={r.title || r.name}
                badge={<FormatBadge format={r.format} />}
                onClick={() => onPickFile(r)}
                onRemove={() => onRemove(recentKey(r))}
              />
            ) : (
              <RecentRow
                key={recentKey(r)}
                label={r.preview || "Text"}
                badge={<TextBadge />}
                onClick={() => onPickSession(r)}
                onRemove={() => onRemove(recentKey(r))}
              />
            )
          )
        )}
      </div>

      {/* Open lives at the bottom; the list is the focus. */}
      <div className="border-t border-gray-700/40 p-2">
        <button
          onClick={onOpenFileDialog}
          title="Open a file (TXT, EPUB, PDF)"
          className="w-full rounded-md border border-gray-600/50 bg-gray-700/70 px-2 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-600"
        >
          + Open file
        </button>
      </div>
    </aside>
  );
}

function RecentRow({
  label,
  badge,
  onClick,
  onRemove,
}: {
  label: string;
  badge: React.ReactNode;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative mb-1">
      <button
        onClick={onClick}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-700/40 bg-gray-800/40 py-2 pl-2.5 pr-9 text-left text-sm text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800/70"
      >
        <span className="truncate">{label}</span>
        {badge}
      </button>
      <button
        onClick={onRemove}
        title="Remove from list"
        aria-label="Remove"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-700 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function FormatBadge({ format }: { format: string }) {
  const f = (format || "doc").toLowerCase();
  const styles: Record<string, string> = {
    pdf: "bg-rose-500/20 text-rose-300 border-rose-500/30",
    epub: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    txt: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    docx: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    doc: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    mobi: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  };
  const cls = styles[f] ?? "bg-gray-600/30 text-gray-300 border-gray-500/40";
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {f}
    </span>
  );
}

function TextBadge() {
  return (
    <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
      text
    </span>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
