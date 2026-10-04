// Client-safe: no SDKs, no secrets. Adding a model is one entry here plus its adapter.
import type { ModelDef, ModelOptions, ProviderDef, ProviderId } from "./types";

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  sarvam: { id: "sarvam", label: "Sarvam", envVar: "SARVAM_API_KEY" },
  gemini: { id: "gemini", label: "Gemini", envVar: "GEMINI_API_KEY" },
  openai: { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  elevenlabs: { id: "elevenlabs", label: "ElevenLabs", envVar: "ELEVENLABS_API_KEY" },
};

const SARVAM_MODE = {
  key: "mode",
  label: "Mode",
  default: "transcribe",
  choices: [
    { value: "transcribe", label: "Transcribe" },
    { value: "verbatim", label: "Verbatim" },
    { value: "codemix", label: "Code-mix" },
    { value: "translit", label: "Transliterate (Roman)" },
    { value: "translate", label: "Translate → English" },
  ],
};

const OPENAI_DELAY = {
  key: "delay",
  label: "Delay",
  default: "low",
  choices: ["minimal", "low", "medium", "high"].map((v) => ({ value: v, label: v })),
};

export const MODELS: ModelDef[] = [
  {
    id: "sarvam/saaras-v3-realtime",
    provider: "sarvam",
    label: "Saaras v3 Realtime",
    upstreamModel: "saaras:v3-realtime",
    transport: "ws-relay",
    sampleRate: 16000,
    options: [SARVAM_MODE],
  },
  {
    id: "sarvam/saaras-v4-realtime",
    provider: "sarvam",
    label: "Saaras v4 Realtime",
    upstreamModel: "saaras:v4",
    transport: "ws-relay",
    sampleRate: 16000,
    options: [SARVAM_MODE],
  },
  {
    id: "sarvam/saaras-v4",
    provider: "sarvam",
    label: "Saaras v4",
    upstreamModel: "saaras:v4",
    transport: "rest",
    options: [SARVAM_MODE],
    note: "REST is capped at 30s, so longer audio is sent as ≤29s pieces.",
  },
  {
    id: "gemini/transcribe-live",
    provider: "gemini",
    label: "Gemini 3.5 Transcribe Live",
    upstreamModel: "gemini-3.5-transcribe-live",
    transport: "ws-direct",
    sampleRate: 16000,
  },
  {
    id: "gemini/transcribe",
    provider: "gemini",
    label: "Gemini 3.5 Transcribe",
    upstreamModel: "gemini-3.5-transcribe",
    transport: "rest",
  },
  {
    id: "gemini/3.8-flash",
    provider: "gemini",
    label: "Gemini 3.8 Flash (prompted)",
    upstreamModel: "gemini-3.8-flash",
    transport: "rest-stream",
    promptable: true,
    note: "General LLM asked to transcribe; temperature 0, low thinking.",
  },
  {
    id: "gemini/3.1-pro",
    provider: "gemini",
    label: "Gemini 3.1 Pro (prompted)",
    upstreamModel: "gemini-3.1-pro-preview",
    transport: "rest-stream",
    promptable: true,
    note: "General LLM asked to transcribe; temperature 0, low thinking.",
  },
  {
    id: "openai/gpt-live-transcribe",
    provider: "openai",
    label: "GPT Live Transcribe",
    upstreamModel: "gpt-live-transcribe",
    transport: "ws-direct",
    sampleRate: 24000,
    promptable: true,
    options: [OPENAI_DELAY],
  },
  {
    id: "openai/gpt-realtime-whisper",
    provider: "openai",
    label: "GPT Realtime Whisper",
    upstreamModel: "gpt-realtime-whisper",
    transport: "ws-direct",
    sampleRate: 24000,
    promptable: true,
  },
  {
    id: "openai/gpt-transcribe",
    provider: "openai",
    label: "GPT Transcribe",
    upstreamModel: "gpt-transcribe",
    transport: "rest-stream",
  },
  {
    id: "elevenlabs/scribe-v2-realtime",
    provider: "elevenlabs",
    label: "Scribe v2 Realtime",
    upstreamModel: "scribe_v2_realtime",
    transport: "ws-direct",
    sampleRate: 16000,
  },
  {
    id: "elevenlabs/scribe-v2",
    provider: "elevenlabs",
    label: "Scribe v2",
    upstreamModel: "scribe_v2",
    transport: "rest",
  },
];

export const MODELS_BY_ID: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelDef | undefined {
  return MODELS_BY_ID[id];
}

export function isStreaming(model: ModelDef): boolean {
  return model.transport === "ws-direct" || model.transport === "ws-relay";
}

/** Fills defaults and drops unknown keys or values, so options are safe to forward upstream. */
export function resolveOptions(model: ModelDef, input: ModelOptions | undefined): ModelOptions {
  const out: ModelOptions = {};
  for (const opt of model.options ?? []) {
    const value = input?.[opt.key];
    out[opt.key] = opt.choices.some((c) => c.value === value) ? (value as string) : opt.default;
  }
  return out;
}

export const MAX_MODELS_PER_RUN = MODELS.length;
