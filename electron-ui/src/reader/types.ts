// Normalized document model shared across the reader (parsers, engine, UI).
// The sentence is the atomic unit for TTS, highlight, scroll, and seek; blocks
// (paragraphs/headings) are render containers holding sentences.

export type DocFormat = "txt" | "epub" | "pdf" | "docx" | "doc" | "mobi";

export interface DocSentence {
  /** Globally unique, stable id within a document, e.g. "s42". */
  id: string;
  text: string;
}

export interface DocBlock {
  id: string;
  kind: "para" | "heading";
  /** Heading level 1-6 (headings only). */
  level?: number;
  chapterIndex: number;
  /** Source page (PDF) or synthetic page (TXT); undefined for EPUB. */
  pageIndex?: number;
  sentences: DocSentence[];
}

export interface DocChapter {
  id: string;
  title: string;
  /** Index into NormalizedDoc.blocks (inclusive). */
  blockStart: number;
  /** Index into NormalizedDoc.blocks (exclusive). */
  blockEnd: number;
}

export interface DocPage {
  id: string;
  index: number;
  label: string;
  kind: "pdf" | "synthetic" | "chapter";
  blockStart: number;
  blockEnd: number;
}

export interface NormalizedDoc {
  id: string;
  title: string;
  format: DocFormat;
  /** Best-effort language tag, used for sentence segmentation. */
  lang: string;
  blocks: DocBlock[];
  chapters: DocChapter[];
  pages: DocPage[];
  /** On-disk path when opened from a file (enables resume / re-read). */
  sourcePath?: string;
  /** PDF page count (for the thumbnail sidebar). */
  pageCount?: number;
}
