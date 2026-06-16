import JSZip from "jszip";
import type { ParsedDoc, RawBlock } from "../model";
import { stripExt } from "./shared";
import { allByLocal, firstByLocal, parseXml, textOfLocal } from "./html";

// DOCX = a zip of OOXML parts. We read word/document.xml and walk paragraphs
// (w:p) → text runs (w:t), matching by localName so the w: namespace prefix
// doesn't matter. Text only: headers/footers/footnotes/comments live in
// separate parts and are intentionally omitted for a clean read-aloud.

export async function parseDocx(bytes: Uint8Array, name: string): Promise<ParsedDoc> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error(
      "Couldn't open this as a Word .docx — it may be a legacy .doc, password-protected, or corrupt."
    );
  }

  const docXml = await readString(zip, "word/document.xml");
  if (!docXml) {
    throw new Error(
      "This isn't a Word .docx (no word/document.xml). Legacy .doc and encrypted files aren't supported here."
    );
  }

  const doc = parseXml(docXml);

  const coreXml = await readString(zip, "docProps/core.xml");
  const core = coreXml ? parseXml(coreXml) : null;
  const title = (core ? textOfLocal(core, "title") : "") || stripExt(name);
  let lang = (core ? textOfLocal(core, "language") : "").trim();

  const rawBlocks: RawBlock[] = [];
  for (const p of allByLocal(doc, "p")) {
    // Collect run text in document order; tabs/breaks become a space. Join the
    // runs first, THEN collapse whitespace at the paragraph level — collapsing
    // per-run would drop the spaces that xml:space="preserve" runs carry.
    let buf = "";
    for (const node of Array.from(p.getElementsByTagName("*"))) {
      const ln = node.localName;
      if (ln === "t") buf += node.textContent || "";
      else if (ln === "tab" || ln === "br" || ln === "cr") buf += " ";
    }
    const text = buf.replace(/\s+/g, " ").trim();
    if (!text) continue;

    // Heading detection via the paragraph style (w:pPr > w:pStyle w:val).
    const pPr = firstByLocal(p, "pPr");
    const styleEl = pPr ? firstByLocal(pPr, "pStyle") : null;
    const styleVal = styleEl?.getAttribute("w:val") || styleEl?.getAttribute("val") || "";
    const hm = /^heading\s*([1-6])/i.exec(styleVal);
    if (hm) {
      rawBlocks.push({ kind: "heading", level: Number(hm[1]), text, chapterIndex: 0 });
    } else if (/^title$/i.test(styleVal)) {
      rawBlocks.push({ kind: "heading", level: 1, text, chapterIndex: 0 });
    } else {
      rawBlocks.push({ kind: "para", text, chapterIndex: 0 });
    }

    if (!lang) {
      const langEl = pPr ? firstByLocal(pPr, "lang") : null;
      lang = langEl?.getAttribute("w:val") || langEl?.getAttribute("val") || "";
    }
  }

  if (rawBlocks.length === 0) {
    throw new Error("Couldn't extract any text from this Word document.");
  }

  const chapters = [{ title, blockStart: 0, blockEnd: rawBlocks.length }];
  return { title, format: "docx", lang: (lang || "en").trim(), rawBlocks, chapters };
}

async function readString(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path);
  return f ? await f.async("string") : null;
}
