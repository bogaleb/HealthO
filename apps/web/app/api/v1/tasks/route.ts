import { NextResponse } from "next/server";
import { createTask, listTasks } from "@projectos/core";
import { AppError } from "@projectos/shared";
import { api, searchParams } from "@/lib/api";

export const GET = api(async ({ ctx, db, req }) => listTasks(db, ctx, searchParams(req)));

/** Supports `Idempotency-Key` header so client retries never create duplicates. */
export const POST = api(async ({ ctx, db, req, body, requestId }) => {
  const key = req.headers.get("idempotency-key") ?? undefined;
  if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError("VALIDATION_FAILED", "Invalid Idempotency-Key header.");
  const r = await createTask(db, ctx, await body(), { idempotencyKey: key });
  return NextResponse.json({ data: r.task, replayed: r.replayed }, { status: r.replayed ? 200 : 201, headers: { "x-request-id": requestId } });
});
