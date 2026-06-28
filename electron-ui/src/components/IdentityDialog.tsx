import { useEffect, useRef, useState } from "react";

interface IdentityDialogProps {
  open: boolean;
  onClose: () => void;
}

// A tiny opt-in form for an optional name + email. Both are blank by default;
// nothing is sent unless the user types something in and saves. Used to let
// people who want to stay in touch attach an identity to their install.
export function IdentityDialog({ open, onClose }: IdentityDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const nameRef = useRef<HTMLInputElement>(null);

  // Load whatever is already stored each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    window.electronAPI?.getIdentity().then((id) => {
      setName(id?.name ?? "");
      setEmail(id?.email ?? "");
    });
    // Focus the first field shortly after mount.
    const t = setTimeout(() => nameRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setStatus("saving");
    const saved = await window.electronAPI?.setIdentity({ name, email });
    // Reflect what was actually stored (e.g. an invalid email gets dropped).
    setName(saved?.name ?? "");
    setEmail(saved?.email ?? "");
    setStatus("saved");
    setTimeout(onClose, 600);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Stay in touch"
        className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 p-5 text-xs text-gray-300 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100">Stay in touch</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-base leading-none text-gray-400 hover:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500/40"
          >
            ×
          </button>
        </div>

        <p className="mb-4 text-gray-400">
          Optional — leave your email to hear about new voices, languages, and updates. We never see
          the text you read or type, and you can clear this anytime.
        </p>

        <label className="mb-1 block text-gray-300" htmlFor="identity-name">
          Name
        </label>
        <input
          id="identity-name"
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          className="mb-3 w-full rounded-md border border-gray-600/60 bg-gray-800/70 px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500/30"
        />

        <label className="mb-1 block text-gray-300" htmlFor="identity-email">
          Email
        </label>
        <input
          id="identity-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="you@example.com"
          autoComplete="email"
          className="mb-4 w-full rounded-md border border-gray-600/60 bg-gray-800/70 px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500/30"
        />

        <div className="flex items-center justify-end gap-2">
          <span
            className={`mr-auto text-emerald-400 transition-opacity ${
              status === "saved" ? "opacity-100" : "opacity-0"
            }`}
          >
            Saved ✓
          </span>
          <button
            onClick={onClose}
            className="rounded-md border border-gray-600/50 bg-gray-700/70 px-3 py-1.5 text-gray-200 transition-colors hover:bg-gray-600"
          >
            Close
          </button>
          <button
            onClick={save}
            disabled={status === "saving"}
            className="rounded-md border border-indigo-500/50 bg-indigo-600/80 px-3 py-1.5 font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-60"
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
