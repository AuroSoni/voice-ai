// Every provider base URL lives here. Outside production and preview, STT_UPSTREAM_<PROVIDER>
// can point a provider at the local mock server used by the keyless E2E suite.
import type { ProviderId } from "@/lib/models/types";

const DEFAULTS: Record<ProviderId, string> = {
  sarvam: "https://api.sarvam.ai",
  gemini: "https://generativelanguage.googleapis.com",
  openai: "https://api.openai.com",
  elevenlabs: "https://api.elevenlabs.io",
};

export function overridesAllowed(): boolean {
  const env = process.env.VERCEL_ENV;
  return env !== "production" && env !== "preview";
}

/** HTTP(S) base for a provider, e.g. "https://api.sarvam.ai". */
export function httpBase(provider: ProviderId): string {
  const override = process.env[`STT_UPSTREAM_${provider.toUpperCase()}`];
  return (overridesAllowed() && override ? override : DEFAULTS[provider]).replace(/\/$/, "");
}

/** Matching WebSocket base, e.g. "wss://api.sarvam.ai". */
export function wsBase(provider: ProviderId): string {
  return httpBase(provider).replace(/^http/, "ws");
}
