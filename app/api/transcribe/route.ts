// One upload for every REST model in a run: the server fans out to the providers
// concurrently and streams back NDJSON lines tagged with modelId, so upload time is
// paid once and per-model latency stays comparable.
import { MAX_RECORDING_SECONDS } from "@/lib/audio/bus";
import { parseWav } from "@/lib/audio/wav";
import { guardApi } from "@/lib/auth/guard";
import { isLanguageId, resolveLanguage } from "@/lib/languages";
import { getModel, isStreaming, MAX_MODELS_PER_RUN, resolveOptions } from "@/lib/models/registry";
import type { ModelDef } from "@/lib/models/types";
import { providerKey } from "@/lib/server/env";
import { restAdapterFor } from "@/lib/server/rest";
import { UpstreamError } from "@/lib/server/upstream-error";
import { ndjsonLine } from "@/lib/stream/ndjson";
import type { TranscribeLine } from "@/lib/stream/transcribe-lines";

export const maxDuration = 120;

const MAX_WAV_BYTES = 44 + 16000 * 2 * (MAX_RECORDING_SECONDS + 1);

function bad(error: string, status = 400) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  if (!form) return bad("Expected multipart form data");
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return bad("Missing audio");
  if (audio.size > MAX_WAV_BYTES) return bad("Audio is longer than 60 seconds", 413);

  const language = form.get("language");
  if (!isLanguageId(language)) return bad("Unknown language");

  let modelIds: unknown;
  let optionsById: Record<string, Record<string, string>> = {};
  try {
    modelIds = JSON.parse(String(form.get("models") ?? "[]"));
    optionsById = JSON.parse(String(form.get("options") ?? "{}"));
  } catch {
    return bad("models/options must be JSON");
  }
  if (!Array.isArray(modelIds) || modelIds.length === 0 || modelIds.length > MAX_MODELS_PER_RUN) return bad("Bad model list");
  const models: ModelDef[] = [];
  for (const id of modelIds) {
    const m = typeof id === "string" ? getModel(id) : undefined;
    if (!m || isStreaming(m)) return bad(`Not a REST model: ${String(id)}`);
    models.push(m);
  }

  const wav = new Uint8Array(await audio.arrayBuffer());
  let pcm: Int16Array;
  try {
    const parsed = parseWav(wav);
    if (parsed.sampleRate !== 16000 || parsed.channels !== 1) return bad("Audio must be 16 kHz mono WAV");
    if (parsed.pcm.length > 16000 * (MAX_RECORDING_SECONDS + 1)) return bad("Audio is longer than 60 seconds", 413);
    pcm = parsed.pcm;
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Invalid WAV");
  }

  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: TranscribeLine) => {
        try {
          controller.enqueue(ndjsonLine(line));
        } catch {
          // client went away
        }
      };

      await Promise.all(
        models.map(async (model) => {
          send({ modelId: model.id, type: "accepted", languageSent: resolveLanguage(model, language).sentLabel });
          const key = providerKey(model.provider);
          if (!key) return send({ modelId: model.id, type: "error", message: "Provider not configured" });
          const t0 = Date.now();
          try {
            for await (const e of restAdapterFor(model)({
              model,
              wav,
              pcm,
              language,
              options: resolveOptions(model, optionsById[model.id]),
              key,
              signal: request.signal,
            })) {
              if (e.type === "delta") send({ modelId: model.id, type: "delta", text: e.text, t: Date.now() - t0 });
              else send({ modelId: model.id, type: "final", text: e.text, language: e.language, upstreamMs: Date.now() - t0, raw: e.raw });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!request.signal.aborted) console.error(`[transcribe] ${model.id}: ${message}`);
            send({ modelId: model.id, type: "error", message, status: err instanceof UpstreamError ? err.status : undefined });
          }
        }),
      );
      send({ type: "end" });
      console.log(`[transcribe] ${models.length} models in ${Date.now() - started}ms`);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
