import { createPayer, listPayers } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => listPayers(db, ctx));
export const POST = api(async ({ ctx, db, body }) => createPayer(db, ctx, await body()), { status: 201 });
