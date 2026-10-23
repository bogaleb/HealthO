import type { Metadata } from "next";
import Link from "next/link";
import { TwoFactorForm } from "./TwoFactorForm";
import { AuthStage, StageCard } from "@/components/auth/AuthStage";

export const metadata: Metadata = { title: "Verify sign-in" };
export const dynamic = "force-dynamic";

export default function TwoFactorPage() {
  return (
    <AuthStage>
      <StageCard>
        <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-slate-900">Two-step verification</h1>
        <p className="mt-1 text-sm text-slate-500">Your account uses multi-factor authentication. Enter the current code to finish signing in.</p>
        <TwoFactorForm />
      </StageCard>
      <p className="mt-5 text-center text-[13px] text-slate-400">
        <Link className="text-[#c3cff0] underline underline-offset-2 hover:text-white" href="/login">
          Back to sign in
        </Link>
      </p>
    </AuthStage>
  );
}
