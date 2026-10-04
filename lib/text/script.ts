// Which writing system a transcript came back in — a key signal for Gujarati and
// Marwari, where models often reply in Devanagari or Roman script instead.
export type Script = "Devanagari" | "Gujarati" | "Latin" | "Other";

const RANGES: [Script, number, number][] = [
  ["Devanagari", 0x0900, 0x097f],
  ["Devanagari", 0xa8e0, 0xa8ff],
  ["Gujarati", 0x0a80, 0x0aff],
];

function scriptOf(cp: number): Script | null {
  for (const [script, lo, hi] of RANGES) if (cp >= lo && cp <= hi) return script;
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f)) return "Latin";
  if (/\p{L}/u.test(String.fromCodePoint(cp))) return "Other";
  return null; // digits, punctuation, spaces, combining marks outside the ranges
}

export interface ScriptBreakdown {
  dominant: Script | null;
  /** Share of letters per script, 0..1. */
  shares: Partial<Record<Script, number>>;
  mixed: boolean;
}

export function detectScript(text: string): ScriptBreakdown {
  const counts: Partial<Record<Script, number>> = {};
  let total = 0;
  for (const ch of text) {
    const s = scriptOf(ch.codePointAt(0)!);
    if (!s) continue;
    counts[s] = (counts[s] ?? 0) + 1;
    total++;
  }
  if (total === 0) return { dominant: null, shares: {}, mixed: false };
  const shares: Partial<Record<Script, number>> = {};
  let dominant: Script | null = null;
  for (const [s, n] of Object.entries(counts) as [Script, number][]) {
    shares[s] = n / total;
    if (!dominant || n > counts[dominant]!) dominant = s;
  }
  const mixed = Object.values(shares).filter((v) => v >= 0.15).length > 1;
  return { dominant, shares, mixed };
}
