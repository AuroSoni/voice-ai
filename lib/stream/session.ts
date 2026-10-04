// One streaming model's socket for one run: gets credentials, connects, buffers audio
// until the provider is ready (so the first words aren't lost), and on finish waits for
// the final transcript before closing.
import type { StreamRate } from "@/lib/audio/bus";
import type { LanguageId, ModelDef, ModelOptions } from "@/lib/models/types";
import { protocolFor, type ProtocolEvent, type StreamProtocol } from "./protocols";

export type SessionErrorKind = "token" | "connect" | "relay-unavailable" | "upstream" | "timeout";

export interface SessionCallbacks {
  onConnecting(languageSent: string): void;
  onReady(connectMs: number): void;
  onEvent(e: ProtocolEvent, atMs: number): void;
  onRaw(data: string): void;
  onError(kind: SessionErrorKind, message: string): void;
  onDone(): void;
}

const READY_FALLBACK_MS = 5000;
const FINISH_TIMEOUT_MS = 15000;
const MAX_QUEUE = 700; // 70s of 100ms chunks

export class WsSession {
  readonly rate: StreamRate;
  private readonly proto: StreamProtocol;
  private ws?: WebSocket;
  private queue: string[] = [];
  private ready = false;
  private opened = false;
  private finishing = false;
  private ended = false;
  private failed = false;
  private lastMessageAt = 0;
  private startedAt = 0;
  private doneWaiters: (() => void)[] = [];
  private readyWaiters: (() => void)[] = [];
  private readonly decoder = new TextDecoder();

  constructor(
    readonly model: ModelDef,
    private readonly language: LanguageId,
    private readonly options: ModelOptions,
    private readonly cb: SessionCallbacks,
  ) {
    this.rate = model.sampleRate ?? 16000;
    this.proto = protocolFor(model);
  }

  async connect(signal: AbortSignal): Promise<void> {
    this.startedAt = performance.now();
    let conn: { url: string; protocols: string[]; initMessages: string[]; languageSent: string };
    try {
      const res = await fetch("/api/realtime-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: this.model.id, language: this.language, options: this.options }),
        signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      conn = body;
    } catch (err) {
      if (signal.aborted) return;
      return this.fail("token", err instanceof Error ? err.message : String(err));
    }
    if (signal.aborted || this.ended) return;

    this.cb.onConnecting(conn.languageSent);
    const relay = conn.url.startsWith("/");
    const url = relay ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${conn.url}` : conn.url;
    const ws = new WebSocket(url, conn.protocols);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.opened = true;
      for (const m of conn.initMessages) ws.send(m);
      if (this.proto.readyOnOpen) this.markReady();
      else setTimeout(() => this.markReady(), READY_FALLBACK_MS);
    };
    ws.onmessage = (e) => {
      const text = typeof e.data === "string" ? e.data : this.decoder.decode(e.data as ArrayBuffer);
      this.lastMessageAt = performance.now();
      this.cb.onRaw(text);
      for (const ev of this.proto.parse(text)) this.handle(ev);
    };
    ws.onclose = (e) => {
      if (this.ended) return;
      if (this.finishing) return this.complete();
      if (!this.opened) {
        return this.fail(
          relay ? "relay-unavailable" : "connect",
          relay ? "Couldn't open the relay. Locally, run the app with `vercel dev`." : `Couldn't connect (${e.code})`,
        );
      }
      this.fail("upstream", `Connection closed (${e.code}${e.reason ? `: ${e.reason}` : ""})`);
    };
  }

  push(b64: string) {
    if (this.ended || this.failed) return;
    const msg = this.proto.audio(b64);
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(msg);
    else if (this.queue.length < MAX_QUEUE) this.queue.push(msg);
  }

  /** Ends the audio stream and resolves once the final transcript is in (or it times out). */
  async finish(): Promise<void> {
    if (this.ended || this.failed) return;
    if (!this.ready) await this.waitReady(READY_FALLBACK_MS + 3000);
    if (this.ended || this.failed) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return this.fail("connect", "Socket never opened");
    this.flushQueue();
    this.finishing = true;
    const finishAt = performance.now();
    for (const m of this.proto.finish()) this.ws.send(m);

    const quiet = this.proto.quietMsAfterFinish;
    const timer = setInterval(() => {
      const idle = performance.now() - Math.max(this.lastMessageAt, finishAt);
      if (quiet && idle > quiet) this.complete();
      else if (performance.now() - finishAt > FINISH_TIMEOUT_MS) this.fail("timeout", "No final transcript within 15s");
    }, 200);
    await new Promise<void>((resolve) => this.doneWaiters.push(resolve));
    clearInterval(timer);
  }

  abort() {
    this.ended = true;
    this.ws?.close();
    this.release();
  }

  private handle(ev: ProtocolEvent) {
    if (ev.type === "ready") return this.markReady();
    if (ev.type === "done") return this.complete();
    if (ev.type === "error") {
      if (ev.fatal) return this.fail("upstream", ev.message);
      return this.cb.onEvent(ev, performance.now() - this.startedAt);
    }
    this.cb.onEvent(ev, performance.now() - this.startedAt);
  }

  private markReady() {
    if (this.ready || this.ended || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ready = true;
    this.cb.onReady(performance.now() - this.startedAt);
    this.flushQueue();
    this.readyWaiters.splice(0).forEach((r) => r());
  }

  private flushQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    for (const m of this.queue) this.ws.send(m);
    this.queue = [];
  }

  private waitReady(ms: number) {
    return new Promise<void>((resolve) => {
      this.readyWaiters.push(resolve);
      setTimeout(resolve, ms);
    });
  }

  private complete() {
    if (this.ended) return;
    this.ended = true;
    this.cb.onDone();
    this.ws?.close(1000);
    this.release();
  }

  private fail(kind: SessionErrorKind, message: string) {
    if (this.ended) return;
    this.failed = true;
    this.ended = true;
    this.cb.onError(kind, message);
    this.ws?.close();
    this.release();
  }

  private release() {
    this.doneWaiters.splice(0).forEach((r) => r());
    this.readyWaiters.splice(0).forEach((r) => r());
  }
}
