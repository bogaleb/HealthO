export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "DEPENDENCY_CYCLE"
  | "TASK_BLOCKED"
  | "SLOT_CONFLICT"
  | "SLOT_UNAVAILABLE"
  | "HOLD_EXPIRED"
  | "BOOKING_DISABLED"
  | "ELIGIBILITY_BLOCKED"
  | "ELIGIBILITY_REVIEW"
  | "ROLE_ESCALATION"
  | "INVITE_INVALID"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

export interface ErrorDetail {
  code: string;
  field?: string;
  message?: string;
}

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  DEPENDENCY_CYCLE: 422,
  TASK_BLOCKED: 422,
  SLOT_CONFLICT: 409,
  SLOT_UNAVAILABLE: 422,
  HOLD_EXPIRED: 409,
  BOOKING_DISABLED: 403,
  ELIGIBILITY_BLOCKED: 422,
  ELIGIBILITY_REVIEW: 409,
  ROLE_ESCALATION: 403,
  INVITE_INVALID: 422,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** Domain/application error with a stable machine-readable code. Messages must never contain PHI. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[];
  constructor(code: ErrorCode, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const forbidden = (message = "You do not have permission to perform this action.") => new AppError("FORBIDDEN", message);
export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found.`);
export const versionConflict = () => new AppError("VERSION_CONFLICT", "This record was changed by someone else. Reload and try again.");

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details: ErrorDetail[]; requestId: string };
}
