import { describe, expect, it } from "vitest";
import { releaseInfo } from "@projectos/shared";
import { buildCsp } from "../proxy";

describe("Phase 8 hardening", () => {
  it("production CSP: nonce + strict-dynamic, no inline/eval scripts, no framing, no plugins", () => {
    const csp = buildCsp("abc123", false);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
  it("development CSP only adds unsafe-eval (React dev tooling)", () => {
    expect(buildCsp("n", true)).toContain("'nonce-n' 'strict-dynamic' 'unsafe-eval'");
  });
  it("release info: stamped values, sanitised sha, safe fallbacks", () => {
    expect(releaseInfo({ APP_VERSION: "1.2.3", GIT_SHA: "0123456789abcdef0123" })).toEqual({ version: "1.2.3", gitSha: "0123456789ab", builtAt: null });
    expect(releaseInfo({ GIT_SHA: "<script>" }).gitSha).toBe("unknown");
    expect(releaseInfo({}).version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("database URL for cloud deployments", async () => {
  const { databaseUrl } = await import("@projectos/db");
  it("prefers DATABASE_URL", () => {
    expect(databaseUrl({ DATABASE_URL: "postgresql://a:b@h/d", DB_HOST: "x" })).toBe("postgresql://a:b@h/d");
  });
  it("composes from DB_* (secret-injected password, encoded) with verify-full TLS by default", () => {
    const u = new URL(databaseUrl({ DB_HOST: "db.internal", DB_USER: "app", DB_PASSWORD: "p@ss/w:rd", DB_NAME: "projectos" }));
    expect(u.hostname).toBe("db.internal");
    expect(decodeURIComponent(u.password)).toBe("p@ss/w:rd");
    expect(u.searchParams.get("sslmode")).toBe("verify-full");
  });
  it("fails clearly when nothing is configured", () => {
    expect(() => databaseUrl({})).toThrow(/DATABASE_URL/);
  });
});
