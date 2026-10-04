import { resolveLanguage } from "@/lib/languages";
import { sseData } from "../sse";
import { ensureOk } from "../upstream-error";
import { httpBase } from "../upstreams";
import { type RestAdapter, wavBlob } from "./types";

// gpt-transcribe with stream=true: transcript.text.delta events, then transcript.text.done.
export const openaiRest: RestAdapter = async function* (ctx) {
  const lang = resolveLanguage(ctx.model, ctx.language);
  const form = new FormData();
  form.append("file", wavBlob(ctx.wav), "audio.wav");
  form.append("model", ctx.model.upstreamModel);
  form.append("stream", "true");
  if (lang.code) form.append("language", lang.code);
  if (lang.prompt) form.append("prompt", lang.prompt);

  const res = await (ctx.fetch ?? fetch)(`${httpBase("openai")}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.key}` },
    body: form,
    signal: ctx.signal,
  });
  await ensureOk(res, "openai");

  let text = "";
  for await (const data of sseData(res.body!)) {
    if (data === "[DONE]") break;
    const event = JSON.parse(data) as { type: string; delta?: string; text?: string };
    if (event.type === "transcript.text.delta" && event.delta) {
      text += event.delta;
      yield { type: "delta", text: event.delta };
    } else if (event.type === "transcript.text.done") {
      text = event.text ?? text;
    }
  }
  yield { type: "final", text };
};
