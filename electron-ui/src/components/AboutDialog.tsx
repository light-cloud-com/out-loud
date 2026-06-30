import type { ReactNode } from "react";
import iconUrl from "../assets/icon.png";
import { KeyCombo } from "./KeyCombo";
import { IS_MAC } from "../lib/platform";

interface AboutDialogProps {
  open: boolean;
  version: string;
  shortcut: string;
  onClose: () => void;
  onOpen: (url: string) => void;
}

const REPO_URL = "https://github.com/light-cloud-com/out-loud";

// "Control+Alt+S" → "Control (⌃) + Option (⌥) + S" (mac) so users know the keys
function formatShortcutVerbose(accelerator: string): string {
  const names: Record<string, string> = IS_MAC
    ? {
        Command: "Command (⌘)",
        Super: "Command (⌘)",
        Meta: "Command (⌘)",
        Control: "Control (⌃)",
        Alt: "Option (⌥)",
        Shift: "Shift (⇧)",
      }
    : {
        Command: "Win (⊞)",
        Super: "Win (⊞)",
        Meta: "Win (⊞)",
        Control: "Ctrl",
        Alt: "Alt",
        Shift: "Shift",
      };
  const parts = (accelerator || "").split("+").map((p) => names[p] ?? p);
  return parts.join(" + ");
}

function Row({ keys, desc }: { keys: ReactNode; desc: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <kbd className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-200">
        {keys}
      </kbd>
      <span className="flex-1 text-right text-gray-400">{desc}</span>
    </div>
  );
}

export function AboutDialog({ open, version, shortcut, onClose, onOpen }: AboutDialogProps) {
  if (!open) return null;

  const isMac = IS_MAC;
  // Reflect the user's actual configured shortcut, spelled out so users know
  // exactly which keys to press.
  const readAloudKeysVerbose = formatShortcutVerbose(shortcut);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="About Out Loud"
        className="max-h-full w-full max-w-md overflow-auto rounded-lg border border-gray-700 bg-gray-900 p-5 text-xs text-gray-300 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-100">
            <img src={iconUrl} alt="" className="h-5 w-5" />
            Out Loud
            <span className="font-normal text-gray-500">v{version || "—"}</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-base leading-none text-gray-400 hover:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500/40"
          >
            ×
          </button>
        </div>

        <section className="mb-4">
          <h3 className="mb-1 font-semibold text-gray-200">Keyboard shortcuts</h3>
          <Row keys="Enter" desc="Speak the text, then clear it" />
          <Row keys="Shift + Enter" desc="New line (don't speak)" />
          <Row keys="Esc" desc="Jump back to the text box" />
          <Row
            keys={<KeyCombo accelerator={shortcut} />}
            desc="Read selected text aloud — in any app"
          />
        </section>

        <section className="mb-4">
          <h3 className="mb-1 font-semibold text-gray-200">Read aloud from anywhere</h3>
          <p className="text-gray-400">
            Select text in any app — Slack, your browser, Mail, a PDF — and press{" "}
            <span className="font-medium text-gray-200">{readAloudKeysVerbose}</span> to hear it
            (press the keys together). Change it any time below. Out Loud just needs to be running
            (it can stay in the {isMac ? "menu bar" : "tray"}).
          </p>
          {isMac && (
            <p className="mt-1 text-gray-500">
              First time: grant Out Loud <span className="text-gray-300">Accessibility</span>{" "}
              permission in System Settings → Privacy &amp; Security → Accessibility, so it can read
              your selection. Until then, copy the text first, then press the shortcut.
            </p>
          )}
        </section>

        <section className="mb-4">
          <h3 className="mb-1 font-semibold text-gray-200">Type &amp; speak</h3>
          <p className="text-gray-400">
            Press <span className="text-gray-300">Enter</span> to speak the text and clear the box,
            and keep typing the next line while the last is still playing — the text box never locks
            and the cursor never leaves it. Use <span className="text-gray-300">Shift+Enter</span>{" "}
            for a new line, or the <span className="text-gray-300">Play</span> button to speak
            without clearing.
          </p>
        </section>

        <section className="mb-4">
          <h3 className="mb-1 font-semibold text-gray-200">Pauses</h3>
          <p className="mb-1 text-gray-400">
            Insert a silence anywhere with a tag — all of these are equivalent:
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {["[1s]", "[500ms]", "<pause=1s>", '<break time="1s"/>'].map((t) => (
              <code
                key={t}
                className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-indigo-200"
              >
                {t}
              </code>
            ))}
          </div>
          <p className="text-gray-400">
            Punctuation also pauses automatically: period/semicolon ≈ 0.4s, colon ≈ 0.3s, comma ≈
            0.2s, a new line ≈ 0.4s.
          </p>
        </section>

        <section className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-800 pt-3 text-gray-400">
          <button className="hover:text-gray-200" onClick={() => onOpen("https://www.out-loud.io")}>
            Website
          </button>
          <button className="hover:text-gray-200" onClick={() => onOpen(REPO_URL)}>
            GitHub
          </button>
          <button className="hover:text-gray-200" onClick={() => onOpen(`${REPO_URL}/issues`)}>
            Report an issue
          </button>
        </section>
      </div>
    </div>
  );
}
