import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Db } from "@projectos/db";
import { loadAuthContext, type AuthContext } from "@projectos/auth";
import { getAuth } from "@projectos/auth/server";
import { AppError, isAppError, logger, type ErrorBody } from "@projectos/shared";

const MAX_BODY_BYTES = 64 * 1024;

type Params = Record<string, string>;
interface HandlerArgs<P extends Params> {
  req: NextRequest;
  ctx: AuthContext;
  db: Db;
  params: P;
  requestId: string;
  body: () => Promise<unknown>;
}

function errorResponse(e: AppError, requestId: string) {
  const body: ErrorBody = { error: { code: e.code, message: e.message, details: e.details, requestId } };
  return NextResponse.json(body, { status: e.status, headers: { "x-request-id": requestId } });
}

/** Rejects cross-site state-changing requests (defense in depth on top of SameSite cookies). */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (tests/CLI) send no Origin; cookies still required
  const allowed = new URL(process.env.BETTER_AUTH_URL ?? req.nextUrl.origin).origin;
  if (origin !== allowed && origin !== req.nextUrl.origin) throw new AppError("FORBIDDEN", "Cross-origin request rejected.");
}

async function readJson(req: NextRequest): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new AppError("VALIDATION_FAILED", "Request body too large.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION_FAILED", "Request body too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Malformed JSON body.");
  }
}

/**
 * Wraps an authenticated /api/v1 handler: request id, session → trusted org context,
 * same-origin check, JSON parsing, stable error format and redacted logging.
 */
export function api<P extends Params = Params>(handler: (a: HandlerArgs<P>) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const started = Date.now();
    try {
      assertSameOrigin(req);
      const session = await getAuth().api.getSession({ headers: req.headers });
      if (!session) throw new AppError("UNAUTHENTICATED", "Sign in required.");
      const db = getDb();
      const ctx = await loadAuthContext(db, session.user.id, requestId);
      if (!ctx) throw new AppError("FORBIDDEN", "Your organization membership is not active.");
      const params = (await route.params) ?? ({} as P);
      const result = await handler({ req, ctx, db, params, requestId, body: () => readJson(req) });
      logger.info("api", { requestId, method: req.method, route: req.nextUrl.pathname, status: opts.status ?? 200, ms: Date.now() - started });
      if (result instanceof Response) return result;
      if (result === undefined) return new NextResponse(null, { status: 204, headers: { "x-request-id": requestId } });
      return NextResponse.json({ data: result }, { status: opts.status ?? 200, headers: { "x-request-id": requestId } });
    } catch (e) {
      if (isAppError(e)) {
        logger.info("api.error", { requestId, method: req.method, route: req.nextUrl.pathname, code: e.code, ms: Date.now() - started });
        return errorResponse(e, requestId);
      }
      logger.error("api.unhandled", { requestId, method: req.method, route: req.nextUrl.pathname, err: e instanceof Error ? e.name : "unknown" });
      return errorResponse(new AppError("INTERNAL", "Something went wrong. Reference the request ID if you contact support."), requestId);
    }
  };
}

/** Same as `api` but without authentication (health checks, invite acceptance). */
export function publicApi(handler: (a: { req: NextRequest; requestId: string; body: () => Promise<unknown> }) => Promise<unknown>) {
  return async (req: NextRequest) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    try {
      assertSameOrigin(req);
      const result = await handler({ req, requestId, body: () => readJson(req) });
      if (result instanceof Response) return result;
      return NextResponse.json({ data: result }, { headers: { "x-request-id": requestId } });
    } catch (e) {
      if (isAppError(e)) return errorResponse(e, requestId);
      logger.error("api.unhandled", { requestId, route: req.nextUrl.pathname, err: e instanceof Error ? e.name : "unknown" });
      return errorResponse(new AppError("INTERNAL", "Something went wrong."), requestId);
    }
  };
}

export function searchParams(req: NextRequest): Record<string, string> {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}
