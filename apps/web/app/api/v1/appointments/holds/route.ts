import { createHold } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const POST = api(async ({ ctx, db, body }) => createHold(db, ctx, await body()), { status: 201 });
