export type ProviderId = "sarvam" | "gemini" | "openai" | "elevenlabs";

/**
 * How a model is reached, in order of preference:
 * - ws-direct: browser opens the provider's WebSocket with a short-lived token from /api/realtime-token
 * - ws-relay: browser opens our own WebSocket relay, which holds the key (providers without temporary tokens)
 * - rest-stream: recording is uploaded after Stop; the transcript streams back
 * - rest: recording is uploaded after Stop; the transcript arrives in one piece
 */
export type Transport = "ws-direct" | "ws-relay" | "rest-stream" | "rest";

export type LanguageId = "auto" | "en" | "hi" | "gu" | "mr" | "mwr";

export interface ModelOptionDef {
  key: string;
  label: string;
  choices: { value: string; label: string }[];
  default: string;
}

export interface ModelDef {
  /** Stable id used in URLs, storage and fixtures, e.g. "sarvam/saaras-v3-realtime". */
  id: string;
  provider: ProviderId;
  label: string;
  upstreamModel: string;
  transport: Transport;
  /** PCM16 sample rate the streaming socket expects. */
  sampleRate?: 16000 | 24000;
  /** Accepts a free-text prompt, so dialects without a language code (Marwari) get a hint. */
  promptable?: boolean;
  options?: ModelOptionDef[];
  note?: string;
}

export type ModelOptions = Record<string, string>;

export interface ProviderDef {
  id: ProviderId;
  label: string;
  envVar: string;
}
