import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { appMode, isSyntheticMode } from "@projectos/shared";
import { getRequestContext } from "@/lib/session";
import { LoginForm } from "./LoginForm";

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
    <main className="flex min-h-dvh items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold tracking-tight text-white">ProjectOS Health</div>
          <p className="mt-1 text-sm text-slate-400">Healthcare operations workspace</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-xl">
          <h1 className="text-base font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Staff accounts are created by invitation.</p>
          <LoginForm />
        </div>
        {showDemo && (
          <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-50/95 p-4 text-[13px] text-amber-950">
            <p className="font-semibold">SYNTHETIC DEMO ({mode})</p>
            <p className="mt-1">
              Seeded fictional accounts — the password is the <code className="rounded bg-amber-100 px-1">DEMO_PASSWORD</code> value in your local{" "}
              <code className="rounded bg-amber-100 px-1">.env</code>. Never enter real patient information.
            </p>
            <ul className="mt-2 space-y-0.5">
              {DEMO_EMAILS.map(([e, role]) => (
                <li key={e}>
                  <span className="font-mono text-[12px]">{e}</span> — {role}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-4 text-center text-xs text-slate-400">
          Have an invitation code?{" "}
          <a className="text-teal-300 underline" href="/invite">
            Accept invitation
          </a>
        </p>
      </div>
    </main>
  );
}
