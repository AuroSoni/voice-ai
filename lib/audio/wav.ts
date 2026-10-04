import { rms } from "./pcm";

const HEADER_BYTES = 44;

/** 16-bit PCM mono WAV. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(HEADER_BYTES + i * 2, pcm[i], true);
  return out;
}

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcm: Int16Array;
}

/** Parses PCM16 WAV (any chunk order). Throws on anything else, so uploads can be validated. */
export function parseWav(bytes: Uint8Array): ParsedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");

  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before fmt chunk");
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error("WAV must be 16-bit PCM");
      const end = Math.min(body + size, bytes.length);
      const samples = Math.floor((end - body) / 2);
      const pcm = new Int16Array(samples);
      for (let i = 0; i < samples; i++) pcm[i] = view.getInt16(body + i * 2, true);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, pcm };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/**
 * Splits audio into pieces no longer than maxSeconds, cutting at the quietest 20ms
 * frame between minSeconds and maxSeconds so words aren't chopped in half.
 * Used for Sarvam REST, which rejects requests over 30s.
 */
export function splitAtQuietPoints(
  pcm: Int16Array,
  sampleRate: number,
  minSeconds = 25,
  maxSeconds = 29,
): Int16Array[] {
  const maxLen = Math.floor(maxSeconds * sampleRate);
  const minLen = Math.floor(minSeconds * sampleRate);
  const frame = Math.floor(0.02 * sampleRate);
  const pieces: Int16Array[] = [];
  let start = 0;
  while (pcm.length - start > maxLen) {
    let bestCut = start + maxLen;
    let bestEnergy = Infinity;
    for (let f = start + minLen; f + frame <= start + maxLen; f += frame) {
      const e = rms(pcm, f, f + frame);
      if (e < bestEnergy) {
        bestEnergy = e;
        bestCut = f + Math.floor(frame / 2);
      }
    }
    pieces.push(pcm.subarray(start, bestCut));
    start = bestCut;
  }
  pieces.push(pcm.subarray(start));
  return pieces;
}
