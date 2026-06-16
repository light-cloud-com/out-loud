import type { ParsedDoc } from "../model";
import { stripExt } from "./shared";
import { blocksFromPlainText } from "./txt";

// Legacy binary Word .doc (OLE2/CFB). There's no usable browser parser, so the
// actual extraction happens in the MAIN process (word-extractor, Node-only) via
// the reader:extractDoc IPC bridge. Here we just take the returned plain text
// and reuse the txt synthesis (paragraphs from blank lines, heading detection).
export async function parseDoc(bytes: Uint8Array, name: string): Promise<ParsedDoc> {
  const res = await window.electronAPI?.reader.extractDoc(bytes);
  if (!res) throw new Error("Reading .doc files isn't available in this build.");
  if ("error" in res) throw new Error(res.error);

  const text = (res.text || "").trim();
  if (!text) throw new Error("Couldn't extract any text from this Word document.");

  return blocksFromPlainText(text, stripExt(name), "doc");
}
