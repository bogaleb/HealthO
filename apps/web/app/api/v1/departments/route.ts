import { createDepartment, listDepartments } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api(async ({ ctx, db }) => listDepartments(db, ctx));
export const POST = api(async ({ ctx, db, body }) => createDepartment(db, ctx, await body()), { status: 201 });
