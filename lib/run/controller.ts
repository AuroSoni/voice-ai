// Orchestrates one run: audio source → streaming sessions (live) and, after Stop, a
// single upload for the REST models. Every update is tagged with the run id so a new run
// (or re-run) can start while stragglers from the old one are ignored.
import { AudioEngine, decodeClip, pcmToAudioBuffer, type MicSettings } from "@/lib/audio/engine";
import { MAX_RECORDING_SECONDS } from "@/lib/audio/bus";
import { encodeWav } from "@/lib/audio/wav";
import { resolveLanguage } from "@/lib/languages";
import { getModel, isStreaming, resolveOptions } from "@/lib/models/registry";
import type { LanguageId, ModelDef, ModelOptions } from "@/lib/models/types";
import { readNdjson } from "@/lib/stream/ndjson";
import { WsSession } from "@/lib/stream/session";
import type { TranscribeLine } from "@/lib/stream/transcribe-lines";
import { applyEvent, fullText } from "@/lib/stream/transcript";
import { RAW_LIMIT, type CardState, type RunSource, type RunStore } from "./store";

export interface RunRequest {
  modelIds: string[];
  language: LanguageId;
  options: Record<string, ModelOptions>;
  mic: MicSettings;
}

const pushRaw = (raw: unknown[], item: unknown) => (raw.length >= RAW_LIMIT ? [...raw.slice(1), item] : [...raw, item]);

export class RunController {
  private engine?: AudioEngine;
  private sessions: WsSession[] = [];
  private abort = new AbortController();
  private request?: RunRequest;
  private recordStart = 0;
  private stopAt = 0;
  private stopping = false;
  private lastPcm?: Int16Array;
  private recordingUrl?: string;

  constructor(private readonly store: RunStore) {}

  get hasRecording() {
    return Boolean(this.lastPcm?.length);
  }

  async startMic(req: RunRequest) {
    await this.start(req, "mic", (engine) => engine.startMic(req.mic));
  }

  async startClip(req: RunRequest, file: File) {
    let buffer: AudioBuffer;
    try {
      buffer = await decodeClip(await file.arrayBuffer());
    } catch {
      this.store.set((s) => ({ ...s, error: "Couldn't decode that file. Try WAV, MP3, M4A, OGG or WebM." }));
      return;
    }
    if (buffer.duration > MAX_RECORDING_SECONDS + 0.5) {
      this.store.set((s) => ({ ...s, error: `That clip is ${buffer.duration.toFixed(1)}s; the limit is ${MAX_RECORDING_SECONDS}s.` }));
      return;
    }
    await this.start(req, "clip", (engine) => engine.startClip(buffer));
  }

  async rerun(req: RunRequest) {
    if (!this.lastPcm) return;
    const buffer = pcmToAudioBuffer(this.lastPcm);
    await this.start(req, "rerun", (engine) => engine.startClip(buffer));
  }

  /** Stop pressed, cap reached, or clip finished. */
  async stop() {
    const s = this.store.get();
    if (s.phase !== "recording" || this.stopping) return;
    this.stopping = true;
    const runId = s.runId;
    this.stopAt = performance.now();
    const pcm = (await this.engine?.stop()) ?? new Int16Array(0);
    this.engine = undefined;
    if (this.store.get().runId !== runId) return;

    this.lastPcm = pcm;
    const wav = encodeWav(pcm, 16000);
    if (this.recordingUrl) URL.revokeObjectURL(this.recordingUrl);
    this.recordingUrl = URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" }));
    this.store.set((st) => ({
      ...st,
      phase: "finalizing",
      recording: { url: this.recordingUrl!, durationSec: pcm.length / 16000 },
    }));

    const noSpeech = this.store.get().speechAt === null;
    const restModels = this.request!.modelIds.map((id) => getModel(id)!).filter((m) => !isStreaming(m));
    await Promise.all([
      ...this.sessions.map((session) => session.finish()),
      restModels.length ? this.runRest(runId, wav, restModels) : Promise.resolve(),
    ]);
    if (this.store.get().runId !== runId) return;

    this.store.set((st) => {
      const cards = { ...st.cards };
      for (const id of st.order) {
        const c = cards[id];
        if (c.status !== "error" && c.status !== "done") cards[id] = { ...c, status: "done" };
        if (noSpeech && cards[id].status === "done" && !fullText(cards[id].segments)) {
          cards[id] = { ...cards[id], warning: "No speech was detected in the recording." };
        }
      }
      return { ...st, phase: "done", cards };
    });
    this.sessions = [];
    this.stopping = false;
  }

  /** Cancels whatever is running (used before a new run and on unmount). */
  cancel() {
    this.abort.abort();
    this.sessions.forEach((s) => s.abort());
    this.sessions = [];
    void this.engine?.stop();
    this.engine = undefined;
    this.stopping = false;
  }

