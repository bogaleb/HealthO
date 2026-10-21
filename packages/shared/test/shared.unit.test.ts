import { describe, expect, it } from "vitest";
import { addDays, isValidTimeZone, redact, siteCreate, todayIn, weekdayOf } from "../src";

describe("validation", () => {
  it("strips a forged organizationId from inputs", () => {
    const r = siteCreate.parse({ code: "abc", name: "X", state: "VA", timezone: "America/New_York", organizationId: "evil" });
    expect(r).not.toHaveProperty("organizationId");
    expect(r.code).toBe("ABC");
  });
  it("validates time zones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("EST")).toBe(false);
  });
});

describe("dates", () => {
  it("computes local date across UTC midnight", () => {
    expect(todayIn("America/New_York", new Date("2026-11-03T03:30:00Z"))).toBe("2026-11-02");
    expect(todayIn("UTC", new Date("2026-11-03T03:30:00Z"))).toBe("2026-11-03");
  });
  it("adds days across DST boundaries and month ends", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(weekdayOf("2026-10-20")).toBe(2);
  });
});

describe("log redaction", () => {
  it("redacts sensitive keys recursively", () => {
    const out = redact({ email: "a@b.c", nested: { password: "x", ok: 1, patientName: "Demo" }, list: [{ token: "t" }] }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/a@b\.c|"x"|Demo|"t"/);
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
  });
});
