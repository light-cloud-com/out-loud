// Shared finalize step: every parser emits RawBlock[] + chapter ranges, then
// finalizeDoc() splits block text into sentences (one segmentation call site)
// and builds the page list per format. This keeps sentence boundaries and page
// grouping consistent across TXT/EPUB/PDF.

import { splitSentences } from "./segment";
import type { NormalizedDoc, DocBlock, DocChapter, DocPage, DocFormat } from "./types";

export interface RawBlock {
  kind: "para" | "heading";
  level?: number;
  text: string;
  chapterIndex: number;
  pageIndex?: number;
}

export interface ParsedDoc {
  title: string;
  format: DocFormat;
  lang: string;
  rawBlocks: RawBlock[];
  chapters: { title: string; blockStart: number; blockEnd: number }[];
  sourcePath?: string;
  pageCount?: number;
}

export function finalizeDoc(p: ParsedDoc, id: string): NormalizedDoc {
  let sid = 0;
  const blocks: DocBlock[] = p.rawBlocks.map((rb, i) => ({
    id: `b${i}`,
    kind: rb.kind,
    level: rb.level,
    chapterIndex: rb.chapterIndex,
    pageIndex: rb.pageIndex,
    sentences: splitSentences(rb.text, p.lang).map((t) => ({ id: `s${sid++}`, text: t })),
  }));

  const chapters: DocChapter[] = p.chapters.map((c, i) => ({
    id: `c${i}`,
    title: c.title,
    blockStart: c.blockStart,
    blockEnd: c.blockEnd,
  }));

  const pages = buildPages(p.format, blocks, chapters);

  return {
    id,
    title: p.title,
    format: p.format,
    lang: p.lang,
    blocks,
    chapters,
    pages,
    sourcePath: p.sourcePath,
    pageCount: p.pageCount,
  };
}

function buildPages(format: DocFormat, blocks: DocBlock[], chapters: DocChapter[]): DocPage[] {
  if (blocks.length === 0) return [];

  if (format === "pdf") {
    return groupBy(
      blocks,
      (b) => b.pageIndex ?? 0,
      (pi, start, end, idx) => ({
        id: `p${idx}`,
        index: idx,
        label: `Page ${pi + 1}`,
        kind: "pdf",
        blockStart: start,
        blockEnd: end,
      })
    );
  }

  if (format === "epub" && chapters.length > 0) {
    return chapters.map((c, i) => ({
      id: `p${i}`,
      index: i,
      label: c.title || `Chapter ${i + 1}`,
      kind: "chapter",
      blockStart: c.blockStart,
      blockEnd: c.blockEnd,
    }));
  }

  // TXT (or EPUB with no chapters): synthetic pages by character budget.
  const BUDGET = 1800;
  const pages: DocPage[] = [];
  let start = 0;
  let acc = 0;
  blocks.forEach((b, i) => {
    const len = b.sentences.reduce((s, x) => s + x.text.length, 0);
    if (acc > 0 && acc + len > BUDGET) {
      pages.push(mkSynthetic(pages.length, start, i));
      start = i;
      acc = 0;
    }
    acc += len;
  });
  pages.push(mkSynthetic(pages.length, start, blocks.length));
  return pages;
}

function mkSynthetic(idx: number, start: number, end: number): DocPage {
  return {
    id: `p${idx}`,
    index: idx,
    label: `Page ${idx + 1}`,
    kind: "synthetic",
    blockStart: start,
    blockEnd: end,
  };
}

function groupBy<T>(
  items: DocBlock[],
  key: (b: DocBlock) => number,
  make: (keyVal: number, start: number, end: number, idx: number) => T
): T[] {
  const out: T[] = [];
  let cur = key(items[0]);
  let start = 0;
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]);
    if (k !== cur) {
      out.push(make(cur, start, i, out.length));
      cur = k;
      start = i;
    }
  }
  out.push(make(cur, start, items.length, out.length));
  return out;
}
