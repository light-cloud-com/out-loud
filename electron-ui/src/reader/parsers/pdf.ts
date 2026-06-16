import type { ParsedDoc, RawBlock } from "../model";
import { stripExt } from "./shared";
import { pdfjsLib } from "./pdfSetup";

type PdfDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;

interface OutlineEntry {
  title: string;
  page: number;
}

export async function parsePdf(bytes: Uint8Array, name: string): Promise<ParsedDoc> {
  // pdfjs may transfer/detach the buffer; hand it a private copy.
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  try {
    const metaTitle = await pdf
      .getMetadata()
      .then((m) => (m.info as { Title?: string } | undefined)?.Title?.trim())
      .catch(() => undefined);
    const title = metaTitle || stripExt(name);

    const rawBlocks: RawBlock[] = [];
    let totalChars = 0;

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const paragraphs = itemsToParagraphs(content.items as TextLikeItem[]);
      for (const para of paragraphs) {
        totalChars += para.length;
        rawBlocks.push({ kind: "para", text: para, chapterIndex: 0, pageIndex: p - 1 });
      }
      page.cleanup();
    }

    if (totalChars === 0) {
      throw new Error(
        "This PDF has no extractable text (it looks scanned). OCR isn't supported yet."
      );
    }

    const chapters = await buildChapters(pdf, rawBlocks, title);
    return { title, format: "pdf", lang: "en", rawBlocks, chapters, pageCount: pdf.numPages };
  } finally {
    await pdf.destroy();
  }
}

interface TextLikeItem {
  str?: string;
  transform?: number[];
  height?: number;
}

// Reconstruct paragraphs from positioned text items: group items into lines by
// their Y, order lines top→bottom, then split into paragraphs where the gap
// between consecutive lines is noticeably larger than the typical line gap.
function itemsToParagraphs(items: TextLikeItem[]): string[] {
  const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.transform) continue;
    if (!it.str) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let line = lines.find((l) => Math.abs(l.y - y) < 3);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, s: it.str });
  }
  if (lines.length === 0) return [];

  lines.sort((a, b) => b.y - a.y);
  const lineTexts = lines.map((l) =>
    l.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.s)
      .join("")
      .replace(/\s+/g, " ")
      .trim()
  );

  // Median gap between consecutive lines.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
  const median = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
  const paraBreak = median * 1.8;

  const paragraphs: string[] = [];
  let current = "";
  for (let i = 0; i < lineTexts.length; i++) {
    const t = lineTexts[i];
    if (!t) continue;
    if (current && i > 0 && lines[i - 1].y - lines[i].y > paraBreak) {
      paragraphs.push(current.trim());
      current = "";
    }
    current = current ? `${current} ${t}` : t;
  }
  if (current.trim()) paragraphs.push(current.trim());
  return paragraphs;
}

// ---- Outline → chapters ----

async function buildChapters(
  pdf: PdfDoc,
  rawBlocks: RawBlock[],
  title: string
): Promise<{ title: string; blockStart: number; blockEnd: number }[]> {
  const outline = await pdf.getOutline().catch(() => null);
  const entries: OutlineEntry[] = [];

  if (outline && outline.length) {
    for (const item of flattenOutline(outline)) {
      const page = await destToPageIndex(pdf, item.dest).catch(() => null);
      if (page != null) entries.push({ title: item.title.trim() || "Section", page });
    }
  }

  if (entries.length === 0) {
    return [{ title, blockStart: 0, blockEnd: rawBlocks.length }];
  }

  entries.sort((a, b) => a.page - b.page);

  // Assign each block to the last outline entry whose page <= block's page.
  let ci = 0;
  for (const b of rawBlocks) {
    const pi = b.pageIndex ?? 0;
    while (ci + 1 < entries.length && entries[ci + 1].page <= pi) ci++;
    b.chapterIndex = ci;
  }

  const chapters = entries.map((e) => ({ title: e.title, blockStart: -1, blockEnd: 0 }));
  rawBlocks.forEach((b, idx) => {
    if (chapters[b.chapterIndex].blockStart < 0) chapters[b.chapterIndex].blockStart = idx;
  });
  // Backward pass guarantees valid, monotonic ranges (empty chapters collapse).
  let nextStart = rawBlocks.length;
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (chapters[i].blockStart < 0 || chapters[i].blockStart > nextStart) {
      chapters[i].blockStart = nextStart;
    }
    chapters[i].blockEnd = nextStart;
    nextStart = chapters[i].blockStart;
  }
  return chapters;
}

interface RawOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items?: RawOutlineItem[];
}

function flattenOutline(items: RawOutlineItem[], acc: RawOutlineItem[] = []): RawOutlineItem[] {
  for (const it of items) {
    acc.push(it);
    if (it.items && it.items.length) flattenOutline(it.items, acc);
  }
  return acc;
}

async function destToPageIndex(
  pdf: PdfDoc,
  dest: string | unknown[] | null
): Promise<number | null> {
  let explicit = dest;
  if (typeof dest === "string") explicit = await pdf.getDestination(dest);
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const ref = explicit[0];
  if (ref && typeof ref === "object") {
    return await pdf.getPageIndex(ref as Parameters<typeof pdf.getPageIndex>[0]);
  }
  if (typeof ref === "number") return ref;
  return null;
}
