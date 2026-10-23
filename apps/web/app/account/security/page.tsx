import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { isPrivileged, mfaRequiredForPrivileged, userHasMfa } from "@projectos/compliance";
import { requireContext } from "@/lib/session";
import { MfaSetup } from "./MfaSetup";

export const metadata: Metadata = { title: "Account security" };
export const dynamic = "force-dynamic";

/** Outside the main app layout on purpose: it must stay reachable while MFA enrollment is being enforced. */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const enabled = await userHasMfa(getDb(), ctx.userId);
  const required = isPrivileged(ctx) && mfaRequiredForPrivileged();
  const sp = await searchParams;
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <h1 className="text-xl font-semibold text-slate-900">Account security</h1>
        <p className="mt-1 text-sm text-slate-600">Signed in as {ctx.displayName}.</p>
        {required && !enabled && (
          <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="mfa-required">
            {sp.required ? "Your role has administrative access. " : ""}Multi-factor authentication is required for your role before you can continue.
          </p>
        )}
        {!required && isPrivileged(ctx) && !enabled && (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
            Your role is privileged. MFA is optional in this synthetic demo but is mandatory before any real-patient use.
          </p>
        )}
        <section className="mt-5 rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)] p-5">
          <MfaSetup enabled={enabled} />
        </section>
        {(!required || enabled) && (
          <p className="mt-4 text-sm">
            <Link className="text-teal-800 underline" href="/home">
              Back to ProjectOS
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
