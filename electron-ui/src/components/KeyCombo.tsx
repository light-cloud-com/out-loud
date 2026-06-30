import { IS_MAC, IS_WINDOWS } from "../lib/platform";

// Renders an Electron accelerator ("Control+Alt+S") as a row of keycap icons,
// using platform-native glyphs: ⌘⌥⌃⇧ on macOS, the Windows logo + Ctrl/Alt/Shift
// on Windows, and a Super badge + Ctrl/Alt/Shift on Linux.

function WindowsLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-[11px] w-[11px]" fill="currentColor" aria-hidden="true">
      <path d="M3 5.75 10.4 4.7v6.55H3zM11.45 4.55 21 3.2v8.05h-9.55zM3 12.75h7.4v6.55L3 18.3zM11.45 12.75H21v8.05l-9.55-1.35z" />
    </svg>
  );
}

function Cap({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <kbd
      aria-label={label}
      title={label}
      className="inline-flex h-[21px] min-w-[21px] items-center justify-center rounded-[6px] border border-gray-600/70 border-b-gray-900/80 bg-gradient-to-b from-gray-700/80 to-gray-800 px-[7px] text-[11px] font-semibold leading-none text-gray-100 shadow-[0_1px_1.5px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]"
    >
      {children}
    </kbd>
  );
}

function renderToken(token: string, key: number) {
  switch (token) {
    case "Command":
    case "Super":
    case "Meta":
      if (IS_MAC)
        return (
          <Cap key={key} label="Command">
            ⌘
          </Cap>
        );
      if (IS_WINDOWS)
        return (
          <Cap key={key} label="Windows key">
            <WindowsLogo />
          </Cap>
        );
      return (
        <Cap key={key} label="Super">
          Super
        </Cap>
      );
    case "Control":
      return (
        <Cap key={key} label="Control">
          {IS_MAC ? "⌃" : "Ctrl"}
        </Cap>
      );
    case "Alt":
      return (
        <Cap key={key} label={IS_MAC ? "Option" : "Alt"}>
          {IS_MAC ? "⌥" : "Alt"}
        </Cap>
      );
    case "Shift":
      return (
        <Cap key={key} label="Shift">
          {IS_MAC ? "⇧" : "Shift"}
        </Cap>
      );
    default:
      return (
        <Cap key={key} label={token}>
          {token}
        </Cap>
      );
  }
}

export function KeyCombo({ accelerator }: { accelerator: string }) {
  const tokens = (accelerator || "").split("+").filter(Boolean);
  if (tokens.length === 0) return <span className="text-gray-500">—</span>;
  return (
    <span className="inline-flex items-center gap-[5px] align-middle">
      {tokens.map(renderToken)}
    </span>
  );
}
