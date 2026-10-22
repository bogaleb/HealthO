import { replayOutboxEvent } from "@projectos/notifications";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params }) => replayOutboxEvent(db, ctx, params.id));
