import { createRecurringDefinition, listRecurringDefinitions } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => listRecurringDefinitions(db, ctx, params.id));
export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => createRecurringDefinition(db, ctx, { ...((await body()) as object), projectId: params.id }), {
  status: 201,
});
