import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/invite", "/no-access", "/api/auth", "/api/v1/health", "/api/v1/invites/accept", "/_next", "/favicon"];

/**
 * Strict script CSP (Phase 8): a fresh nonce per request + 'strict-dynamic'; no 'unsafe-inline' for scripts.
 * Next.js reads the nonce from the request's Content-Security-Policy header and stamps it on its own scripts, so every
 * page must render dynamically (the root layout reads headers()). Styles keep 'unsafe-inline' because React `style`
 * attributes cannot carry a nonce — documented in ADR-0013 / the risk register.
 */
export function buildCsp(nonce: string, isDev = process.env.NODE_ENV !== "production") {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Cheap gate: attaches a request id + CSP nonce and redirects page requests without a session cookie to /login.
 * Real authentication and authorization happen server-side in layouts and API handlers.
 */
export function proxy(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p + "?"));
  const hasSession = req.cookies.getAll().some((c) => c.name.endsWith("better-auth.session_token"));
  if (!isPublic && !hasSession && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
