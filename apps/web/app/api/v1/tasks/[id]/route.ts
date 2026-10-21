import { deleteTask, getTaskDetail, updateTask } from "@projectos/core";
import { api } from "@/lib/api";

export const GET = api<{ id: string }>(async ({ ctx, db, params }) => getTaskDetail(db, ctx, params.id));
export const PATCH = api<{ id: string }>(async ({ ctx, db, params, body }) => updateTask(db, ctx, params.id, await body()));
export const DELETE = api<{ id: string }>(async ({ ctx, db, params }) => {
  await deleteTask(db, ctx, params.id);
});
