// Password gate. Sessions are an HMAC-signed expiry in an HttpOnly cookie, verified with
// Web Crypto so the same code runs in proxy.ts and in route handlers.
export const SESSION_COOKIE = "stt_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
/** Query parameter for share links: https://host/?key=<APP_PASSWORD> signs the visitor in. */
export const SHARE_KEY_PARAM = "key";

export type AuthMode = "open" | "password" | "locked";

/**
 * open: no APP_PASSWORD, local/dev — everything is reachable.
 * password: APP_PASSWORD set — pages and API need a session.
 * locked: a Vercel production/preview deployment without APP_PASSWORD — refuse the API
 *         rather than expose paid keys (ALLOW_PUBLIC=1 opts out).
 */
export function authMode(): AuthMode {
  if (process.env.APP_PASSWORD) return "password";
  const deployed = process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
  if (deployed && process.env.ALLOW_PUBLIC !== "1") return "locked";
  return "open";
}

const encoder = new TextEncoder();

function secret(): string {
  return process.env.AUTH_SECRET || `stt-playground:${process.env.APP_PASSWORD ?? ""}`;
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  let binary = "";
  for (const b of sig) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await hmac(`session:${exp}`)}`;
}

export async function verifySession(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || !sig || exp * 1000 < now) return false;
  return constantTimeEqual(sig, await hmac(`session:${exp}`));
}

export async function checkPassword(input: string | null | undefined): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected || !input) return false;
  return constantTimeEqual(await hmac(`pw:${input}`), await hmac(`pw:${expected}`));
}

export function sessionCookieOptions() {
  const deployed = process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Safari rejects Secure cookies on http://localhost, so only on deployments.
    secure: deployed,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
