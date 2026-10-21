import { createAuthority, getPractitionerDetail } from "@projectos/credentialing";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => (await getPractitionerDetail(db, ctx, params.id)).authorities);
/** Records evidence as DRAFT; it never authorizes anything until verified by an approver. */
export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => createAuthority(db, ctx, params.id, await body()), { status: 201 });
