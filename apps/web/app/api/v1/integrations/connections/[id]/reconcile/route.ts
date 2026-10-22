import { runConnectionNow } from "@projectos/integrations";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params }) => runConnectionNow(db, ctx, params.id, "reconcile"));
