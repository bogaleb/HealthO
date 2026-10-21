import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/invite", "/no-access", "/api/auth", "/api/v1/health", "/api/v1/invites/accept", "/_next", "/favicon"];

/**
 * Cheap gate: attaches a request id and redirects page requests without a session cookie to /login.
 * Real authentication and authorization happen server-side in layouts and API handlers.
 */
export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
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
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
