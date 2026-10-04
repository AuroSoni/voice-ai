/**
 * Stand-in for every provider, used by the keyless E2E suite. Speaks each provider's real
 * protocol by replaying the traffic recorded by `npm run smoke` (fixtures/upstream/), at the
 * recorded pace: stream-phase messages relative to the first audio frame, finish-phase
 * messages after the client ends the stream.
 *
 * Control (used by tests): POST /__control {"fail": {"<modelId>": 403}, "stall": ["<modelId>"]}
 * resets and applies behaviour; GET /__stats lists requests seen (to prove no real key leaked).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { MODELS, isStreaming } from "@/lib/models/registry";
import type { ModelDef, ProviderId } from "@/lib/models/types";
import { readRestFixture, readWsFixture } from "@/lib/stream/fixtures";

const PORT = Number(process.env.MOCK_PORT ?? 4010);

let control: { fail: Record<string, number>; stall: string[] } = { fail: {}, stall: [] };
const stats: { path: string; model?: string; key?: string }[] = [];

const find = (provider: ProviderId, upstream: string, streaming: boolean): ModelDef | undefined =>
  MODELS.find((m) => m.provider === provider && m.upstreamModel === upstream && isStreaming(m) === streaming);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function keyOf(req: IncomingMessage): string | undefined {
  const h = req.headers;
  return (h["api-subscription-key"] ?? h["xi-api-key"] ?? h["x-goog-api-key"] ?? h.authorization)?.toString();
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function replayRest(res: ServerResponse, model: ModelDef) {
  const fail = control.fail[model.id];
  if (fail) return json(res, fail, { error: { message: `mock failure for ${model.id}` } });
  const fx = readRestFixture(model.id).responses[0];
  res.writeHead(fx.status, { "content-type": fx.contentType });
  if (fx.contentType.includes("event-stream")) {
    // Re-stream SSE events with a small gap so the client sees deltas arrive.
    for (const event of fx.body.split(/\n\n/)) {
      if (!event.trim()) continue;
      res.write(event + "\n\n");
      await sleep(40);
    }
    res.end();
  } else {
    await sleep(150);
    res.end(fx.body);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  if (req.method === "GET" && path === "/__health") return json(res, 200, { ok: true });
  if (req.method === "GET" && path === "/__stats") return json(res, 200, { requests: stats });
  if (req.method === "POST" && path === "/__control") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    control = { fail: body.fail ?? {}, stall: body.stall ?? [] };
    stats.length = 0;
    return json(res, 200, { ok: true });
  }

  const body = await readBody(req);
  let model: ModelDef | undefined;
  let m: RegExpMatchArray | null;

  if (path === "/openai/v1/realtime/client_secrets") {
    const upstream = JSON.parse(body.toString()).session?.audio?.input?.transcription?.model;
    model = find("openai", upstream, true);
    stats.push({ path, model: model?.id, key: keyOf(req) });
    if (!model) return json(res, 400, { error: "unknown model" });
    if (control.fail[model.id]) return json(res, control.fail[model.id], { error: { message: "mock token failure" } });
    return json(res, 200, { value: `ek_mock_${upstream}`, expires_at: Math.floor(Date.now() / 1000) + 120 });
  }
  if ((m = path.match(/^\/gemini\/(v1alpha|v1beta)\/auth_tokens$/))) {
    stats.push({ path, key: keyOf(req) });
    return json(res, 200, { name: "auth_tokens/mock" });
  }
  if (path === "/elevenlabs/v1/single-use-token/realtime_scribe") {
    stats.push({ path, key: keyOf(req) });
    return json(res, 200, { token: "mock-token" });
  }

  if (path === "/openai/v1/audio/transcriptions") model = MODELS.find((x) => x.id === "openai/gpt-transcribe");
  else if (path === "/sarvam/speech-to-text") model = MODELS.find((x) => x.id === "sarvam/saaras-v4");
  else if (path === "/elevenlabs/v1/speech-to-text") model = MODELS.find((x) => x.id === "elevenlabs/scribe-v2");
  else if ((m = path.match(/^\/gemini\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/))) {
    model = find("gemini", m[1], false);
  }
  stats.push({ path, model: model?.id, key: keyOf(req) });
  if (!model) return json(res, 404, { error: `mock has no route for ${req.method} ${path}` });
  return replayRest(res, model);
});

const FINISHES: Record<ProviderId, (msg: Record<string, unknown>) => boolean> = {
  openai: (m) => m.type === "input_audio_buffer.commit",
  gemini: (m) => Boolean((m.realtimeInput as Record<string, unknown> | undefined)?.audioStreamEnd),
  sarvam: (m) => m.event === "end",
  elevenlabs: (m) => m.commit === true,
};
const isAudio = (m: Record<string, unknown>) =>
  m.type === "input_audio_buffer.append" ||
  Boolean((m.realtimeInput as Record<string, unknown> | undefined)?.audio) ||
  m.event === "audio_input" ||
  (m.message_type === "input_audio_chunk" && m.commit !== true);

function replaySocket(ws: WebSocket, model: ModelDef) {
  const lines = readWsFixture(model.id);
  const stream = lines.filter((l) => l.phase === "stream");
  const finish = lines.filter((l) => l.phase === "finish");
  const timers: NodeJS.Timeout[] = [];
  const send = (data: string) => ws.readyState === ws.OPEN && ws.send(data);
  let audioStarted = false;
  let finished = false;

  for (const l of stream.filter((x) => x.t === 0)) send(l.data);
  const pending = stream.filter((x) => x.t > 0);

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!audioStarted && isAudio(msg)) {
      audioStarted = true;
      for (const l of pending) timers.push(setTimeout(() => send(l.data), l.t));
    }
    if (!finished && FINISHES[model.provider](msg)) {
      finished = true;
      if (control.stall.includes(model.id)) return;
      timers.forEach(clearTimeout);
      // Anything from the stream phase not yet sent goes out now, then the finish phase.
      for (const l of pending) send(l.data);
      const base = finish[0]?.t ?? 0;
      for (const l of finish) timers.push(setTimeout(() => send(l.data), 80 + (l.t - base)));
    }
  });
  ws.on("close", () => timers.forEach(clearTimeout));
}

const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => (protocols.has("realtime") ? "realtime" : false),
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  let model: ModelDef | undefined;
  let deferModel = false;

  if (path === "/openai/v1/realtime") {
    const protocols = String(req.headers["sec-websocket-protocol"] ?? "");
    const upstream = protocols.match(/openai-insecure-api-key\.ek_mock_([\w.-]+)/)?.[1] ?? "";
    model = find("openai", upstream, true);
  } else if (path.startsWith("/gemini/ws/")) {
    deferModel = true; // model arrives in the setup message
  } else if (path === "/sarvam/speech-to-text-realtime/ws") {
    model = find("sarvam", url.searchParams.get("model") ?? "", true);
  } else if (path === "/elevenlabs/v1/speech-to-text/realtime") {
    model = find("elevenlabs", url.searchParams.get("model_id") ?? "", true);
  }
  stats.push({ path, model: model?.id, key: keyOf(req) });

  const status = model ? control.fail[model.id] : undefined;
  if ((!model && !deferModel) || status) {
    const code = status ?? 404;
    socket.write(`HTTP/1.1 ${code} Mock\r\ncontent-type: text/plain\r\ncontent-length: 12\r\n\r\nmock refused`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (model) return replaySocket(ws, model);
    ws.once("message", (raw) => {
      const setup = JSON.parse(raw.toString()).setup;
      const gm = find("gemini", String(setup?.model ?? "").replace(/^models\//, ""), true);
      if (!gm) return ws.close(1008, "unknown model");
      if (control.fail[gm.id]) return ws.close(1011, "mock failure");
      replaySocket(ws, gm);
    });
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock upstream on http://127.0.0.1:${PORT}`));
