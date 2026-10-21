import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@projectos/db";
import { loadAuthContext, type AuthContext } from "@projectos/auth";
import { getAuth } from "@projectos/auth/server";
import { isAppError } from "@projectos/shared";

/** Per-request (React cache) session + trusted org context. */
export const getRequestContext = cache(async () => {
  const h = await headers();
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return null;
  const ctx = await loadAuthContext(getDb(), session.user.id, h.get("x-request-id") ?? undefined);
  return { session, ctx };
});

export async function requireContext(): Promise<AuthContext> {
  const r = await getRequestContext();
  if (!r) redirect("/login");
  if (!r.ctx) redirect("/no-access");
  return r.ctx;
}

export class PageForbidden extends Error {}

/** Run a use-case from a server component, translating domain errors into Next.js behaviors. */
export async function load<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    if (isAppError(e) && e.code === "FORBIDDEN") throw new PageForbidden("forbidden");
    throw e;
  }
}
