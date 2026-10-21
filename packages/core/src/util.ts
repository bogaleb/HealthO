import type { z } from "zod";
import { AppError } from "@projectos/shared";
import { pgConstraint, pgErrorCode } from "@projectos/db";

/** Validate untrusted input with Zod; convert failures to a 422 AppError with field details. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new AppError(
      "VALIDATION_FAILED",
      "Some fields are invalid.",
      r.error.issues.map((i) => ({ code: i.code, field: i.path.join("."), message: i.message })),
    );
  }
  return r.data;
}

/** Map well-known Postgres errors to safe application errors. */
export function mapDbError(e: unknown, uniqueMessage = "A record with these values already exists."): never {
  const code = pgErrorCode(e);
  if (code === "23505") throw new AppError("CONFLICT", uniqueMessage, [{ code: "UNIQUE", field: pgConstraint(e) }]);
  if (code === "23503") throw new AppError("VALIDATION_FAILED", "A referenced record does not exist in this organization.");
  if (code === "23514") throw new AppError("VALIDATION_FAILED", "Values violate a data rule.", [{ code: "CHECK", field: pgConstraint(e) }]);
  throw e;
}