  private async start(req: RunRequest, source: RunSource, begin: (engine: AudioEngine) => Promise<{ contextSampleRate: number; track?: MediaTrackSettings }>) {
    this.cancel();
    this.abort = new AbortController();
    this.request = req;
    this.recordStart = 0;
    this.stopAt = 0;
    const runId = this.store.get().runId + 1;
    const models = req.modelIds.map((id) => getModel(id)).filter((m): m is ModelDef => Boolean(m));

    const cards: Record<string, CardState> = {};
    for (const m of models) {
      cards[m.id] = {
        modelId: m.id,
        status: isStreaming(m) ? "connecting" : "queued",
        segments: [],
        languageSent: resolveLanguage(m, req.language).sentLabel,
        metrics: {},
        raw: [],
      };
    }
    this.store.set((s) => ({
      ...s,
      runId,
      phase: "starting",
      source,
      elapsed: 0,
      level: 0,
      speechAt: null,
      order: models.map((m) => m.id),
      cards,
      error: undefined,
    }));

    // Open sockets while the mic permission prompt is up.
    this.sessions = models.filter(isStreaming).map((m) => this.createSession(runId, m, req));
    const signal = this.abort.signal;
    this.sessions.forEach((s) => void s.connect(signal));

    this.engine = new AudioEngine({
      onChunk: (chunk) => {
        for (const s of this.sessions) if (s.rate === chunk.rate) s.push(chunk.b64);
      },
      onLevel: (level) => {
        if (this.store.get().runId !== runId) return;
        this.store.set((s) => ({ ...s, level, elapsed: this.engine?.seconds ?? s.elapsed }));
      },
      onSpeechStart: (at) => this.store.set((s) => (s.runId === runId ? { ...s, speechAt: at } : s)),
      onLimit: () => void this.stop(),
      onEnded: () => void this.stop(),
    });

    try {
      const capture = await begin(this.engine);
      if (this.store.get().runId !== runId) return;
      this.recordStart = performance.now();
      this.store.set((s) => ({ ...s, phase: "recording", capture }));
    } catch (err) {
      this.cancel();
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the browser's site settings and try again."
          : err instanceof DOMException && err.name === "NotFoundError"
            ? "No microphone was found."
            : err instanceof Error
              ? err.message
              : String(err);
      this.store.set((s) => ({ ...s, phase: "idle", error: message, order: [], cards: {} }));
    }
  }

  private createSession(runId: number, model: ModelDef, req: RunRequest): WsSession {
    const update = (fn: (c: CardState) => CardState) => this.store.card(runId, model.id, fn);
    return new WsSession(model, req.language, resolveOptions(model, req.options[model.id]), {
      onConnecting: (languageSent) => update((c) => ({ ...c, languageSent })),
      onReady: (connectMs) =>
        update((c) => ({ ...c, status: c.status === "connecting" ? "listening" : c.status, metrics: { ...c.metrics, connectMs } })),
      onRaw: (data) => update((c) => ({ ...c, raw: pushRaw(c.raw, safeJson(data)) })),
      onEvent: (e) =>
        update((c) => {
          if (e.type === "language") return { ...c, detectedLanguage: e.code };
          if (e.type === "error") return { ...c, warning: e.message };
          const segments = applyEvent(c.segments, e);
          const metrics = { ...c.metrics };
          const hasText = (e.type === "partial" || e.type === "final") && e.text.trim();
          if (hasText && metrics.firstTextMs === undefined && this.recordStart) {
            const speechAt = this.store.get().speechAt;
            metrics.firstTextMs = Math.max(0, performance.now() - this.recordStart - (speechAt ?? 0) * 1000);
          }
          if (hasText && this.stopAt) metrics.finalizeMs = Math.max(0, performance.now() - this.stopAt);
          return { ...c, segments, metrics, status: this.stopAt && c.status === "listening" ? "finalizing" : c.status };
        }),
      onError: (kind, message) => update((c) => ({ ...c, status: "error", error: { kind, message } })),
      onDone: () => update((c) => ({ ...c, status: "done" })),
    });
  }

  private async runRest(runId: number, wav: Uint8Array, models: ModelDef[]) {
    const req = this.request!;
    const update = (id: string, fn: (c: CardState) => CardState) => this.store.card(runId, id, fn);
    for (const m of models) update(m.id, (c) => ({ ...c, status: "transcribing" }));

    const form = new FormData();
    form.append("audio", new Blob([wav as BlobPart], { type: "audio/wav" }), "recording.wav");
    form.append("models", JSON.stringify(models.map((m) => m.id)));
    form.append("language", req.language);
    form.append("options", JSON.stringify(Object.fromEntries(models.map((m) => [m.id, resolveOptions(m, req.options[m.id])]))));

    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form, signal: this.abort.signal });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await readNdjson<TranscribeLine>(res.body, (line) => {
        if (line.type === "end") return;
        update(line.modelId, (c) => {
          const raw = pushRaw(c.raw, line);
          switch (line.type) {
            case "accepted":
              return { ...c, raw, languageSent: line.languageSent };
            case "delta": {
              const segments = applyEvent(c.segments, { type: "partial", key: "rest", text: line.text, mode: "append" });
              const metrics = { ...c.metrics, firstTextMs: c.metrics.firstTextMs ?? performance.now() - this.stopAt };
              return { ...c, raw, segments, metrics };
            }
            case "final":
              return {
                ...c,
                raw,
                status: "done",
                segments: applyEvent(c.segments, { type: "final", key: "rest", text: line.text }),
                detectedLanguage: line.language ?? c.detectedLanguage,
                metrics: { ...c.metrics, upstreamMs: line.upstreamMs, finalizeMs: performance.now() - this.stopAt },
              };
            case "error":
              return { ...c, raw, status: "error", error: { kind: "upstream", message: line.message } };
          }
        });
      });
    } catch (err) {
      if (this.abort.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      for (const m of models) {
        update(m.id, (c) => (c.status === "done" ? c : { ...c, status: "error", error: { kind: "upstream", message } }));
      }
    }
  }
}

function safeJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
