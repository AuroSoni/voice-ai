import { NextResponse, type NextRequest } from "next/server";
import {
  authMode,
  checkPassword,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
  SHARE_KEY_PARAM,
  verifySession,
} from "@/lib/auth/session";

const PUBLIC_PATHS = ["/login", "/api/health"];

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const mode = authMode();

  // WebSocket handshakes go straight to the relay route, which checks access itself and
  // reports refusals in-band (browsers can't see handshake status codes).
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") return NextResponse.next();

  if (mode === "locked") {
    if (pathname === "/api/health") return NextResponse.next();
    return isApi
      ? NextResponse.json({ error: "API disabled: set APP_PASSWORD on this deployment" }, { status: 503 })
      : new NextResponse("This deployment has no APP_PASSWORD configured, so it is locked.", { status: 503 });
  }
  if (mode === "open") return NextResponse.next();

  // Share link: ?key=<password> signs the visitor in, then drops the key from the URL.
  const shareKey = searchParams.get(SHARE_KEY_PARAM);
  if (shareKey && !isApi) {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete(SHARE_KEY_PARAM);
    if (await checkPassword(shareKey)) {
      const res = NextResponse.redirect(clean);
      res.cookies.set(SESSION_COOKIE, await createSession(), sessionCookieOptions());
      return res;
    }
    clean.pathname = "/login";
    clean.search = "?error=1";
    return NextResponse.redirect(clean);
  }

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // Fetches and WebSocket handshakes can't follow a login redirect, so the API answers 401.
  if (isApi) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|worklets/).*)"],
};
