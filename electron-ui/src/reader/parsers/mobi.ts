import type { ParsedDoc, RawBlock } from "../model";
import { stripExt } from "./shared";
import { blocksFromBody } from "./html";
import { MOBI } from "../vendor/foliate-mobi.js";

// MOBI / AZW / AZW3 (KF8) via the vendored foliate-js mobi.js. Each book section
// becomes a chapter; its HTML Document feeds the shared blocksFromBody. DRM-free
// files only — Kindle-store DRM is detected and rejected with a clear message.

export async function parseMobi(bytes: Uint8Array, name: string): Promise<ParsedDoc> {
  // mobi.js reads through Blob.slice().arrayBuffer(), so wrap the bytes in a Blob.
  const blob = new Blob([bytes]);

  let book;
  try {
    // The throwing unzlib stub is only ever reached by font extraction, never on
    // the text path, so it's safe to not provide a real inflate.
    book = await new MOBI({
      unzlib: () => {
        throw new Error("font");
      },
    }).open(blob);
  } catch {
    throw new Error(
      "Couldn't read this Kindle book. If it's from the Kindle store it may be DRM-protected — try a DRM-free copy."
    );
  }

  // DRM guard: PalmDOC encryption 0 = none, anything else = encrypted/DRM.
  const enc = book?.mobi?.headers?.palmdoc?.encryption;
  if (typeof enc === "number" && enc !== 0) {
    throw new Error("This Kindle book is DRM-protected and can't be read. Try a DRM-free copy.");
  }

  const title = (book?.metadata?.title || "").trim() || stripExt(name);
  const lang = (book?.metadata?.language || "en").toString().trim() || "en";

  const rawBlocks: RawBlock[] = [];
  const chapters: { title: string; blockStart: number; blockEnd: number }[] = [];
  let chapterIndex = -1;

  const sections = Array.isArray(book?.sections) ? book.sections : [];
  for (const section of sections) {
    // Skip KF8 non-linear sections (nav, etc.) and anything without content.
    if (!section || section.linear === "no" || typeof section.createDocument !== "function") {
      continue;
    }
    let doc: Document | null = null;
    try {
      doc = await section.createDocument();
    } catch {
      continue; // a section that fails to decode shouldn't kill the whole book
    }
    const blocks = blocksFromBody(doc?.body ?? null);
    if (blocks.length === 0) continue;

    chapterIndex++;
    chapters.push({
      title: `Chapter ${chapterIndex + 1}`,
      blockStart: rawBlocks.length,
      blockEnd: 0,
    });
    for (const b of blocks) rawBlocks.push({ ...b, chapterIndex });
    chapters[chapterIndex].blockEnd = rawBlocks.length;
  }

  if (rawBlocks.length === 0) {
    throw new Error(
      "Couldn't extract any text from this Kindle book — it may be DRM-protected or an unsupported variant (e.g. KFX)."
    );
  }
  if (chapters.length === 0) {
    chapters.push({ title, blockStart: 0, blockEnd: rawBlocks.length });
  }

  return { title, format: "mobi", lang, rawBlocks, chapters };
}
