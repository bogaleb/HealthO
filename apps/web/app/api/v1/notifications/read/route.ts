import { markNotificationsRead } from "@projectos/notifications";
import { api } from "@/lib/api";

export const POST = api(async ({ ctx, db, body }) => markNotificationsRead(db, ctx, await body()));
