import { listNotifications } from "@projectos/notifications";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listNotifications(db, ctx, { unread: req.nextUrl.searchParams.get("unread") === "true" }));
