import { createRuleDraft, listRules } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => listRules(db, ctx));
export const POST = api(async ({ ctx, db, body }) => createRuleDraft(db, ctx, await body()), { status: 201 });
