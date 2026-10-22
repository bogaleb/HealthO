import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { hashPassword } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins/two-factor";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { getDb } from "@projectos/db";
import { accounts, auditEvents, memberships, sessions, twoFactors, users, verifications } from "@projectos/db/schema";

/** MFA lifecycle events are security-relevant: record them in our append-only audit log (no codes, no secrets). */
const MFA_AUDIT: Record<string, string> = {
  "/two-factor/enable": "mfa.enable_started",
  "/two-factor/verify-totp": "mfa.verify",
  "/two-factor/verify-backup-code": "mfa.verify_backup_code",
  "/two-factor/disable": "mfa.disable",
  "/two-factor/generate-backup-codes": "mfa.backup_codes_regenerated",
};

async function auditMfa(path: string, userId: string | undefined, ok: boolean) {
  const action = MFA_AUDIT[path];
  if (!action || !userId) return;
  const db = getDb();
  const [m] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "ACTIVE")));
  await db.insert(auditEvents).values({
    organizationId: m?.organizationId ?? null,
    actorType: "USER",
    actorUserId: userId,
    action,
    resourceType: "user",
    resourceId: userId,
    outcome: ok ? "ALLOW" : "DENY",
    metadata: {},
  });
}

function buildAuth() {
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters.");
  }
  return betterAuth({
    appName: "ProjectOS Health",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications, twoFactor: twoFactors },
    }),
    emailAndPassword: {
      enabled: true,
      // Staff accounts are created only by invitation (or the synthetic seed). No public sign-up.
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 8, // 8h working session
      updateAge: 60 * 30, // rolling refresh every 30 min of activity
    },
    // Sign-in attempts per IP per minute (lower in production; E2E raises it via env because it signs in repeatedly).
    rateLimit: { enabled: true, window: 60, max: 100, customRules: { "/sign-in/email": { window: 60, max: Number(process.env.AUTH_SIGNIN_MAX_PER_MIN ?? 10) } } },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: baseURL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    telemetry: { enabled: false },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (!MFA_AUDIT[ctx.path]) return;
        const failed = isAPIError(ctx.context.returned);
        const userId = ctx.context.newSession?.user.id ?? ctx.context.session?.user.id;
        try {
          await auditMfa(ctx.path, userId, !failed);
        } catch {
          /* audit failure must not break sign-in; logged by the DB */
        }
      }),
    },
    // TOTP (authenticator app) + one-time backup codes. Secrets are encrypted with BETTER_AUTH_SECRET by Better Auth.
    plugins: [twoFactor({ issuer: "ProjectOS Health", backupCodeOptions: { amount: 8, length: 10 } }), nextCookies()],
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;
const g = globalThis as unknown as { __projectosAuth?: AuthInstance };

export function getAuth(): AuthInstance {
  if (!g.__projectosAuth) g.__projectosAuth = buildAuth();
  return g.__projectosAuth;
}

/** Hash a password with Better Auth's configured algorithm (used by seed + invite acceptance). */
export async function hashUserPassword(password: string): Promise<string> {
  return hashPassword(password);
}
