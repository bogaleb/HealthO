import { describe, expect, it } from "vitest";
import { can, hasAny, hasOrgWide, scopeFilter, type AuthContext } from "@projectos/auth";
import { occurrencesBetween } from "../src/projects/recurring";

const ctx = (grants: AuthContext["grants"]): AuthContext => ({ userId: "u", organizationId: "o", membershipId: "m", displayName: "x", grants });

describe("permission evaluation", () => {
  it("org-wide grants match any scope", () => {
    const c = ctx([{ permission: "projects.edit", siteId: null, departmentId: null }]);
    expect(can(c, "projects.edit")).toBe(true);
    expect(can(c, "projects.edit", { siteId: "s1" })).toBe(true);
    expect(can(c, "projects.read")).toBe(false);
  });
  it("site-scoped grants match only that site and never org-level resources", () => {
    const c = ctx([{ permission: "sites.manage", siteId: "s1", departmentId: null }]);
    expect(can(c, "sites.manage", { siteId: "s1" })).toBe(true);
    expect(can(c, "sites.manage", { siteId: "s2" })).toBe(false);
    expect(can(c, "sites.manage", {})).toBe(false);
    expect(hasAny(c, "sites.manage")).toBe(true);
    expect(hasOrgWide(c, "sites.manage")).toBe(false);
  });
  it("department scope and scope filters", () => {
    const c = ctx([
      { permission: "projects.read", siteId: null, departmentId: "d1" },
      { permission: "projects.read", siteId: "s9", departmentId: null },
    ]);
    expect(can(c, "projects.read", { departmentId: "d1" })).toBe(true);
    expect(can(c, "projects.read", { departmentId: "d2" })).toBe(false);
    expect(scopeFilter(c, "projects.read")).toEqual({ all: false, siteIds: ["s9"], departmentIds: ["d1"] });
    expect(scopeFilter(c, "audit.read")).toEqual({ all: false, siteIds: [], departmentIds: [] });
  });
  it("no grants means deny by default", () => {
    expect(can(ctx([]), "projects.read")).toBe(false);
  });
});

describe("recurrence", () => {
  const base = { startOn: "2026-11-01", weekday: null, monthDay: null };
  it("daily from start through today, resuming after last generated", () => {
    expect(occurrencesBetween({ ...base, cadence: "DAILY" }, null, "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(occurrencesBetween({ ...base, cadence: "DAILY" }, "2026-11-02", "2026-11-03")).toEqual(["2026-11-03"]);
    expect(occurrencesBetween({ ...base, cadence: "DAILY" }, "2026-11-03", "2026-11-03")).toEqual([]);
  });
  it("weekly and monthly", () => {
    expect(occurrencesBetween({ ...base, cadence: "WEEKLY", weekday: 1 }, null, "2026-11-20")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(occurrencesBetween({ ...base, cadence: "MONTHLY", monthDay: 15 }, null, "2027-01-20")).toEqual(["2026-11-15", "2026-12-15", "2027-01-15"]);
  });
  it("caps catch-up generation", () => {
    expect(occurrencesBetween({ ...base, cadence: "DAILY" }, null, "2027-12-31", 10)).toHaveLength(10);
  });
});
