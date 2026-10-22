import type { Metadata } from "next";
import Link from "next/link";
import { TwoFactorForm } from "./TwoFactorForm";

export const metadata: Metadata = { title: "Verify sign-in" };
export const dynamic = "force-dynamic";

export default function TwoFactorPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-xl bg-white p-6 shadow-xl">
          <h1 className="text-base font-semibold text-slate-900">Two-step verification</h1>
          <p className="mt-1 text-sm text-slate-500">Your account uses multi-factor authentication. Enter the current code to finish signing in.</p>
          <TwoFactorForm />
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">
          <Link className="text-teal-300 underline" href="/login">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
