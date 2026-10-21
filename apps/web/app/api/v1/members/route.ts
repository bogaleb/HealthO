import { listMemberDirectory } from "@projectos/core";
import { api } from "@/lib/api";

/** Minimal directory (display names only) for owner/assignee pickers. */
export const GET = api(async ({ ctx, db }) => listMemberDirectory(db, ctx));
