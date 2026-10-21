import { offerWaitlistSlot } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params, body }) => offerWaitlistSlot(db, ctx, params.id, await body()), { status: 201 });
