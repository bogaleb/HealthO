import { createTeam, listTeams } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => listTeams(db, ctx));
export const POST = api(async ({ ctx, db, body }) => createTeam(db, ctx, await body()), { status: 201 });
