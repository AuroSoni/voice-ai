// Sarvam has no temporary tokens, so the browser connects here and we hold the key.
// Runs on Vercel's WebSocket support (and `vercel dev` locally); plain `next dev`
// can't upgrade, which the client reports as "run via vercel dev".
import { experimental_upgradeWebSocket } from "@vercel/functions";
import { guardApi } from "@/lib/auth/guard";
import { isLanguageId } from "@/lib/languages";
import { getModel, resolveOptions } from "@/lib/models/registry";
import { providerKey } from "@/lib/server/env";
import { pipeRelay } from "@/lib/server/relay";
import { sarvamParams, sarvamUpstreamUrl } from "@/lib/server/tokens";

export const maxDuration = 120;

/**
 * Browsers can't read the status of a failed handshake (they just see 1006), and
 * `vercel dev` drops the whole dev server when an upgrade is answered with plain HTTP.
 * So refusals accept the socket, explain in-band, and close with 4000 + status.
 */
async function refuse(request: Request, status: number, body: string): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: body }, { status });
  }
  try {
    return await experimental_upgradeWebSocket((ws) => {
      ws.send(JSON.stringify({ event: "relay_error", status, body }));
      ws.close(4000 + status, body.slice(0, 100));
    });
  } catch {
    return Response.json({ error: body }, { status });
  }
}

export async function GET(request: Request) {
  const denied = await guardApi(request);
  if (denied) {
    const { error } = (await denied.json()) as { error: string };
    return refuse(request, denied.status, error);
  }

  const params = new URL(request.url).searchParams;
  const model = getModel(params.get("modelId") ?? "");
  const language = params.get("language");
  if (!model || model.transport !== "ws-relay" || model.provider !== "sarvam") return refuse(request, 400, "Unknown relay model");
  if (!isLanguageId(language)) return refuse(request, 400, "Unknown language");
  const key = providerKey("sarvam");
  if (!key) return refuse(request, 503, "Provider not configured");

  const options = resolveOptions(model, { mode: params.get("mode") ?? "" });
  const url = sarvamUpstreamUrl(sarvamParams(model, language, options));

  try {
    // Resolve only when the session ends, so the invocation lives as long as the socket.
    return await experimental_upgradeWebSocket(
      (client) => pipeRelay(client, { url, headers: { "api-subscription-key": key }, maxMs: 90_000 }),
      { maxPayload: 256 * 1024 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[relay/sarvam] ${message}`);
    return Response.json({ error: `WebSocket relay unavailable here (${message}). Run via \`vercel dev\`.` }, { status: 501 });
  }
}
