// Minimal ambient types for word-extractor (ships no types of its own).
declare module "word-extractor" {
  interface WordDocument {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(): string;
    getTextboxes(): string;
  }
  export default class WordExtractor {
    extract(source: Buffer | string): Promise<WordDocument>;
  }
}
