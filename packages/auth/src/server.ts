import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { hashPassword } from "better-auth/crypto";
import { getDb } from "@projectos/db";
import { accounts, sessions, users, verifications } from "@projectos/db/schema";

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
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
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
    rateLimit: { enabled: true, window: 60, max: 60, customRules: { "/sign-in/email": { window: 60, max: 10 } } },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: baseURL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    telemetry: { enabled: false },
    plugins: [nextCookies()],
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
