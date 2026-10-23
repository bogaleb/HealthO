import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { appMode, isSyntheticMode } from "@projectos/shared";
import { getRequestContext } from "@/lib/session";
import { LoginForm } from "./LoginForm";
import { AuthStage, StageCard } from "@/components/auth/AuthStage";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const DEMO_EMAILS = [
  ["avery.admin@riverbend.example", "Organization Administrator"],
  ["pat.morgan@riverbend.example", "Project Manager + Executive"],
  ["riley.shah@riverbend.example", "RCM Analyst (Revenue Cycle dept only)"],
  ["taylor.nguyen@riverbend.example", "Revenue Cycle Supervisor"],
  ["dana.brooks@riverbend.example", "Compliance Officer (PHI readiness checklist)"],
  ["casey.lin@riverbend.example", "Credentialing Specialist (Credentialing dept only)"],
  ["sam.ortiz@riverbend.example", "Scheduler (Alexandria site only)"],
  ["jordan.kim@riverbend.example", "Auditor"],
] as const;

export default async function LoginPage() {
  const r = await getRequestContext();
  if (r?.ctx) redirect("/home");
  const mode = appMode();
  const showDemo = isSyntheticMode(mode);
  return (
    <AuthStage hero>
      <StageCard>
        <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Staff accounts are created by invitation.</p>
        <LoginForm />
        <p className="mt-5 border-t border-[var(--hairline)] pt-4 text-center text-[13px] text-slate-500">
          Have an invitation code?{" "}
          <a className="font-medium text-teal-700 underline decoration-teal-300 underline-offset-2 hover:decoration-teal-700" href="/invite">
            Accept invitation
          </a>
        </p>
      </StageCard>
      {showDemo && (
        <details
          className="rise group mt-4 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] text-[13px] text-amber-50 backdrop-blur"
          style={{ ["--d" as string]: "420ms" }}
          open
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold text-amber-200">
            Synthetic demo ({mode}): fictional accounts
            <span aria-hidden className="text-amber-200/70 transition-transform duration-300 group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="px-4 pb-4">
            <p className="text-amber-50/90">
              The password is the <code className="rounded bg-white/10 px-1">DEMO_PASSWORD</code> value in your local <code className="rounded bg-white/10 px-1">.env</code>. Never
              enter real patient information.
            </p>
            <ul className="mt-2.5 space-y-1">
              {DEMO_EMAILS.map(([e, role]) => (
                <li key={e} className="flex flex-col">
                  <span className="text-[12.5px] text-white">{e}</span>
                  <span className="text-[12px] text-amber-50/70">{role}</span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </AuthStage>
  );
}
