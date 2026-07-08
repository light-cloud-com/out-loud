import { describe, it, expect } from "vitest";
import { splitLeadingPhonemes } from "../electron/phoneme-split.js";

// splitLeadingPhonemes(phonemes, budget) carves a short leading piece off a
// phoneme string so the very first inference of a generation is small (fast
// first audio). It must only cut at a word boundary (space) so the seam falls
// between words, and must return null when no split is needed or possible.
describe("splitLeadingPhonemes", () => {
  it("returns null when the string fits the budget", () => {
    expect(splitLeadingPhonemes("həlˈoʊ wˈɜːld", 40)).toBeNull();
  });

  it("splits at the last space at or before the budget", () => {
    //          0123456789...
    const s = "ðə kˈæt sˈæt ɒn ðə mˈæt";
    const result = splitLeadingPhonemes(s, 12);
    expect(result).not.toBeNull();
    const [head, rest] = result!;
    expect(head).toBe("ðə kˈæt sˈæt");
    expect(rest).toBe("ɒn ðə mˈæt");
  });

  it("keeps the head within the budget", () => {
    const s = "wˈʌn tˈuː θɹˈiː fˈoːɹ fˈaɪv sˈɪks sˈɛvən ˈeɪt nˈaɪn tˈɛn";
    const result = splitLeadingPhonemes(s, 20);
    expect(result).not.toBeNull();
    expect(result![0].length).toBeLessThanOrEqual(20);
  });

  it("loses no phonemes: head + space + rest equals the original", () => {
    const s = "ðə kwˈɪk bɹˈaʊn fˈɒks dʒˈʌmps ˈoʊvə ðə lˈeɪzi dˈɒɡ";
    const result = splitLeadingPhonemes(s, 25);
    expect(result).not.toBeNull();
    const [head, rest] = result!;
    expect(`${head} ${rest}`).toBe(s);
  });

  it("returns null when there is no word boundary within the budget", () => {
    expect(splitLeadingPhonemes("sˌuːpəkˌalɪfɹˌadʒɪlˈɪstɪk ˈɛkspiːˌalɪdˈoʊʃəs", 10)).toBeNull();
  });

  it("returns null for a non-positive budget", () => {
    expect(splitLeadingPhonemes("ðə kˈæt", 0)).toBeNull();
  });

  it("produces non-empty head and rest whenever it splits", () => {
    const result = splitLeadingPhonemes("ˈab ˈcd", 6);
    expect(result).not.toBeNull();
    const [head, rest] = result!;
    expect(head.length).toBeGreaterThan(0);
    expect(rest.length).toBeGreaterThan(0);
  });
});
