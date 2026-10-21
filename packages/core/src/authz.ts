import type { Db } from "@projectos/db";
import { can, hasAny, type AuthContext, type Scope } from "@projectos/auth";
import { forbidden, type Permission } from "@projectos/shared";
import { audit } from "./audit";

/**
 * Enforce a permission for a resource scope. Denials of sensitive actions are audited
 * (outside any business transaction so the record survives the rollback).
 */
export async function authorize(
  db: Db,
  ctx: AuthContext,
  perm: Permission,
  scope: Scope | "ANY",
  denyAudit?: { action: string; resourceType: string; resourceId?: string | null },
) {
  const ok = scope === "ANY" ? hasAny(ctx, perm) : can(ctx, perm, scope);
  if (ok) return;
  if (denyAudit) {
    await audit(db, ctx, { ...denyAudit, outcome: "DENY", metadata: { permission: perm } });
  }
  throw forbidden();
}
