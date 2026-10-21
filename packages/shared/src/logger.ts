/**
 * Minimal structured JSON logger with key-based redaction.
 * Never log patient identity, tokens, passwords, license numbers or request bodies.
 */
const REDACT_KEYS = /pass(word)?|token|secret|cookie|authorization|session|email|name|dob|birth|phone|address|license_?number|ssn|mrn|body|note/i;

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function minLevel(): Level {
  const l = (process.env.LOG_LEVEL ?? "info") as Level;
  return l in ORDER ? l : "info";
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < ORDER[minLevel()]) return;
  if (process.env.NODE_ENV === "test" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields ?? {}) as object) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
