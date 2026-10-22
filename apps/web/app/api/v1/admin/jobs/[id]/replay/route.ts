import { replayJob } from "@projectos/notifications";
import { api } from "@/lib/api";

export const POST = api<{ id: string }>(async ({ ctx, db, params }) => replayJob(db, ctx, params.id));
