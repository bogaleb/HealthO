import { createInvite, listInvites } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => listInvites(db, ctx));
/** Returns the one-time token once (local synthetic invite simulation; no email is sent). */
export const POST = api(async ({ ctx, db, body }) => createInvite(db, ctx, await body()), { status: 201 });
