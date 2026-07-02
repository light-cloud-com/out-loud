// Carve a short leading piece off a phoneme string so the very first inference
// of a generation stays small (fast time-to-first-audio). Cuts only at a word
// boundary (space) so the audio seam falls between words; returns null when the
// string already fits the budget or no boundary exists within it.
export function splitLeadingPhonemes(phonemes: string, budget: number): [string, string] | null {
  if (budget <= 0 || phonemes.length <= budget) return null;
  const cut = phonemes.lastIndexOf(" ", budget);
  if (cut <= 0) return null;
  const head = phonemes.slice(0, cut);
  const rest = phonemes.slice(cut + 1);
  if (head.length === 0 || rest.length === 0) return null;
  return [head, rest];
}
