import { inArray, type SQL, sql, type Column } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { can, hasAny, scopeFilter, type AuthContext } from "@projectos/auth";
import { authorize } from "@projectos/core";
import { AppError, isSyntheticMode, type Permission } from "@projectos/shared";

/**
 * Booking is a synthetic demo until the Phase 5 policy engine and the PHI go-live gate exist.
 * It requires BOTH a synthetic APP_MODE and the explicit SCHEDULING_MODE=DEMO_ONLY flag.
 */
export function bookingEnabled(): boolean {
  return isSyntheticMode() && process.env.SCHEDULING_MODE === "DEMO_ONLY";
}

export function assertBookingEnabled() {
  if (!bookingEnabled())
    throw new AppError(
      "BOOKING_DISABLED",
      "Booking is disabled. It is available only as a synthetic demo (APP_MODE=DEVELOPMENT or DEMO_SYNTHETIC with SCHEDULING_MODE=DEMO_ONLY).",
    );
}

/** Sites the caller may see for a scheduling permission (null = all sites). */
export function siteScope(ctx: AuthContext, perm: Permission): string[] | null {
  const f = scopeFilter(ctx, perm);
  return f.all ? null : f.siteIds;
}

/** SQL filter on a site_id column for a permission. */
export function siteWhere(ctx: AuthContext, perm: Permission, column: Column): SQL {
  const s = siteScope(ctx, perm);
  if (s === null) return sql`true`;
  if (!s.length) return sql`false`;
  return inArray(column, s);
}

/** Require a permission at a site; denials are audited. */
export async function requireAtSite(db: Db, ctx: AuthContext, perm: Permission, siteId: string, action: string, resourceType = "site", resourceId: string | null = siteId) {
  if (can(ctx, perm, { siteId })) return;
  await authorize(db, ctx, perm, { siteId }, { action, resourceType, resourceId });
}

export async function requireAnywhere(db: Db, ctx: AuthContext, perm: Permission, action: string, resourceType: string) {
  if (hasAny(ctx, perm)) return;
  await authorize(db, ctx, perm, "ANY", { action, resourceType });
}
