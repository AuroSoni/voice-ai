// Wire protocol of each streaming provider: how audio is framed, how the stream is
// finished, and how server messages map to transcript events. Pure and stateful per
// session, shared by the browser session and the smoke scripts.
import type { ModelDef } from "@/lib/models/types";

export type ProtocolEvent =
  | { type: "ready" }
  | { type: "partial"; key: string; text: string; mode: "replace" | "append" }
  | { type: "final"; key: string; text: string }
  /** Places segment `key` right after `after` (OpenAI commits can complete out of order). */
  | { type: "order"; key: string; after: string | null }
  | { type: "language"; code: string }
  | { type: "done" }
  | { type: "error"; message: string; fatal: boolean };

export interface StreamProtocol {
  /** Whether audio may be sent as soon as the socket opens, or only after a "ready" event. */
  readyOnOpen: boolean;
  audio(b64: string): string;
  /** Messages that end the stream; switches the protocol into finishing mode. */
  finish(): string[];
  parse(raw: string): ProtocolEvent[];
  /** After finishing, treat this much silence from the server as done (for providers without an explicit end). */
  quietMsAfterFinish: number;
}

type Json = Record<string, unknown>;

function parseJson(raw: string): Json | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Json) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function errorMessage(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Json;
    return str(o.message) ?? str(o.error) ?? JSON.stringify(o).slice(0, 300);
  }
  return "Unknown error";
}

/** Relay-level failures (bad key, upstream refused) are reported in-band by our relay. */
function relayError(msg: Json): ProtocolEvent | null {
  if (msg.event !== "relay_error") return null;
  const detail = str(msg.body) || str(msg.message) || "relay failed";
  return { type: "error", message: msg.status ? `${detail} (${msg.status})` : detail, fatal: true };
}

export function openaiProtocol(): StreamProtocol {
  let finishing = false;
  let committedAfterFinish = false;
  const pending = new Set<string>();
  return {
    readyOnOpen: true,
    quietMsAfterFinish: 0,
    audio: (b64) => JSON.stringify({ type: "input_audio_buffer.append", audio: b64 }),
    finish() {
      finishing = true;
      return [JSON.stringify({ type: "input_audio_buffer.commit" })];
    },
    parse(raw) {
      const msg = parseJson(raw);
      if (!msg) return [];
      const itemId = str(msg.item_id) ?? "item";
      switch (msg.type) {
        case "input_audio_buffer.committed":
          pending.add(itemId);
          if (finishing) committedAfterFinish = true;
          return [{ type: "order", key: itemId, after: str(msg.previous_item_id) ?? null }];
        case "conversation.item.input_audio_transcription.delta":
          return [{ type: "partial", key: itemId, text: str(msg.delta) ?? "", mode: "append" }];
        case "conversation.item.input_audio_transcription.completed": {
          pending.delete(itemId);
          const events: ProtocolEvent[] = [{ type: "final", key: itemId, text: str(msg.transcript) ?? "" }];
          const langs = msg.languages as { code?: string }[] | undefined;
          if (langs?.[0]?.code) events.push({ type: "language", code: langs[0].code });
          if (finishing && committedAfterFinish && pending.size === 0) events.push({ type: "done" });
          return events;
        }
        case "conversation.item.input_audio_transcription.failed":
          pending.delete(itemId);
          return [{ type: "error", message: errorMessage(msg.error), fatal: false }];
        case "error": {
          const err = (msg.error ?? {}) as Json;
          // Committing an empty buffer just means nothing was said after the last commit.
          if (finishing && String(err.code ?? "").includes("buffer") && String(err.message ?? "").match(/empty|small/i)) {
            return [{ type: "done" }];
          }
          return [{ type: "error", message: errorMessage(err), fatal: true }];
        }
        default:
          return [];
      }
    },
  };
}

