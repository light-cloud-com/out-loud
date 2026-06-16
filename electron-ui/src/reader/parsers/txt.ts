import type { ParsedDoc, RawBlock } from "../model";
import type { DocFormat } from "../types";
import { decodeText, stripExt } from "./shared";

// Plain text has no structure, so we synthesize it: paragraphs from blank-line
// gaps, and chapters from heading-like lines ("Chapter N", roman numerals, or
// short ALL-CAPS lines).
function looksLikeHeading(paragraph: string): boolean {
  if (paragraph.length > 80) return false;
  const line = paragraph.split("\n")[0].trim();
  if (!line) return false;
  if (/^(chapter|part|book|prologue|epilogue|section|act|scene)\b/i.test(line)) return true;
  if (/^[IVXLCDM]+\.?$/i.test(line)) return true;
  if (/^\d+\.?$/.test(line)) return true;
  // Short, all-caps, not a sentence.
  if (
    line === line.toUpperCase() &&
    /[A-Z]/.test(line) &&
    line.length <= 60 &&
    !/[.?!]$/.test(line)
  ) {
    return true;
  }
  return false;
}

export function parseTxt(bytes: Uint8Array, name: string): ParsedDoc {
  return blocksFromPlainText(decodeText(bytes), stripExt(name), "txt");
}

// Shared plain-text → ParsedDoc synthesis. Also used by the .doc parser, which
// gets a plain string back from word-extractor (in the main process).
export function blocksFromPlainText(rawText: string, title: string, format: DocFormat): ParsedDoc {
  const text = rawText.replace(/\r\n?/g, "\n");

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const rawBlocks: RawBlock[] = [];
  const chapters: { title: string; blockStart: number; blockEnd: number }[] = [];
  let chapterIndex = -1;

  const openChapter = (chapterTitle: string) => {
    if (chapterIndex >= 0) chapters[chapterIndex].blockEnd = rawBlocks.length;
    chapterIndex++;
    chapters.push({
      title: chapterTitle,
      blockStart: rawBlocks.length,
      blockEnd: rawBlocks.length,
    });
  };

  for (const para of paragraphs) {
    if (looksLikeHeading(para)) {
      openChapter(para.split("\n")[0].trim());
      rawBlocks.push({ kind: "heading", level: 1, text: para, chapterIndex });
    } else {
      if (chapterIndex < 0) openChapter(title);
      rawBlocks.push({ kind: "para", text: para, chapterIndex });
    }
  }

  if (chapterIndex >= 0) chapters[chapterIndex].blockEnd = rawBlocks.length;
  if (chapters.length === 0) {
    chapters.push({ title, blockStart: 0, blockEnd: rawBlocks.length });
  }

  return { title, format, lang: "en", rawBlocks, chapters };
}
