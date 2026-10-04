import { describe, expect, it } from "vitest";
import { AudioBus, type AudioChunk } from "./bus";
import { base64ToBytes } from "./base64";

describe("AudioBus", () => {
  it("emits 100ms chunks at 16k and 24k and keeps the full 16k recording", () => {
    const chunks: AudioChunk[] = [];
    const bus = new AudioBus(48000, { onChunk: (c) => chunks.push(c) });
    for (let i = 0; i < 10; i++) bus.push(new Float32Array(4800)); // 1s in 100ms blocks
    const full = bus.close();
    expect(full.length).toBe(16000);
    const at16 = chunks.filter((c) => c.rate === 16000);
    const at24 = chunks.filter((c) => c.rate === 24000);
    expect(at16.reduce((n, c) => n + c.pcm.length, 0)).toBe(16000);
    expect(at24.reduce((n, c) => n + c.pcm.length, 0)).toBe(24000);
    expect(at16.every((c) => c.pcm.length <= 1600)).toBe(true);
    expect(base64ToBytes(at16[0].b64).length).toBe(at16[0].pcm.length * 2);
  });

  it("stops at the cap and fires onLimit once", () => {
    let limits = 0;
    const bus = new AudioBus(16000, { onLimit: () => limits++ }, 1);
    bus.push(new Float32Array(12000));
    bus.push(new Float32Array(12000));
    bus.push(new Float32Array(12000));
    expect(limits).toBe(1);
    expect(bus.seconds).toBe(1);
    expect(bus.close().length).toBe(16000);
  });

  it("detects when speech starts", () => {
    let at: number | null = null;
    const bus = new AudioBus(16000, { onSpeechStart: (s) => (at = s) });
    bus.push(new Float32Array(8000)); // 0.5s silence
    const tone = new Float32Array(8000);
    for (let i = 0; i < tone.length; i++) tone[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16000);
    bus.push(tone);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThan(0.45);
    expect(at!).toBeLessThan(0.56);
  });
});
