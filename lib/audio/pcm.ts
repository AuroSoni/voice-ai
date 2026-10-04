export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / 0x8000;
  return out;
}

export function rms(input: Float32Array | Int16Array, start = 0, end = input.length): number {
  const scale = input instanceof Int16Array ? 1 / 0x8000 : 1;
  let sum = 0;
  for (let i = start; i < end; i++) {
    const v = input[i] * scale;
    sum += v * v;
  }
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

export function concatInt16(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Little-endian bytes of PCM16 samples (what every provider's raw PCM input expects). */
export function pcm16Bytes(pcm: Int16Array): Uint8Array {
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}
