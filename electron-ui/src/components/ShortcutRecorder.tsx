import { useEffect, useState } from "react";
import { KeyCombo } from "./KeyCombo";

// Lets the user rebind the global "read selection aloud" hotkey. Click to
// record, press a modifier + key combo, and it's saved as an Electron
// accelerator string (e.g. "Control+Alt+S").

interface ShortcutRecorderProps {
  value: string;
  onChange: (accelerator: string) => void;
}

// Build an Electron accelerator from a keydown. Requires at least one modifier
// plus a letter/digit/Space; returns null otherwise (keep listening).
function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  // "Super" is the cross-platform name for ⌘ (macOS) / Win (Windows/Linux).
  if (e.metaKey) mods.push("Super");
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");

  const key = e.key;
  if (key === "Meta" || key === "Control" || key === "Alt" || key === "Shift") return null;
  if (mods.length === 0) return null;

  let main = "";
  if (key === " ") main = "Space";
  else if (/^[a-zA-Z0-9]$/.test(key)) main = key.toUpperCase();
  else return null; // unsupported key — keep waiting for a valid combo

  return [...mods, main].join("+");
}

export function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    // Release the live global hotkey while recording so it can't fire or
    // swallow the keys being recorded; resume when we stop.
    window.electronAPI?.setShortcutRecording?.(true);
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const acc = toAccelerator(e);
      if (acc) {
        onChange(acc);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.electronAPI?.setShortcutRecording?.(false);
    };
  }, [recording, onChange]);

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span>Read-aloud shortcut</span>
      <button
        type="button"
        onClick={() => setRecording((r) => !r)}
        aria-label="Change read-aloud shortcut"
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
          recording ? "bg-sky-500/10 text-sky-200 ring-1 ring-sky-400/60" : "hover:bg-gray-800"
        }`}
      >
        {recording ? "Press keys… (Esc to cancel)" : <KeyCombo accelerator={value} />}
      </button>
    </div>
  );
}
