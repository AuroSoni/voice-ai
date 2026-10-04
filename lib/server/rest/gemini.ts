import { bytesToBase64 } from "@/lib/audio/base64";
import { resolveLanguage, transcriptionPrompt } from "@/lib/languages";
import { sseData } from "../sse";
import { ensureOk } from "../upstream-error";
import { httpBase } from "../upstreams";
import type { RestAdapter, RestContext } from "./types";

interface Part {
  text?: string;
  thought?: boolean;
  /** Set by gemini-3.5-transcribe (audioTranscriptionConfig). */
  audioTranscription?: { text?: string; languageCode?: string };
}
interface GenerateResponse {
  candidates?: { content?: { parts?: Part[] } }[];
}

function headers(ctx: RestContext) {
  return { "x-goog-api-key": ctx.key, "Content-Type": "application/json" };
}

/** gemini-3.5-transcribe: the dedicated speech model, with language codes instead of a prompt. */
export const geminiTranscribeRest: RestAdapter = async function* (ctx) {
  const lang = resolveLanguage(ctx.model, ctx.language);
  const res = await (ctx.fetch ?? fetch)(
    `${httpBase("gemini")}/v1beta/models/${ctx.model.upstreamModel}:generateContent`,
    {
      method: "POST",
      headers: headers(ctx),
      signal: ctx.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: bytesToBase64(ctx.wav) } }] }],
        generationConfig: {
          audioTranscriptionConfig: { languageCodes: lang.code ? [lang.code] : [] },
        },
      }),
    },
  );
  const body = (await (await ensureOk(res, "gemini")).json()) as GenerateResponse;
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.audioTranscription?.text ?? (p.thought ? "" : p.text) ?? "")
    .join("")
    .trim();
  const language = parts.find((p) => p.audioTranscription?.languageCode)?.audioTranscription?.languageCode;
  yield { type: "final", text, language, raw: body };
};

/** General Gemini LLMs asked to transcribe; streams the answer as SSE. */
export const geminiPromptedRest: RestAdapter = async function* (ctx) {
  const res = await (ctx.fetch ?? fetch)(
    `${httpBase("gemini")}/v1beta/models/${ctx.model.upstreamModel}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: headers(ctx),
      signal: ctx.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: transcriptionPrompt(ctx.language) },
              { inlineData: { mimeType: "audio/wav", data: bytesToBase64(ctx.wav) } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          // Keep reasoning short so latency measures recognition, not thinking.
          // ("minimal" is rejected by gemini-3.8-flash; "low" works on Flash and Pro.)
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    },
  );
  await ensureOk(res, "gemini");

  let text = "";
  for await (const data of sseData(res.body!)) {
    const chunk = JSON.parse(data) as GenerateResponse;
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (part.thought || !part.text) continue;
      text += part.text;
      yield { type: "delta", text: part.text };
    }
  }
  yield { type: "final", text: text.trim() };
};
