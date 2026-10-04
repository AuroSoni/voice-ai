import "server-only";
// Builds what the browser needs to open a streaming session: URL, subprotocols and the
// first messages to send. Keys never leave the server; providers with temporary tokens
// get one locked to the registry's model and config, and Sarvam (no temporary tokens)
// gets a URL on our own relay.
import { resolveLanguage } from "@/lib/languages";
import type { LanguageId, ModelDef, ModelOptions } from "@/lib/models/types";
import { ensureOk } from "./upstream-error";
import { httpBase, wsBase } from "./upstreams";

export interface StreamConnection {
  /** Absolute wss:// URL, or a path on this app (the relay) the browser resolves against its origin. */
  url: string;
  protocols: string[];
  initMessages: string[];
  languageSent: string;
}

export interface MintContext {
  key: string;
  fetch?: typeof fetch;
}

// Both v1alpha and v1beta mint working tokens (verified 2026-10-04); v1beta is the documented one.
export const GEMINI_TOKEN_API_VERSION = "v1beta";

export async function mintConnection(
  model: ModelDef,
  language: LanguageId,
  options: ModelOptions,
  ctx: MintContext,
): Promise<StreamConnection> {
  const lang = resolveLanguage(model, language);
  const doFetch = ctx.fetch ?? fetch;

  switch (model.provider) {
    case "sarvam": {
      // The relay re-validates these against the registry before building the upstream URL.
      const params = new URLSearchParams({ modelId: model.id, language, mode: options.mode ?? "transcribe" });
      return { url: `/api/relay/sarvam?${params}`, protocols: [], initMessages: [], languageSent: lang.sentLabel };
    }

    case "openai": {
      const transcription: Record<string, unknown> = { model: model.upstreamModel };
      if (lang.code) transcription.language = lang.code;
      if (lang.prompt) transcription.prompt = lang.prompt;
      if (options.delay) transcription.delay = options.delay;
      const res = await doFetch(`${httpBase("openai")}/v1/realtime/client_secrets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: 120 },
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                transcription,
                turn_detection: null,
              },
            },
          },
        }),
      });
      const { value } = (await (await ensureOk(res, "openai")).json()) as { value: string };
      return {
        url: `${wsBase("openai")}/v1/realtime?intent=transcription`,
        protocols: ["realtime", `openai-insecure-api-key.${value}`],
        initMessages: [],
        languageSent: lang.sentLabel,
      };
    }

    case "gemini": {
      const setup = {
        model: `models/${model.upstreamModel}`,
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription: { languageCodes: lang.code ? [lang.code] : [] },
      };
      const now = Date.now();
      const res = await doFetch(`${httpBase("gemini")}/${GEMINI_TOKEN_API_VERSION}/auth_tokens`, {
        method: "POST",
        headers: { "x-goog-api-key": ctx.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(now + 5 * 60_000).toISOString(),
          newSessionExpireTime: new Date(now + 60_000).toISOString(),
          // No fieldMask: every setup field is locked to these values.
          bidiGenerateContentSetup: setup,
        }),
      });
      const { name } = (await (await ensureOk(res, "gemini")).json()) as { name: string };
      return {
        url: `${wsBase("gemini")}/ws/google.ai.generativelanguage.${GEMINI_TOKEN_API_VERSION}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(name)}`,
        protocols: [],
        initMessages: [JSON.stringify({ setup })],
        languageSent: lang.sentLabel,
      };
    }

    case "elevenlabs": {
      const res = await doFetch(`${httpBase("elevenlabs")}/v1/single-use-token/realtime_scribe`, {
        method: "POST",
        headers: { "xi-api-key": ctx.key },
      });
      const { token } = (await (await ensureOk(res, "elevenlabs")).json()) as { token: string };
      const params = new URLSearchParams({
        model_id: model.upstreamModel,
        token,
        audio_format: "pcm_16000",
        commit_strategy: "vad",
        include_language_detection: "true",
      });
      if (lang.code) params.set("language_code", lang.code);
      return {
        url: `${wsBase("elevenlabs")}/v1/speech-to-text/realtime?${params}`,
        protocols: [],
        initMessages: [],
        languageSent: lang.sentLabel,
      };
    }
  }
}

/** Query string for the Sarvam realtime socket; shared by the token route and the relay. */
export function sarvamParams(model: ModelDef, language: LanguageId, options: ModelOptions): URLSearchParams {
  const lang = resolveLanguage(model, language);
  return new URLSearchParams({
    model: model.upstreamModel,
    language_code: lang.code ?? "auto",
    mode: options.mode ?? "transcribe",
    sample_rate: "16000",
  });
}

export function sarvamUpstreamUrl(params: URLSearchParams): string {
  return `${wsBase("sarvam")}/speech-to-text-realtime/ws?${params}`;
}
