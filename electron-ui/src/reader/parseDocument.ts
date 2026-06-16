import type { NormalizedDoc } from "./types";
import { finalizeDoc, type ParsedDoc } from "./model";
import { detectFormat } from "./parsers/shared";
import { parseTxt } from "./parsers/txt";
import { parseEpub } from "./parsers/epub";
import { parsePdf } from "./parsers/pdf";
import { parseDocx } from "./parsers/docx";
import { parseDoc } from "./parsers/doc";
import { parseMobi } from "./parsers/mobi";

interface ParseInput {
  bytes: Uint8Array;
  name: string;
  sourcePath?: string;
}

// Dispatch by format. All parsing happens in the renderer (jszip + native
// DOMParser + pdfjs), so the contract is uniform regardless of where the bytes
// came from (open dialog via main, or drag-drop via the File API).
export async function parseDocument(input: ParseInput): Promise<NormalizedDoc> {
  const fmt = detectFormat(input.name, input.bytes);

  let parsed: ParsedDoc;
  if (fmt === "pdf") parsed = await parsePdf(input.bytes, input.name);
  else if (fmt === "epub") parsed = await parseEpub(input.bytes, input.name);
  else if (fmt === "docx") parsed = await parseDocx(input.bytes, input.name);
  else if (fmt === "doc") parsed = await parseDoc(input.bytes, input.name);
  else if (fmt === "mobi") parsed = await parseMobi(input.bytes, input.name);
  else parsed = parseTxt(input.bytes, input.name);

  parsed.sourcePath = input.sourcePath;
  const id = `${input.name}:${input.bytes.length}:${Date.now()}`;
  return finalizeDoc(parsed, id);
}
