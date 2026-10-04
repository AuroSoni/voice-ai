// Pipes a browser WebSocket to an upstream provider socket that needs a secret header.
// Client listeners attach first so nothing the browser sends during the upstream
// handshake is lost; frames keep their text/binary type; failures are reported
// in-band as {"event":"relay_error"} before closing, since browsers can't see
// handshake status codes.
import WebSocket from "ws";

export interface RelayOptions {
  url: string;
  headers: Record<string, string>;
  /** Hard cap on session length. */
  maxMs?: number;
  /** Hard cap on bytes accepted from the browser. */
  maxBytes?: number;
}

const MAX_QUEUE_BYTES = 1024 * 1024;

/** Close codes `ws` lets us send; others (1005, 1006, 1015) are reserved. */
export function safeCloseCode(code: number | undefined, fallback = 1011): number {
  if (code === undefined) return fallback;
  if (code === 1000 || (code >= 1001 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code <= 4999)) {
    return code;
  }
  return code === 1005 ? 1000 : fallback;
}

function byteLength(data: WebSocket.RawData): number {
  if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0);
  return data instanceof ArrayBuffer ? data.byteLength : data.length;
}

/** Resolves when both sides are closed. */
export function pipeRelay(client: WebSocket, opts: RelayOptions): Promise<void> {
  const maxBytes = opts.maxBytes ?? 2.5 * 1024 * 1024;
  const queue: { data: WebSocket.RawData; isBinary: boolean }[] = [];
  let queuedBytes = 0;
  let received = 0;
  let closed = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const sendError = (payload: Record<string, unknown>) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ event: "relay_error", ...payload }));
  };

  const closeBoth = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    const c = safeCloseCode(code);
    const r = reason.slice(0, 120);
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close(c, r);
    if (upstream.readyState === WebSocket.OPEN) upstream.close(c, r);
    else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
    resolveDone();
  };

  // 1. Client side first.
  client.on("message", (data, isBinary) => {
    received += byteLength(data);
    if (received > maxBytes) {
      sendError({ status: 413, message: "Audio limit reached for this session" });
      closeBoth(1009, "byte budget exceeded");
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else {
      queuedBytes += byteLength(data);
      if (queuedBytes > MAX_QUEUE_BYTES) {
        sendError({ status: 504, message: "Upstream did not open in time" });
        closeBoth(1011, "upstream slow");
        return;
      }
      queue.push({ data, isBinary });
    }
  });
  client.on("close", (code, reason) => closeBoth(code, reason.toString() || "client closed"));
  client.on("error", () => closeBoth(1011, "client error"));

  // 2. Upstream.
  const upstream = new WebSocket(opts.url, { headers: opts.headers });
  upstream.on("open", () => {
    for (const m of queue) upstream.send(m.data, { binary: m.isBinary });
    queue.length = 0;
    queuedBytes = 0;
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on("unexpected-response", (_req, res) => {
    let body = "";
    res.on("data", (chunk: Buffer) => {
      if (body.length < 2000) body += chunk.toString("utf8");
    });
    res.on("end", () => {
      sendError({ status: res.statusCode, body: body.slice(0, 500) });
      closeBoth(1011, `upstream ${res.statusCode}`);
    });
  });
  upstream.on("error", (err) => {
    sendError({ status: 502, message: err.message });
    closeBoth(1011, "upstream error");
  });
  upstream.on("close", (code, reason) => closeBoth(code, reason.toString() || "upstream closed"));

  const timer = setTimeout(() => {
    sendError({ status: 408, message: "Session time limit reached" });
    closeBoth(1000, "time limit");
  }, opts.maxMs ?? 90_000);

  return done;
}
