import { SignOutButton } from "@/components/SignOutButton";

export default function NoAccess() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-base font-semibold">No active organization access</h1>
        <p className="mt-2 text-sm text-slate-600">Your account is signed in but has no active membership. Ask an administrator to restore your access.</p>
        <div className="mt-4 flex justify-center">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
