// Fans captured audio out to every streaming session. Pure (no DOM), so it runs in tests.
import { bytesToBase64 } from "./base64";
import { concatInt16, floatToPcm16, pcm16Bytes, rms } from "./pcm";
import { StreamingResampler } from "./resampler";

export const MAX_RECORDING_SECONDS = 60;
export const CHUNK_MS = 100;
export const STREAM_RATES = [16000, 24000] as const;
export type StreamRate = (typeof STREAM_RATES)[number];

export interface AudioChunk {
  rate: StreamRate;
  pcm: Int16Array;
  /** Base64 of the little-endian PCM bytes, encoded once and shared by every session. */
  b64: string;
}

export interface AudioBusEvents {
  onChunk?: (chunk: AudioChunk) => void;
  /** RMS level (0..1) of the latest input block, for the meter. */
  onLevel?: (level: number) => void;
  /** Seconds since recording began when speech was first detected. */
  onSpeechStart?: (atSeconds: number) => void;
  /** Fired once when the input reaches the cap; the caller should stop. */
  onLimit?: () => void;
}

const SPEECH_RMS = 0.02; // about -34 dBFS
const SPEECH_FRAMES = 3; // 3 consecutive 20ms frames

interface Lane {
  resampler: StreamingResampler;
  pending: Int16Array[];
  pendingLen: number;
  chunkLen: number;
}

export class AudioBus {
  readonly inputRate: number;
  private readonly maxInput: number;
  private readonly lanes = new Map<StreamRate, Lane>();
  private readonly full16k: Int16Array[] = [];
  private inputSamples = 0;
  private limited = false;
  private closed = false;
  private loudFrames = 0;
  private speechAt: number | null = null;
  private vadCarry: Int16Array = new Int16Array(0);
  private vadSamples = 0;

  constructor(
    inputRate: number,
    private readonly events: AudioBusEvents = {},
    maxSeconds = MAX_RECORDING_SECONDS,
  ) {
    this.inputRate = inputRate;
    this.maxInput = Math.round(maxSeconds * inputRate);
    for (const rate of STREAM_RATES) {
      this.lanes.set(rate, {
        resampler: new StreamingResampler(inputRate, rate),
        pending: [],
        pendingLen: 0,
        chunkLen: (rate * CHUNK_MS) / 1000,
      });
    }
  }

  get seconds(): number {
    return this.inputSamples / this.inputRate;
  }

  get speechStartSeconds(): number | null {
    return this.speechAt;
  }

  push(frames: Float32Array) {
    if (this.closed || this.limited) return;
    let input = frames;
    const room = this.maxInput - this.inputSamples;
    if (input.length >= room) {
      input = input.subarray(0, room);
      this.limited = true;
    }
    this.inputSamples += input.length;
    this.events.onLevel?.(rms(input));

    for (const [rate, lane] of this.lanes) {
      const pcm = floatToPcm16(lane.resampler.process(input));
      if (rate === 16000) this.track16k(pcm);
      this.enqueue(rate, lane, pcm, false);
    }
    if (this.limited) this.events.onLimit?.();
  }

  /** Flushes resampler tails and any partial chunk. Returns the full 16k recording. */
  close(): Int16Array {
    if (!this.closed) {
      this.closed = true;
      for (const [rate, lane] of this.lanes) {
        const pcm = floatToPcm16(lane.resampler.flush());
        if (rate === 16000) this.track16k(pcm);
        this.enqueue(rate, lane, pcm, true);
      }
    }
    return concatInt16(this.full16k);
  }

  private track16k(pcm: Int16Array) {
    if (pcm.length === 0) return;
    this.full16k.push(pcm);
    this.detectSpeech(pcm);
  }

  private enqueue(rate: StreamRate, lane: Lane, pcm: Int16Array, final: boolean) {
    if (pcm.length) {
      lane.pending.push(pcm);
      lane.pendingLen += pcm.length;
    }
    while (lane.pendingLen >= lane.chunkLen || (final && lane.pendingLen > 0)) {
      const all = concatInt16(lane.pending);
      const take = Math.min(lane.chunkLen, all.length);
      const chunk = all.slice(0, take);
      const rest = all.subarray(take);
      lane.pending = rest.length ? [rest] : [];
      lane.pendingLen = rest.length;
      this.events.onChunk?.({ rate, pcm: chunk, b64: bytesToBase64(pcm16Bytes(chunk)) });
    }
  }

  private detectSpeech(pcm: Int16Array) {
    if (this.speechAt !== null) return;
    const frame = 320; // 20ms at 16k
    const data = this.vadCarry.length ? concatInt16([this.vadCarry, pcm]) : pcm;
    let i = 0;
    for (; i + frame <= data.length; i += frame) {
      this.loudFrames = rms(data, i, i + frame) > SPEECH_RMS ? this.loudFrames + 1 : 0;
      if (this.loudFrames >= SPEECH_FRAMES) {
        this.speechAt = (this.vadSamples + i + frame - SPEECH_FRAMES * frame) / 16000;
        this.events.onSpeechStart?.(this.speechAt);
        return;
      }
    }
    this.vadSamples += i;
    this.vadCarry = data.slice(i);
  }
}
