import JSZip from "jszip";
import type { ParsedDoc, RawBlock } from "../model";
import { dirOf, resolveHref, stripExt } from "./shared";
import { allByLocal, blocksFromHtml, firstByLocal, parseXml, textOfLocal } from "./html";

// EPUB = a zip of XHTML documents + an OPF (manifest + spine reading order) +
// a nav/NCX table of contents. We parse the OPF/NCX as XML (matching by local
// name to dodge namespace prefixes) and the content documents with the lenient
// HTML parser. One chapter per spine document — robust for the common case.

const XHTML_TYPES = ["application/xhtml+xml", "text/html", "application/html"];

export async function parseEpub(bytes: Uint8Array, name: string): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(bytes);

  if (zip.file("META-INF/encryption.xml")) {
    throw new Error("This EPUB is DRM-protected and can't be read. Try a DRM-free copy.");
  }

  const containerXml = await readString(zip, "META-INF/container.xml");
  if (!containerXml) throw new Error("Not a valid EPUB (missing container.xml).");

  const container = parseXml(containerXml);
  const rootfile = firstByLocal(container, "rootfile");
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new Error("Not a valid EPUB (no OPF root file).");

  const opfXml = await readString(zip, opfPath);
  if (!opfXml) throw new Error("Not a valid EPUB (OPF not found).");
  const opf = parseXml(opfXml);
  const opfDir = dirOf(opfPath);

  const title = textOfLocal(opf, "title") || stripExt(name);
  const lang = (textOfLocal(opf, "language") || "en").trim();

  // manifest: id -> { href, type, properties }
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of allByLocal(opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      type: item.getAttribute("media-type") || "",
      props: item.getAttribute("properties") || "",
    });
  }

  // spine: ordered idrefs
  const spineEl = firstByLocal(opf, "spine");
  const spine: string[] = [];
  for (const ref of allByLocal(opf, "itemref")) {
    const idref = ref.getAttribute("idref");
    if (idref) spine.push(idref);
  }

  // TOC titles: resolved-path -> title (from EPUB3 nav or EPUB2 NCX)
  const navTitles = await loadTocTitles(zip, manifest, opfDir, spineEl);

  const rawBlocks: RawBlock[] = [];
  const chapters: { title: string; blockStart: number; blockEnd: number }[] = [];
  let chapterIndex = -1;

  for (const idref of spine) {
    const item = manifest.get(idref);
    if (!item) continue;
    if (!XHTML_TYPES.includes(item.type)) continue;

    const path = resolveHref(opfDir, item.href);
    const html = await readString(zip, path);
    if (!html) continue;

    const blocks = blocksFromHtml(html);
    if (blocks.length === 0) continue;

    chapterIndex++;
    const navTitle = navTitles.get(path);
    const firstHeading = blocks.find((b) => b.kind === "heading")?.text;
    const chapterTitle = navTitle || firstHeading || `Chapter ${chapterIndex + 1}`;
    chapters.push({ title: chapterTitle, blockStart: rawBlocks.length, blockEnd: 0 });

    for (const b of blocks) rawBlocks.push({ ...b, chapterIndex });
    chapters[chapterIndex].blockEnd = rawBlocks.length;
  }

  if (rawBlocks.length === 0) {
    throw new Error("Couldn't extract any text from this EPUB.");
  }
  if (chapters.length === 0) {
    chapters.push({ title, blockStart: 0, blockEnd: rawBlocks.length });
  }

  return { title, format: "epub", lang, rawBlocks, chapters, pageCount: undefined };
}

// ---- TOC ----

async function loadTocTitles(
  zip: JSZip,
  manifest: Map<string, { href: string; type: string; props: string }>,
  opfDir: string,
  spineEl: Element | null
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();

  // EPUB3: a manifest item with properties="nav".
  let navHref: string | null = null;
  for (const [, item] of manifest) {
    if (item.props.split(/\s+/).includes("nav")) {
      navHref = item.href;
      break;
    }
  }
  if (navHref) {
    const navPath = resolveHref(opfDir, navHref);
    const navHtml = await readString(zip, navPath);
    if (navHtml) {
      const navDir = dirOf(navPath);
      const doc = new DOMParser().parseFromString(navHtml, "text/html");
      for (const a of Array.from(doc.querySelectorAll("nav a[href]"))) {
        const href = a.getAttribute("href") || "";
        const t = (a.textContent || "").replace(/\s+/g, " ").trim();
        if (t) titles.set(resolveHref(navDir, href), t);
      }
      if (titles.size > 0) return titles;
    }
  }

  // EPUB2: NCX referenced by spine[toc] (or a manifest item of the NCX type).
  let ncxHref: string | null = null;
  const tocId = spineEl?.getAttribute("toc");
  if (tocId && manifest.has(tocId)) {
    ncxHref = manifest.get(tocId)!.href;
  } else {
    for (const [, item] of manifest) {
      if (item.type === "application/x-dtbncx+xml") {
        ncxHref = item.href;
        break;
      }
    }
  }
  if (ncxHref) {
    const ncxPath = resolveHref(opfDir, ncxHref);
    const ncxXml = await readString(zip, ncxPath);
    if (ncxXml) {
      const ncxDir = dirOf(ncxPath);
      const ncx = parseXml(ncxXml);
      for (const np of allByLocal(ncx, "navPoint")) {
        const label = firstByLocal(np, "text")?.textContent?.replace(/\s+/g, " ").trim();
        const src = firstByLocal(np, "content")?.getAttribute("src");
        if (label && src) titles.set(resolveHref(ncxDir, src), label);
      }
    }
  }
  return titles;
}

// ---- EPUB-local zip helper ----

async function readString(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path);
  return f ? await f.async("string") : null;
}
