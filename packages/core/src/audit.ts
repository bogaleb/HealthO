import type { DbOrTx } from "@projectos/db";
import { auditEvents } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { redact } from "@projectos/shared";

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: "ALLOW" | "DENY" | "ERROR";
  /** IDs and changed field NAMES only — never values that could be PHI. */
  metadata?: Record<string, unknown>;
}

export async function audit(db: DbOrTx, actor: AuthContext | { system: string; organizationId: string | null }, e: AuditInput) {
  const isSystem = "system" in actor;
  await db.insert(auditEvents).values({
    organizationId: actor.organizationId,
    actorType: isSystem ? "SYSTEM" : "USER",
    actorUserId: isSystem ? null : actor.userId,
    action: e.action,
    resourceType: e.resourceType,
    resourceId: e.resourceId ?? null,
    outcome: e.outcome ?? "ALLOW",
    requestId: isSystem ? null : (actor.requestId ?? null),
    metadata: redact({ ...(e.metadata ?? {}), ...(isSystem ? { system: actor.system } : {}) }) as Record<string, unknown>,
  });
}
