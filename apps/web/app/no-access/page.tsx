import { SignOutButton } from "@/components/SignOutButton";
import { AuthStage, StageCard } from "@/components/auth/AuthStage";

export default function NoAccess() {
  return (
    <AuthStage>
      <StageCard>
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">No active organization access</h1>
        <p className="mt-2 text-sm text-slate-600">Your account is signed in but has no active membership. Ask an administrator to restore your access.</p>
        <div className="mt-4 flex justify-center">
          <SignOutButton />
        </div>
      </StageCard>
    </AuthStage>
  );
}
