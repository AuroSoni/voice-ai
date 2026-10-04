import { resolveLanguage } from "@/lib/languages";
import { ensureOk } from "../upstream-error";
import { httpBase } from "../upstreams";
import { type RestAdapter, wavBlob } from "./types";

export const elevenlabsRest: RestAdapter = async function* (ctx) {
  const lang = resolveLanguage(ctx.model, ctx.language);
  const form = new FormData();
  form.append("model_id", ctx.model.upstreamModel);
  form.append("file", wavBlob(ctx.wav), "audio.wav");
  form.append("tag_audio_events", "false");
  if (lang.code) form.append("language_code", lang.code);

  const res = await (ctx.fetch ?? fetch)(`${httpBase("elevenlabs")}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": ctx.key },
    body: form,
    signal: ctx.signal,
  });
  const body = (await (await ensureOk(res, "elevenlabs")).json()) as {
    text?: string;
    language_code?: string;
    language_probability?: number;
  };
  // Word timings are dropped from `raw` to keep the card's raw view readable.
  const raw = { text: body.text, language_code: body.language_code, language_probability: body.language_probability };
  yield { type: "final", text: (body.text ?? "").trim(), language: body.language_code, raw };
};
