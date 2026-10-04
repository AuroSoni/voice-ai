import "server-only";
import { authMode, readCookie, SESSION_COOKIE, verifySession } from "./session";

function deployed(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
}

/** Hosts this deployment answers on: request host plus Vercel's system URLs and ALLOWED_HOSTS. */
function allowedHosts(request: Request): Set<string> {
  const hosts = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ...(process.env.ALLOWED_HOSTS ?? "").split(","),
  ];
  return new Set(hosts.filter((h): h is string => Boolean(h && h.trim())).map((h) => h.trim().toLowerCase()));
}

/**
 * Re-checks access inside every API route (proxy.ts is the first line, not the only
 * one). Returns a response to send instead, or null to continue.
 */
export async function guardApi(request: Request): Promise<Response | null> {
  const mode = authMode();
  if (mode === "locked") {
    return Response.json({ error: "API disabled: set APP_PASSWORD on this deployment" }, { status: 503 });
  }

  // Same-origin only on deployments: blocks other sites from driving the API with a
  // visitor's cookie (SameSite=Lax already stops most of this; this is the backstop).
  // Skipped locally, where `vercel dev` forwards WebSocket handshakes with an internal host.
  const origin = request.headers.get("origin");
  if (origin && deployed()) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {}
    if (!allowedHosts(request).has(originHost)) {
      console.warn(`[guard] cross-origin refused: origin=${origin} host=${request.headers.get("host")}`);
      return Response.json({ error: "Cross-origin request refused" }, { status: 403 });
    }
  }

  if (mode === "open") return null;
  const ok = await verifySession(readCookie(request.headers.get("cookie"), SESSION_COOKIE));
  return ok ? null : Response.json({ error: "Not signed in" }, { status: 401 });
}
