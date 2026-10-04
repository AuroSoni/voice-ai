// Browser audio capture: mic or a decoded clip → AudioWorklet → AudioBus.
// Clips play through the same graph as the mic, so the audio clock sets a real-time pace
// and every model receives byte-identical audio either way.
import { AudioBus, type AudioBusEvents } from "./bus";
import { pcm16ToFloat } from "./pcm";

export interface MicSettings {
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export const DEFAULT_MIC: MicSettings = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export interface CaptureInfo {
  contextSampleRate: number;
  track?: MediaTrackSettings;
}

export interface EngineEvents extends AudioBusEvents {
  /** The mic track ended (unplugged, permission revoked) or the clip finished playing. */
  onEnded?: () => void;
}

export class AudioEngine {
  private ctx?: AudioContext;
  private node?: AudioWorkletNode;
  private stream?: MediaStream;
  private clip?: AudioBufferSourceNode;
  private bus?: AudioBus;
  private stopped = false;

  constructor(private readonly events: EngineEvents) {}

  /** Asks for the mic (the permission prompt shows here), then starts capturing. */
  async startMic(settings: MicSettings): Promise<CaptureInfo> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser can't record audio here (a secure https:// page is required).");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined,
        channelCount: 1,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      },
    });
    const track = this.stream.getAudioTracks()[0];
    track.addEventListener("ended", () => this.events.onEnded?.());
    const ctx = await this.setupGraph();
    ctx.createMediaStreamSource(this.stream).connect(this.node!);
    return { contextSampleRate: ctx.sampleRate, track: track.getSettings() };
  }

  async startClip(buffer: AudioBuffer): Promise<CaptureInfo> {
    const ctx = await this.setupGraph();
    this.clip = ctx.createBufferSource();
    this.clip.buffer = buffer;
    this.clip.connect(this.node!);
    this.clip.onended = () => this.events.onEnded?.();
    this.clip.start();
    return { contextSampleRate: ctx.sampleRate };
  }

  get seconds(): number {
    return this.bus?.seconds ?? 0;
  }

  /** Stops capture, drains the worklet and returns the full recording (16 kHz PCM16). */
  async stop(): Promise<Int16Array> {
    if (this.stopped) return new Int16Array(0);
    this.stopped = true;
    if (this.node) {
      const node = this.node;
      const drained = new Promise<void>((resolve) => {
        const prev = node.port.onmessage;
        node.port.onmessage = (e) => (e.data === "stopped" ? resolve() : prev?.call(node.port, e));
      });
      node.port.postMessage("stop");
      await Promise.race([drained, new Promise((r) => setTimeout(r, 300))]);
    }
    try {
      this.clip?.stop();
    } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    return this.bus?.close() ?? new Int16Array(0);
  }

  private async setupGraph(): Promise<AudioContext> {
    const moduleUrl = preloadWorklet();
    const ctx = new AudioContext();
    this.ctx = ctx;
    await Promise.all([ctx.resume(), moduleUrl.then((url) => ctx.audioWorklet.addModule(url))]);
    const node = new AudioWorkletNode(ctx, "pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    // Route to the destination (muted) so the graph is pulled and process() runs.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    this.node = node;
    this.bus = new AudioBus(ctx.sampleRate, this.events);
    node.port.onmessage = (e) => {
      if (e.data instanceof Float32Array) this.bus?.push(e.data);
    };
    return ctx;
  }
}

let workletUrl: Promise<string> | null = null;

/**
 * Loads the worklet source once into a Blob URL, so starting a recording doesn't wait
 * on a network round-trip between mic permission and capture (audio in that gap is lost).
 */
export function preloadWorklet(): Promise<string> {
  workletUrl ??= fetch("/worklets/pcm-capture.js")
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`worklet ${r.status}`))))
    .then((src) => URL.createObjectURL(new Blob([src], { type: "text/javascript" })))
    .catch(() => {
      workletUrl = null;
      return "/worklets/pcm-capture.js";
    });
  return workletUrl;
}

export async function decodeClip(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(data);
  } finally {
    void ctx.close();
  }
}

export function pcmToAudioBuffer(pcm: Int16Array, sampleRate = 16000): AudioBuffer {
  const buffer = new AudioBuffer({ length: Math.max(1, pcm.length), sampleRate, numberOfChannels: 1 });
  buffer.copyToChannel(pcm16ToFloat(pcm) as Float32Array<ArrayBuffer>, 0);
  return buffer;
}
