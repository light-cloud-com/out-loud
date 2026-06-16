// Canonical sentence segmentation, shared by every parser so that highlight /
// seek boundaries are identical regardless of source format.
//
// Prefers Intl.Segmenter (Node 22 + Chromium) which handles the app's non-Latin
// voices (ja/cmn/hi/…) far better than a regex; falls back to a regex when it
// is unavailable. Long sentences are soft-capped so a single unit never becomes
// an unwieldy audio chunk (which would delay first audio and coarsen highlight).

const MAX_UNIT_CHARS = 320;

// Sentence-ish fallback: run of non-terminators followed by terminators and any
// trailing closing brackets/quotes, or the trailing remainder.
const FALLBACK_RE = /[^.!?。！？…]+(?:[.!?。！？…]+["'”’」』）)\]]*)?\s*/g;

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string }>;
}

function segmenterFor(lang: string): SegmenterLike | null {
  try {
    const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: object) => SegmenterLike })
      .Segmenter;
    if (typeof Seg !== "function") return null;
    return new Seg(lang || "en", { granularity: "sentence" });
  } catch {
    return null;
  }
}

export function splitSentences(text: string, lang = "en"): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const raw: string[] = [];
  const seg = segmenterFor(lang);
  if (seg) {
    for (const part of seg.segment(clean)) {
      const t = part.segment.trim();
      if (t) raw.push(t);
    }
  } else {
    const matches = clean.match(FALLBACK_RE);
    if (matches) {
      for (const m of matches) {
        const t = m.trim();
        if (t) raw.push(t);
      }
    }
  }
  if (raw.length === 0) raw.push(clean);

  return capLong(mergeAbbrev(raw));
}

// Merge fragments that are almost certainly abbreviations split off by the
// segmenter (e.g. "Mr." / "Dr." / "e.g.") into the following sentence.
function mergeAbbrev(sentences: string[]): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    const prev = out.length - 1;
    const looksAbbrev = /^\S{1,4}\.$/.test(s) && !/[!?]/.test(s);
    if (prev >= 0 && looksAbbrev) {
      out[prev] = `${out[prev]} ${s}`;
    } else if (prev >= 0 && /\b\S{1,4}\.$/.test(out[prev]) && /^[a-z0-9]/.test(s)) {
      // previous ended in an abbreviation and this continues lowercase → join
      out[prev] = `${out[prev]} ${s}`;
    } else {
      out.push(s);
    }
  }
  return out;
}

// Split overly long sentences at the nearest clause/word boundary so units stay
// reasonable. Keeps the splitting deterministic and boundary-friendly.
function capLong(sentences: string[]): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= MAX_UNIT_CHARS) {
      out.push(s);
      continue;
    }
    let rest = s;
    while (rest.length > MAX_UNIT_CHARS) {
      const half = MAX_UNIT_CHARS * 0.5;
      let cut = rest.lastIndexOf(", ", MAX_UNIT_CHARS);
      if (cut < half) cut = rest.lastIndexOf("; ", MAX_UNIT_CHARS);
      if (cut < half) cut = rest.lastIndexOf(" ", MAX_UNIT_CHARS);
      if (cut <= 0) cut = MAX_UNIT_CHARS - 1;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1);
    }
    if (rest.trim()) out.push(rest.trim());
  }
  return out;
}
