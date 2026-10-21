"use client";

export class ApiError extends Error {
  code: string;
  status: number;
  details: { code: string; field?: string; message?: string }[];
  requestId?: string;
  constructor(status: number, body: { error?: { code: string; message: string; details?: ApiError["details"]; requestId?: string } } | null) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code ?? "INTERNAL";
    this.details = body?.error?.details ?? [];
    this.requestId = body?.error?.requestId;
  }
  /** Field-level messages keyed by field path. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.filter((d) => d.field && d.message).map((d) => [d.field!, d.message!]));
  }
}

export async function apiFetch<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.assign("/login");
    throw new ApiError(res.status, json);
  }
  return (json?.data ?? json) as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const extra = e.details.filter((d) => d.message).map((d) => d.message);
    return extra.length && e.code === "VALIDATION_FAILED" ? `${e.message} ${extra.join(" ")}` : e.message;
  }
  return "Network error — check your connection and try again.";
}
