import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { pipeRelay, safeCloseCode } from "./relay";

// A local "upstream" plus a local "app" server whose connections are relayed to it.
async function setup(upstreamBehaviour: (ws: WebSocket, headers: Record<string, unknown>) => void, relayOpts = {}) {
  const servers: Server[] = [];
  const listen = (s: Server) =>
    new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

  const upstreamHttp = createServer((req, res) => {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("invalid key");
  });
  const upstreamWss = new WebSocketServer({ noServer: true });
  upstreamHttp.on("upgrade", (req, socket, head) => {
    if (req.url?.includes("reject")) {
      socket.write("HTTP/1.1 403 Forbidden\r\ncontent-length: 11\r\n\r\ninvalid key");
      socket.destroy();
      return;
    }
    upstreamWss.handleUpgrade(req, socket, head, (ws) => upstreamBehaviour(ws, req.headers));
  });
  const upPort = await listen(upstreamHttp);
  servers.push(upstreamHttp);

  const appHttp = createServer();
  const appWss = new WebSocketServer({ server: appHttp });
  appWss.on("connection", (client, req) => {
    const path = req.url?.includes("reject") ? "/reject" : "/ok";
    void pipeRelay(client, { url: `ws://127.0.0.1:${upPort}${path}`, headers: { "api-subscription-key": "secret" }, ...relayOpts });
  });
  const appPort = await listen(appHttp);
  servers.push(appHttp);
  cleanups.push(() => {
    upstreamWss.close();
    appWss.close();
    for (const s of servers) s.close();
  });
  return appPort;
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

function collect(ws: WebSocket) {
  const messages: { text: string; binary: boolean }[] = [];
  ws.on("message", (d, isBinary) => messages.push({ text: d.toString(), binary: isBinary }));
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  return { messages, closed };
}

describe("pipeRelay", () => {
  it("sends the key upstream and keeps messages sent before upstream opened, as text", async () => {
    let seenKey: unknown;
    const got: string[] = [];
    const port = await setup((ws, headers) => {
      seenKey = headers["api-subscription-key"];
      ws.on("message", (d, isBinary) => {
        got.push(d.toString());
        ws.send(`echo:${d.toString()}`, { binary: isBinary });
        if (got.length === 3) ws.close(1000, "bye");
      });
    });
    const client = new WebSocket(`ws://127.0.0.1:${port}/ok`);
    const { messages, closed } = collect(client);
    await new Promise((r) => client.on("open", r));
    client.send("a"); // likely before the upstream handshake finished
    client.send("b");
    client.send("c");
    expect(await closed).toBe(1000);
    expect(seenKey).toBe("secret");
    expect(got).toEqual(["a", "b", "c"]);
    expect(messages.map((m) => m.text)).toEqual(["echo:a", "echo:b", "echo:c"]);
    expect(messages.every((m) => !m.binary)).toBe(true);
  });

  it("reports an upstream handshake rejection in-band", async () => {
    const port = await setup(() => {});
    const client = new WebSocket(`ws://127.0.0.1:${port}/reject`);
    const { messages, closed } = collect(client);
    await closed;
    const err = JSON.parse(messages[0].text);
    expect(err).toMatchObject({ event: "relay_error", status: 403 });
    expect(err.body).toContain("invalid key");
  });

  it("enforces the byte budget", async () => {
    const port = await setup((ws) => ws.on("message", () => {}), { maxBytes: 10 });
    const client = new WebSocket(`ws://127.0.0.1:${port}/ok`);
    const { messages, closed } = collect(client);
    await new Promise((r) => client.on("open", r));
    client.send("x".repeat(20));
    expect(await closed).toBe(1009);
    expect(JSON.parse(messages[0].text)).toMatchObject({ event: "relay_error", status: 413 });
  });

  it("maps reserved close codes", () => {
    expect(safeCloseCode(1006)).toBe(1011);
    expect(safeCloseCode(1005)).toBe(1000);
    expect(safeCloseCode(4001)).toBe(4001);
  });
});
