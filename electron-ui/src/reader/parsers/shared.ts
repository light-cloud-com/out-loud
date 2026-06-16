import type { DocFormat } from "../types";

export function stripExt(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || name
  );
}

export function decodeText(bytes: Uint8Array): string {
  let b = bytes;
  // Strip UTF-8 BOM if present.
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    b = b.subarray(3);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(b);
}

// Scan up to `limit` bytes for an ASCII needle. Used to peek at zip-internal
// filenames (which sit uncompressed in local file headers) without unzipping.
function bytesContain(bytes: Uint8Array, needle: string, limit = 8192): boolean {
  const end = Math.min(bytes.length - needle.length, limit);
  for (let i = 0; i <= end; i++) {
    let j = 0;
    for (; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) break;
    }
    if (j === needle.length) return true;
  }
  return false;
}

export function detectFormat(name: string, bytes: Uint8Array): DocFormat {
  const ext = name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (ext === "pdf") return "pdf";
  if (ext === "epub") return "epub";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc"; // legacy binary Word — gate on extension only
  if (ext === "mobi" || ext === "azw" || ext === "azw3" || ext === "prc") return "mobi";
  if (ext === "txt" || ext === "text" || ext === "md" || ext === "markdown") return "txt";

  // Fallback to magic bytes (for files with a missing/wrong extension).
  if (bytes.length >= 4) {
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return "pdf"; // %PDF
    }
    // MOBI/AZW carry "BOOKMOBI" at offset 60 in the PalmDB header.
    if (bytes.length >= 68 && bytesContain(bytes.subarray(60, 68), "BOOKMOBI", 8)) {
      return "mobi";
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      // PK (zip). Distinguish the zip-based formats by peeking at internal
      // filenames rather than blindly assuming EPUB.
      if (bytesContain(bytes, "application/epub+zip", 128)) return "epub";
      if (bytesContain(bytes, "word/document.xml")) return "docx";
      return "epub"; // unknown zip — EPUB is the safest default (its parser errors clearly)
    }
  }
  return "txt";
}

// Resolve an EPUB href against a base directory, handling ./ and ../ and URL
// encoding. Returns a zip-internal posix path.
export function resolveHref(baseDir: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split("#")[0].trim());
  const stack = baseDir.split("/").filter(Boolean);
  for (const part of cleanHref.split("/")) {
    if (part === "..") stack.pop();
    else if (part === "." || part === "") continue;
    else stack.push(part);
  }
  return stack.join("/");
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}
