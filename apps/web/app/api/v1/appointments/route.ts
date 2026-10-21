import { NextResponse } from "next/server";
import { AppError } from "@projectos/shared";
import { createAppointment } from "@projectos/scheduling";
import { api } from "@/lib/api";

/** Book (synthetic demo only). Supports `Idempotency-Key` so a retried submit never double-books. */
export const POST = api(async ({ ctx, db, req, body, requestId }) => {
  const key = req.headers.get("idempotency-key") ?? undefined;
  if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError("VALIDATION_FAILED", "Invalid Idempotency-Key header.");
  const r = await createAppointment(db, ctx, await body(), { idempotencyKey: key });
  return NextResponse.json({ data: r.appointment, eligibility: r.eligibility, replayed: r.replayed }, { status: r.replayed ? 200 : 201, headers: { "x-request-id": requestId } });
});