export function geminiProtocol(): StreamProtocol {
  // Interim text is the running guess for the current utterance and replaces itself;
  // inputTranscription closes the utterance (sent when the speaker pauses or the
  // stream ends). generationComplete after audioStreamEnd means nothing more is coming.
  let segment = 0;
  let finishing = false;
  return {
    readyOnOpen: false,
    quietMsAfterFinish: 2500,
    audio: (b64) => JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: "audio/pcm;rate=16000" } } }),
    finish() {
      finishing = true;
      return [JSON.stringify({ realtimeInput: { audioStreamEnd: true } })];
    },
    parse(raw) {
      const msg = parseJson(raw);
      if (!msg) return [];
      if ("setupComplete" in msg) return [{ type: "ready" }];
      if (msg.error) return [{ type: "error", message: errorMessage(msg.error), fatal: true }];
      const content = msg.serverContent as Json | undefined;
      if (!content) return [];
      const events: ProtocolEvent[] = [];
      const interim = str((content.interimInputTranscription as Json | undefined)?.text);
      if (interim) events.push({ type: "partial", key: `g${segment}`, text: interim, mode: "replace" });
      const final = content.inputTranscription as Json | undefined;
      if (final && str(final.text)) {
        events.push({ type: "final", key: `g${segment}`, text: str(final.text)! });
        segment++;
        const code = str(final.languageCode);
        if (code) events.push({ type: "language", code });
      }
      if (finishing && (content.generationComplete || content.turnComplete)) events.push({ type: "done" });
      return events;
    },
  };
}

export function sarvamProtocol(): StreamProtocol {
  return {
    readyOnOpen: false,
    quietMsAfterFinish: 0,
    audio: (b64) => JSON.stringify({ event: "audio_input", audio: b64 }),
    finish: () => [JSON.stringify({ event: "end" })],
    parse(raw) {
      const msg = parseJson(raw);
      if (!msg) return [];
      const relay = relayError(msg);
      if (relay) return [relay];
      const data = ((msg.data as Json | undefined) ?? msg) as Json;
      const key = `u${data.utterance_idx ?? 0}`;
      switch (msg.event ?? msg.type) {
        case "session.begin":
          return [{ type: "ready" }];
        case "transcript.partial":
          return [{ type: "partial", key, text: str(data.text) ?? "", mode: "replace" }];
        case "transcript.final": {
          const events: ProtocolEvent[] = [{ type: "final", key, text: str(data.text) ?? "" }];
          const code = str(data.language) ?? str(data.language_code);
          if (code) events.push({ type: "language", code });
          return events;
        }
        case "session.end":
          return [{ type: "done" }];
        case "error":
          return [{ type: "error", message: errorMessage(data), fatal: data.is_fatal !== false }];
        default:
          return [];
      }
    },
  };
}

const ELEVENLABS_ERRORS = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "rate_limited",
  "resource_exhausted",
  "input_error",
  "transcriber_error",
  "session_time_limit_exceeded",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
  "queue_overflow",
  "commit_throttled",
  "unaccepted_terms",
]);

export function elevenlabsProtocol(): StreamProtocol {
  let segment = 0;
  let finishing = false;
  return {
    readyOnOpen: false,
    quietMsAfterFinish: 2500,
    audio: (b64) =>
      JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: b64, commit: false, sample_rate: 16000 }),
    finish() {
      finishing = true;
      return [JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true, sample_rate: 16000 })];
    },
    parse(raw) {
      const msg = parseJson(raw);
      if (!msg) return [];
      const type = str(msg.message_type) ?? "";
      const key = `s${segment}`;
      if (type === "session_started") return [{ type: "ready" }];
      if (type === "partial_transcript") {
        const text = str(msg.text) ?? "";
        return text ? [{ type: "partial", key, text, mode: "replace" }] : [];
      }
      if (type === "committed_transcript_with_timestamps") {
        // Same text as committed_transcript; only this one carries the detected language.
        const code = str(msg.language_code);
        return code ? [{ type: "language", code }] : [];
      }
      if (type === "committed_transcript") {
        segment++;
        const events: ProtocolEvent[] = [];
        const text = str(msg.text) ?? "";
        if (text) events.push({ type: "final", key, text });
        if (finishing) events.push({ type: "done" });
        return events;
      }
      if (ELEVENLABS_ERRORS.has(type)) {
        // Too little speech after the final commit is not a failure.
        if (finishing && type === "insufficient_audio_activity") return [{ type: "done" }];
        return [{ type: "error", message: str(msg.error) ?? str(msg.message) ?? type, fatal: type !== "commit_throttled" }];
      }
      return [];
    },
  };
}

export function protocolFor(model: ModelDef): StreamProtocol {
  switch (model.provider) {
    case "openai":
      return openaiProtocol();
    case "gemini":
      return geminiProtocol();
    case "sarvam":
      return sarvamProtocol();
    case "elevenlabs":
      return elevenlabsProtocol();
  }
}
