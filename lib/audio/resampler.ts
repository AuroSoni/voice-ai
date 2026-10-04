/**
 * Streaming windowed-sinc resampler for mono Float32 audio.
 *
 * Every output sample n sits at input position n * (inRate / outRate) and is a
 * Blackman-windowed sinc low-pass of the surrounding input, with the cutoff at 90% of
 * the lower Nyquist so downsampling doesn't fold high frequencies back into speech.
 * Positions come from an integer output counter, so long streams never drift, and
 * filter history carries across calls, so output doesn't depend on chunking.
 */
const PHASES = 512;

export class StreamingResampler {
  readonly inRate: number;
  readonly outRate: number;
  private readonly ratio: number;
  private readonly half: number;
  private readonly table: Float32Array;

  private buf: Float32Array;
  private bufLen = 0;
  /** Absolute input index of buf[0]; negative at start because of the zero history. */
  private bufStart: number;
  private totalIn = 0;
  private outCount = 0;

  constructor(inRate: number, outRate: number, zeroCrossings = 16) {
    this.inRate = inRate;
    this.outRate = outRate;
    this.ratio = inRate / outRate;
    // Cutoff in cycles per input sample.
    const fc = (0.9 * Math.min(inRate, outRate)) / 2 / inRate;
    this.half = Math.ceil(zeroCrossings / (2 * fc));
    this.table = buildKernel(fc, this.half);
    this.bufStart = -this.half;
    this.buf = new Float32Array(Math.max(4096, this.half * 4));
    this.bufLen = this.half; // zero history so the first output is centred on input 0
  }

  process(input: Float32Array): Float32Array {
    this.append(input);
    this.totalIn += input.length;
    return this.drain(false);
  }

  /** Emits the remaining tail. The resampler must not be used afterwards. */
  flush(): Float32Array {
    this.append(new Float32Array(this.half + 1));
    return this.drain(true);
  }

  private append(input: Float32Array) {
    const need = this.bufLen + input.length;
    if (need > this.buf.length) {
      const next = new Float32Array(Math.max(need, this.buf.length * 2));
      next.set(this.buf.subarray(0, this.bufLen));
      this.buf = next;
    }
    this.buf.set(input, this.bufLen);
    this.bufLen += input.length;
  }

  private drain(final: boolean): Float32Array {
    const H = this.half;
    const bufEnd = this.bufStart + this.bufLen;
    const maxOut = Math.max(0, Math.ceil((bufEnd - H) / this.ratio) - this.outCount + 1);
    const out = new Float32Array(maxOut);
    let n = 0;

    for (;;) {
      const pos = this.outCount * this.ratio;
      if (final && pos >= this.totalIn) break;
      const centre = Math.floor(pos);
      if (centre + H >= bufEnd) break;

      const first = centre - H + 1;
      const base = first - this.bufStart;
      let acc = 0;
      for (let i = 0; i < 2 * H; i++) {
        acc += this.buf[base + i] * this.kernel(Math.abs(pos - (first + i)));
      }
      out[n++] = acc;
      this.outCount++;
    }

    // Drop input that no future output needs.
    const keepFrom = Math.floor(this.outCount * this.ratio) - H + 1;
    const drop = keepFrom - this.bufStart;
    if (drop > 0 && drop <= this.bufLen) {
      this.buf.copyWithin(0, drop, this.bufLen);
      this.bufLen -= drop;
      this.bufStart += drop;
    }
    return n === out.length ? out : out.slice(0, n);
  }

  private kernel(distance: number): number {
    const idx = distance * PHASES;
    const i = Math.floor(idx);
    const f = idx - i;
    return this.table[i] + f * (this.table[i + 1] - this.table[i]);
  }
}

function buildKernel(fc: number, half: number): Float32Array {
  const size = half * PHASES + 2;
  const table = new Float32Array(size);
  for (let j = 0; j < size; j++) {
    const d = j / PHASES;
    if (d > half) break;
    const x = 2 * fc * d;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = d / half;
    const blackman = 0.42 + 0.5 * Math.cos(Math.PI * w) + 0.08 * Math.cos(2 * Math.PI * w);
    table[j] = 2 * fc * sinc * blackman;
  }
  return table;
}

/** One-shot helper for whole buffers (tests, file sources, smoke scripts). */
export function resample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input.slice();
  const r = new StreamingResampler(inRate, outRate);
  const a = r.process(input);
  const b = r.flush();
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
