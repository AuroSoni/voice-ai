// External store for the current run. Partials arrive at 10–50 Hz per model, so
// subscribers are notified at most once per animation frame.
import type { Segment } from "@/lib/stream/transcript";

export type CardStatus = "queued" | "connecting" | "listening" | "finalizing" | "transcribing" | "done" | "error";

export type CardErrorKind =
  | "not-configured"
  | "token"
  | "connect"
  | "relay-unavailable"
  | "upstream"
  | "timeout"
  | "no-speech"
  | "cancelled";

export interface CardMetrics {
  /** Token + socket handshake, from Start. */
  connectMs?: number;
  /** First partial text, measured from when speech started. */
  firstTextMs?: number;
  /** Stop → last transcript message (streaming) or final response (REST, end to end). */
  finalizeMs?: number;
  /** Time the provider itself took (REST, measured on the server). */
  upstreamMs?: number;
}

export interface CardState {
  modelId: string;
  status: CardStatus;
  segments: Segment[];
  languageSent?: string;
  detectedLanguage?: string;
  error?: { kind: CardErrorKind; message: string };
  warning?: string;
  metrics: CardMetrics;
  raw: unknown[];
}

export type RunPhase = "idle" | "starting" | "recording" | "finalizing" | "done";
export type RunSource = "mic" | "clip" | "rerun";

export interface RunState {
  runId: number;
  phase: RunPhase;
  source: RunSource | null;
  elapsed: number;
  level: number;
  speechAt: number | null;
  order: string[];
  cards: Record<string, CardState>;
  recording?: { url: string; durationSec: number };
  error?: string;
  capture?: { contextSampleRate: number; track?: MediaTrackSettings };
}

export const RAW_LIMIT = 300;

export const initialRunState: RunState = {
  runId: 0,
  phase: "idle",
  source: null,
  elapsed: 0,
  level: 0,
  speechAt: null,
  order: [],
  cards: {},
};

export class RunStore {
  private state: RunState = initialRunState;
  private listeners = new Set<() => void>();
  private scheduled = false;

  getSnapshot = () => this.state;
  getServerSnapshot = () => initialRunState;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(): RunState {
    return this.state;
  }

  set(update: (s: RunState) => RunState) {
    this.state = update(this.state);
    this.schedule();
  }

  /** Updates one card if it still belongs to `runId` (late events from old runs are dropped). */
  card(runId: number, modelId: string, update: (c: CardState) => CardState) {
    if (this.state.runId !== runId) return;
    const current = this.state.cards[modelId];
    if (!current) return;
    this.state = { ...this.state, cards: { ...this.state.cards, [modelId]: update(current) } };
    this.schedule();
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    const flush = () => {
      this.scheduled = false;
      this.listeners.forEach((l) => l());
    };
    if (typeof requestAnimationFrame === "function" && document.visibilityState === "visible") requestAnimationFrame(flush);
    else setTimeout(flush, 50);
  }
}
