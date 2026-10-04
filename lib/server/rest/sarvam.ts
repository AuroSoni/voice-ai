import { encodeWav, splitAtQuietPoints } from "@/lib/audio/wav";
import { resolveLanguage } from "@/lib/languages";
import { ensureOk } from "../upstream-error";
import { httpBase } from "../upstreams";
import { type RestAdapter, wavBlob } from "./types";

interface SarvamResponse {
  transcript?: string;
  language_code?: string | null;
}

// Sarvam REST rejects audio over 30s, so longer recordings go up as ≤29s pieces
// cut at quiet points, in parallel. Pieces are emitted in order as they complete.
export const sarvamRest: RestAdapter = async function* (ctx) {
  const lang = resolveLanguage(ctx.model, ctx.language);
  const pieces = splitAtQuietPoints(ctx.pcm, 16000);
  const doFetch = ctx.fetch ?? fetch;

  const requests = pieces.map(async (pcm) => {
    const form = new FormData();
    form.append("file", wavBlob(encodeWav(pcm, 16000)), "audio.wav");
    form.append("model", ctx.model.upstreamModel);
    form.append("mode", ctx.options.mode ?? "transcribe");
    form.append("language_code", lang.code ?? "unknown");
    const res = await doFetch(`${httpBase("sarvam")}/speech-to-text`, {
      method: "POST",
      headers: { "api-subscription-key": ctx.key },
      body: form,
      signal: ctx.signal,
    });
    return (await (await ensureOk(res, "sarvam")).json()) as SarvamResponse;
  });

  // Mark every request as handled now; failures surface when each is awaited in order.
  for (const r of requests) r.catch(() => {});

  const texts: string[] = [];
  let language: string | undefined;
  const raw: SarvamResponse[] = [];
  for (const [i, request] of requests.entries()) {
    const body = await request;
    raw.push(body);
    const text = (body.transcript ?? "").trim();
    language ??= body.language_code ?? undefined;
    texts.push(text);
    if (pieces.length > 1 && text) yield { type: "delta", text: (i > 0 ? " " : "") + text };
  }
  yield { type: "final", text: texts.filter(Boolean).join(" "), language, raw };
};
