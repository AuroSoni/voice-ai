import { describe, expect, it } from "vitest";
import { resample, StreamingResampler } from "./resampler";
import { rms } from "./pcm";

function sine(freq: number, rate: number, seconds: number, amp = 0.5) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

// Ignore filter edge effects at the very start/end.
const middle = (x: Float32Array) => x.subarray(Math.floor(x.length * 0.1), Math.floor(x.length * 0.9));

describe("StreamingResampler", () => {
  it.each([
    [48000, 16000],
    [48000, 24000],
    [44100, 16000],
    [44100, 24000],
    [16000, 48000],
  ])("keeps a 440 Hz tone's amplitude (%i → %i)", (inRate, outRate) => {
    const out = resample(sine(440, inRate, 1), inRate, outRate);
    expect(rms(middle(out))).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("rejects content above the new Nyquist instead of aliasing it", () => {
    const out = resample(sine(12000, 48000, 1), 48000, 16000);
    expect(rms(middle(out))).toBeLessThan(0.005);
  });

  it("produces the same output however the input is chunked", () => {
    const input = sine(300, 48000, 0.5);
    const whole = resample(input, 48000, 16000);

    const r = new StreamingResampler(48000, 16000);
    const parts: Float32Array[] = [];
    let i = 0;
    const sizes = [1, 7, 128, 999, 2048, 3];
    for (let k = 0; i < input.length; k++) {
      const n = sizes[k % sizes.length];
      parts.push(r.process(input.subarray(i, i + n)));
      i += n;
    }
    parts.push(r.flush());
    const chunked = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      chunked.set(p, o);
      o += p.length;
    }
    expect(chunked.length).toBe(whole.length);
    for (let j = 0; j < whole.length; j++) expect(chunked[j]).toBeCloseTo(whole[j], 5);
  });

  it("does not drift in length over 60 seconds", () => {
    expect(resample(new Float32Array(48000 * 60), 48000, 16000).length).toBe(16000 * 60);
    expect(resample(new Float32Array(44100 * 60), 44100, 24000).length).toBe(24000 * 60);
  });
});
