import { useCallback, useEffect, useState } from "react";
import type { NormalizedDoc } from "../reader/types";
import { parseDocument } from "../reader/parseDocument";
import { detectFormat, stripExt } from "../reader/parsers/shared";
import { track, countBucket } from "../lib/analytics";

// Stable identity for a recent entry (mirrors keyOf in electron/reader-recents.ts).
export function recentKey(e: RecentEntry): string {
  return e.kind === "text" ? `text:${e.id}` : `file:${e.path}`;
}

// Flatten a parsed document back to plain text for the editor: sentences joined
// within a block, blocks separated by blank lines. (No reader pane — a file's
// content simply becomes editable/speakable text like a paste.)
function docToText(doc: NormalizedDoc): string {
  return doc.blocks
    .map((b) => b.sentences.map((s) => s.text).join(" "))
    .filter((t) => t.trim().length > 0)
    .join("\n\n");
}

function hasError(res: unknown): res is { error: string } {
  return !!res && typeof res === "object" && "error" in res;
}

type OpenSource = "dialog" | "drop" | "recents";

/**
 * The unified "library": the sidebar's recents (opened files + listened text
 * sessions) plus the actions that load any of them into the editor as text.
 */
export function useLibrary() {
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = (await window.electronAPI?.reader.getRecents()) ?? [];
    setRecents(r);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Parse bytes → text, record the file in recents (when it has a path), and
  // emit the right open-telemetry. Returns the extracted text (or null on fail).
  const loadBytes = useCallback(
    async (
      bytes: Uint8Array,
      name: string,
      sourcePath: string | undefined,
      source: OpenSource
    ): Promise<string | null> => {
      setLoading(true);
      setError(null);
      try {
        const doc = await parseDocument({ bytes, name, sourcePath });
        const text = docToText(doc);
        if (sourcePath) {
          await window.electronAPI?.reader.putRecent({
            kind: "file",
            path: sourcePath,
            name,
            title: doc.title || stripExt(name),
            format: doc.format,
            addedAt: Date.now(),
          });
          await refresh();
        }
        if (source === "recents") {
          track("book_from_recents_opened", {
            format: doc.format,
            resume_position_available: false,
          });
        } else {
          track("book_opened", {
            format: doc.format,
            page_count_bucket: countBucket(doc.pages.length),
            open_source: source,
          });
        }
        setLoading(false);
        return text;
      } catch (e) {
        track("document_parse_error", {
          error_type: e instanceof Error ? e.name : "parse_failed",
          format: detectFormat(name, bytes),
        });
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        return null;
      }
    },
    [refresh]
  );

  // Open via the native dialog (first selection is parsed to text).
  const openViaDialog = useCallback(async (): Promise<string | null> => {
    const files = await window.electronAPI?.reader.openFiles();
    if (!files || files.length === 0) return null;
    const first = files[0];
    const res = await window.electronAPI?.reader.readFile(first.path);
    if (!res) return null;
    if (hasError(res)) {
      setError(res.error);
      return null;
    }
    return loadBytes(new Uint8Array(res.bytes), res.name, res.path, "dialog");
  }, [loadBytes]);

  // Drag-and-drop: the File API gives bytes + name but no on-disk path, so a
  // dropped file isn't added to recents (it can't be reopened by path) — its
  // text is recorded as a session once the user plays it.
  const openDroppedFile = useCallback(
    async (file: File): Promise<string | null> => {
      const buf = await file.arrayBuffer();
      return loadBytes(new Uint8Array(buf), file.name, undefined, "drop");
    },
    [loadBytes]
  );

  // Reopen a recent file → re-extract its text.
  const openRecentFile = useCallback(
    async (rec: RecentFile): Promise<string | null> => {
      const res = await window.electronAPI?.reader.readFile(rec.path);
      if (!res) return null;
      if (hasError(res)) {
        setError(`Couldn't open "${rec.title}": ${res.error}`);
        await refresh();
        return null;
      }
      return loadBytes(new Uint8Array(res.bytes), res.name, res.path, "recents");
    },
    [loadBytes, refresh]
  );

  // Load a past text session back into the editor (and bump it to the top).
  const loadSession = useCallback(
    (rec: RecentSession): string => {
      window.electronAPI?.reader.putRecent({ ...rec, addedAt: Date.now() }).then(refresh);
      return rec.text;
    },
    [refresh]
  );

  // Record a text the user listened to as a session (stored locally only).
  // Sessions are for pasted/typed snippets; we skip very large texts (e.g. a
  // whole book dropped in) so reader-recents.json stays small — large files are
  // reopenable as file recents instead.
  const addSession = useCallback(
    async (text: string, voice?: string, language?: string) => {
      const t = text.trim();
      if (!t || t.length > 20000) return;
      await window.electronAPI?.reader.putRecent({
        kind: "text",
        id: crypto.randomUUID(),
        text: t,
        preview: t.replace(/\s+/g, " ").slice(0, 80),
        voice,
        language,
        addedAt: Date.now(),
      });
      await refresh();
    },
    [refresh]
  );

  const removeRecent = useCallback(async (key: string) => {
    const r = (await window.electronAPI?.reader.removeRecent(key)) ?? [];
    setRecents(r);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    recents,
    loading,
    error,
    openViaDialog,
    openDroppedFile,
    openRecentFile,
    loadSession,
    addSession,
    removeRecent,
    clearError,
  };
}
