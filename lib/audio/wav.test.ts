import { describe, expect, it } from "vitest";
import { encodeWav, parseWav, splitAtQuietPoints } from "./wav";

describe("wav", () => {
  it("round-trips PCM16 mono", () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    const bytes = encodeWav(pcm, 16000);
    expect(bytes.length).toBe(44 + pcm.length * 2);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    const parsed = parseWav(bytes);
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.channels).toBe(1);
    expect(Array.from(parsed.pcm)).toEqual(Array.from(pcm));
  });

  it("rejects non-WAV input", () => {
    expect(() => parseWav(new Uint8Array(100))).toThrow();
  });

  it("splits long audio at the quietest point inside the window", () => {
    const rate = 16000;
    const pcm = new Int16Array(rate * 70).fill(8000);
    // A silent gap at 27.0–27.2s should be the first cut.
    pcm.fill(0, rate * 27, rate * 27.2);
    const pieces = splitAtQuietPoints(pcm, rate);
    expect(pieces.length).toBe(3);
    expect(pieces[0].length / rate).toBeGreaterThan(27);
    expect(pieces[0].length / rate).toBeLessThan(27.2);
    for (const p of pieces) expect(p.length / rate).toBeLessThanOrEqual(29);
    expect(pieces.reduce((n, p) => n + p.length, 0)).toBe(pcm.length);
  });

  it("leaves short audio whole", () => {
    expect(splitAtQuietPoints(new Int16Array(16000 * 20), 16000)).toHaveLength(1);
  });
});
