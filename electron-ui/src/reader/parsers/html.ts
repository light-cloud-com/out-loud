import type { RawBlock } from "../model";

// Shared HTML → RawBlock[] extraction and XML helpers, used by every parser
// that produces HTML/XML (epub, mobi, …). Lifted out of epub.ts so the parsers
// share one code path instead of duplicating it.

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,pre,dd,dt";

// Extract readable blocks from an HTML string.
export function blocksFromHtml(html: string): RawBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return blocksFromBody(doc.body);
}

// Extract readable blocks from an already-parsed body element (e.g. a Document
// produced by mobi.js createDocument()), so callers holding a DOM don't have to
// re-serialize to a string.
export function blocksFromBody(body: HTMLElement | null): RawBlock[] {
  if (!body) return [];
  body.querySelectorAll("script,style,nav,header,footer,aside").forEach((e) => e.remove());

  // Leaf blocks only (a node that contains no other block) to avoid double
  // counting nested structures like <blockquote><p>…</p></blockquote>.
  const nodes = Array.from(body.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el) => !el.querySelector(BLOCK_SELECTOR)
  );

  const out: RawBlock[] = [];
  if (nodes.length === 0) {
    // No structural blocks — fall back to the whole body's text (covers content
    // that flattens to a single text node, common in MOBI).
    const t = (body.textContent || "").replace(/\s+/g, " ").trim();
    if (t) out.push({ kind: "para", text: t, chapterIndex: 0 });
    return out;
  }

  for (const el of nodes) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const tag = el.tagName.toLowerCase();
    const headingLevel = /^h([1-6])$/.exec(tag);
    if (headingLevel) {
      out.push({ kind: "heading", level: Number(headingLevel[1]), text, chapterIndex: 0 });
    } else {
      out.push({ kind: "para", text, chapterIndex: 0 });
    }
  }
  return out;
}

// ---- XML helpers (match by localName to ignore namespace prefixes) ----

export function parseXml(str: string): Document {
  return new DOMParser().parseFromString(str, "application/xml");
}

export function allByLocal(root: Document | Element, local: string): Element[] {
  const all = root.getElementsByTagName("*");
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === local) out.push(all[i]);
  }
  return out;
}

export function firstByLocal(root: Document | Element, local: string): Element | null {
  return allByLocal(root, local)[0] || null;
}

export function textOfLocal(root: Document | Element, local: string): string {
  return firstByLocal(root, local)?.textContent?.trim() || "";
}
