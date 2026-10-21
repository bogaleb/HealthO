import { createPatient, searchPatients } from "@projectos/scheduling";
import { api } from "@/lib/api";

/** Picker search: ?q= (2+ chars, max 20 rows). The query string carries a search term, never an identifier list. */
export const GET = api(async ({ ctx, db, req }) => searchPatients(db, ctx, req.nextUrl.searchParams.get("q") ?? ""));
export const POST = api(async ({ ctx, db, body }) => createPatient(db, ctx, await body()), { status: 201 });
