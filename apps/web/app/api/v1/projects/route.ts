import { createProject, listProjects } from "@projectos/core";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listProjects(db, ctx, { status: searchParams(req).status || undefined }));
export const POST = api(async ({ ctx, db, body }) => createProject(db, ctx, await body()), { status: 201 });
