import { createWaitlistEntry, listWaitlist } from "@projectos/scheduling";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listWaitlist(db, ctx, { status: req.nextUrl.searchParams.get("status") ?? undefined }));
export const POST = api(async ({ ctx, db, body }) => createWaitlistEntry(db, ctx, await body()), { status: 201 });
