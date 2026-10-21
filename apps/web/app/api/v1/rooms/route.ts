import { createRoom, getSchedulingReference } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => (await getSchedulingReference(db, ctx)).rooms);
export const POST = api(async ({ ctx, db, body }) => createRoom(db, ctx, await body()), { status: 201 });
