import { guardApi } from "@/lib/auth/guard";
import { isLanguageId } from "@/lib/languages";
import { getModel, isStreaming, resolveOptions } from "@/lib/models/registry";
import { providerKey } from "@/lib/server/env";
import { mintConnection } from "@/lib/server/tokens";
import { UpstreamError } from "@/lib/server/upstream-error";

export const maxDuration = 15;

export async function POST(request: Request) {
  const denied = await guardApi(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as {
    modelId?: string;
    language?: string;
    options?: Record<string, string>;
  } | null;
  const model = body?.modelId ? getModel(body.modelId) : undefined;
  if (!model || !isStreaming(model)) return Response.json({ error: "Unknown streaming model" }, { status: 400 });
  if (!isLanguageId(body?.language)) return Response.json({ error: "Unknown language" }, { status: 400 });

  const key = providerKey(model.provider);
  if (!key) return Response.json({ error: "Provider not configured" }, { status: 503 });

  try {
    const conn = await mintConnection(model, body.language, resolveOptions(model, body.options), { key });
    return Response.json(conn, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 502;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[realtime-token] ${model.id}: ${message}`);
    return Response.json({ error: message, upstreamStatus: status }, { status: 502 });
  }
}
