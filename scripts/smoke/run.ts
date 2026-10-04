/**
 * Talks to the real providers with the fixture clip, prints what comes back, and records the
 * raw upstream traffic to fixtures/upstream/ (replayed by unit tests and the keyless E2E mock).
 *
 *   npm run smoke -- all                 # every model, record fixtures (~4s audio each)
 *   npm run smoke -- openai/gpt-transcribe gemini/transcribe-live
 *   npm run smoke -- all --langs         # check each language code is accepted (1.5s audio each)
 *   npm run smoke -- all --no-record     # just print
 *
 * Costs real credits: keep runs rare.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { resample } from "@/lib/audio/resampler";
import { bytesToBase64 } from "@/lib/audio/base64";
import { floatToPcm16, pcm16Bytes, pcm16ToFloat } from "@/lib/audio/pcm";
import { encodeWav, parseWav } from "@/lib/audio/wav";
import { MODELS, PROVIDERS, getModel, isStreaming } from "@/lib/models/registry";
import type { LanguageId, ModelDef } from "@/lib/models/types";
import { protocolFor, type ProtocolEvent } from "@/lib/stream/protocols";
import { restAdapterFor } from "@/lib/server/rest";
import { mintConnection, sarvamParams, sarvamUpstreamUrl } from "@/lib/server/tokens";
import { fixtureName } from "@/lib/stream/fixtures";

const ROOT = join(import.meta.dirname, "../..");
const OUT = join(ROOT, "fixtures/upstream");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const ids = args.filter((a) => !a.startsWith("--"));
const record = !flags.has("--no-record") && !flags.has("--langs");
const models: ModelDef[] = ids.includes("all") || ids.length === 0 ? MODELS : ids.map((id) => {
  const m = getModel(id);
  if (!m) throw new Error(`Unknown model ${id}. Known: ${MODELS.map((x) => x.id).join(", ")}`);
  return m;
});

const clip = parseWav(readFileSync(join(ROOT, "fixtures/audio/hi-4s.wav")));
if (clip.sampleRate !== 16000) throw new Error("fixture must be 16 kHz");

function keyFor(model: ModelDef): string {
  const key = process.env[PROVIDERS[model.provider].envVar];
  if (!key) throw new Error(`${PROVIDERS[model.provider].envVar} is not set`);
  return key;
}

function chunksFor(pcm16k: Int16Array, rate: number): string[] {
  const pcm = rate === 16000 ? pcm16k : floatToPcm16(resample(pcm16ToFloat(pcm16k), 16000, rate));
  const size = rate / 10;
  const out: string[] = [];
  for (let i = 0; i < pcm.length; i += size) out.push(bytesToBase64(pcm16Bytes(pcm.slice(i, i + size))));
  return out;
}

interface Recorded {
  t: number;
  phase: "stream" | "finish";
  data: string;
}

async function runStreaming(model: ModelDef, language: LanguageId, pcm: Int16Array) {
  const key = keyFor(model);
  let url: string;
  let protocols: string[] = [];
  let initMessages: string[] = [];
  let headers: Record<string, string> | undefined;
  if (model.transport === "ws-relay") {
    url = sarvamUpstreamUrl(sarvamParams(model, language, { mode: "transcribe" }));
    headers = { "api-subscription-key": key };
  } else {
    const conn = await mintConnection(model, language, {}, { key });
    ({ url, protocols, initMessages } = conn);
  }

  const proto = protocolFor(model);
  const chunks = chunksFor(pcm, model.sampleRate!);
  const recorded: Recorded[] = [];
  const events: ProtocolEvent[] = [];
  let phase: Recorded["phase"] = "stream";
  let t0 = 0;
  let lastMessageAt = Date.now();

  const ws = new WebSocket(url, protocols, { headers });
  let ready = false;
  let readyResolve!: () => void;
  const readyPromise = new Promise<void>((r) => (readyResolve = r));
  let doneResolve!: () => void;
  const donePromise = new Promise<void>((r) => (doneResolve = r));
  let closeInfo = "";

  ws.on("unexpected-response", (_req, res) => {
    let body = "";
    res.on("data", (d) => (body += d));
    res.on("end", () => {
      events.push({ type: "error", message: `HTTP ${res.statusCode}: ${body.slice(0, 300)}`, fatal: true });
      readyResolve();
      doneResolve();
    });
  });
  ws.on("error", (err) => {
    events.push({ type: "error", message: String(err), fatal: true });
    readyResolve();
    doneResolve();
  });
  ws.on("open", () => {
    for (const m of initMessages) ws.send(m);
    if (proto.readyOnOpen) {
      ready = true;
      readyResolve();
    }
  });
  ws.on("message", (data, isBinary) => {
    const text = isBinary ? Buffer.from(data as Buffer).toString("utf8") : data.toString();
    lastMessageAt = Date.now();
    recorded.push({ t: t0 ? Date.now() - t0 : 0, phase, data: text });
    for (const e of proto.parse(text)) {
      events.push(e);
      if (e.type === "ready" && !ready) {
        ready = true;
        readyResolve();
      }
      if (e.type === "done" || (e.type === "error" && e.fatal)) doneResolve();
    }
  });
  ws.on("close", (code, reason) => {
    closeInfo = `${code} ${reason.toString()}`;
    readyResolve();
    doneResolve();
  });

  await Promise.race([readyPromise, sleep(8000)]);
  if (!ready && ws.readyState === WebSocket.OPEN) {
    ready = true; // some providers never send an explicit ready; go ahead
  }
  t0 = Date.now();
  for (const c of chunks) {
    if (ws.readyState !== WebSocket.OPEN) break;
    ws.send(proto.audio(c));
    await sleep(100);
  }
  if (ws.readyState === WebSocket.OPEN) {
    phase = "finish";
    for (const m of proto.finish()) ws.send(m);
  }
  const finishedAt = Date.now();
  await Promise.race([
    donePromise,
    sleep(20000),
    (async () => {
      if (!proto.quietMsAfterFinish) return new Promise(() => {});
      for (;;) {
        await sleep(100);
        if (Date.now() - Math.max(lastMessageAt, finishedAt) > proto.quietMsAfterFinish) return;
      }
    })(),
  ]);
  ws.close();
  await sleep(200);

  return { events, recorded, closeInfo, url: url.replace(/(token|access_token)=[^&]+/, "$1=<redacted>") };
}

async function runRest(model: ModelDef, language: LanguageId, pcm: Int16Array) {
  const key = keyFor(model);
  const responses: { status: number; contentType: string; body: string }[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const body = await res.text();
    responses.push({ status: res.status, contentType: res.headers.get("content-type") ?? "", body });
    return new Response(body, { status: res.status, headers: res.headers });
  };
  const events: unknown[] = [];
  try {
    for await (const e of restAdapterFor(model)({
      model,
      wav: encodeWav(pcm, 16000),
      pcm,
      language,
      options: { mode: "transcribe" },
      key,
      fetch: recordingFetch,
    })) {
      events.push(e);
    }
  } catch (err) {
    events.push({ type: "error", message: String(err) });
  }
  return { events, responses };
}

function summarize(events: { type: string; text?: string; message?: string }[]): string {
  const err = events.find((e) => e.type === "error");
  const finals = events.filter((e) => e.type === "final").map((e) => e.text);
  return err ? `ERROR ${err.message}` : finals.join(" | ") || "(no final text)";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const langs: LanguageId[] = flags.has("--langs") ? ["en", "hi", "gu", "mr", "auto"] : ["hi"];
  const pcm = flags.has("--langs") ? clip.pcm.subarray(0, 24000) : clip.pcm;

  for (const model of models) {
    for (const lang of langs) {
      const label = `${model.id} [${lang}]`;
      try {
        if (isStreaming(model)) {
          const r = await runStreaming(model, lang, pcm);
          console.log(`\n■ ${label}  (${r.recorded.length} msgs, close ${r.closeInfo})\n  ${summarize(r.events as never)}`);
          if (flags.has("--verbose")) for (const m of r.recorded) console.log("   ", m.phase, m.t, m.data.slice(0, 300));
          if (record) {
            const lines = [JSON.stringify({ meta: { model: model.id, upstreamModel: model.upstreamModel, url: r.url, audio: "hi-4s.wav", recordedAt: new Date().toISOString() } }), ...r.recorded.map((x) => JSON.stringify(x))];
            writeFileSync(join(OUT, `${fixtureName(model.id)}.ws.jsonl`), lines.join("\n") + "\n");
          }
        } else {
          const r = await runRest(model, lang, pcm);
          console.log(`\n■ ${label}  (${r.responses.map((x) => x.status).join(",")})\n  ${summarize(r.events as never)}`);
          if (flags.has("--verbose")) for (const x of r.responses) console.log("   ", x.contentType, x.body.slice(0, 1500));
          if (record) writeFileSync(join(OUT, `${fixtureName(model.id)}.rest.json`), JSON.stringify({ model: model.id, responses: r.responses }, null, 2) + "\n");
        }
      } catch (err) {
        console.log(`\n■ ${label}\n  FAILED ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

main();
