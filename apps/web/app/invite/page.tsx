"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@projectos/ui";
import { apiFetch, errorMessage } from "@/lib/client";
import { AuthStage, StageCard } from "@/components/auth/AuthStage";

export default function InvitePage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ email: string }>("/api/v1/invites/accept", { method: "POST", body: { token: token.trim(), password } });
      setDone(r.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthStage>
      <StageCard>
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">Accept invitation</h1>
        {done ? (
          <div className="mt-4 space-y-3 text-sm">
            <p role="status">
              Your account <strong>{done}</strong> is ready.
            </p>
            <Link className="font-medium text-teal-700 underline" href="/login">
              Continue to sign in
            </Link>
          </div>
        ) : (
          <form method="post" onSubmit={submit} className="mt-4 space-y-4">
            <p className="text-sm text-slate-500">Paste the one-time invitation code your administrator gave you and choose a password (12+ characters).</p>
            <Field label="Invitation code" htmlFor="token">
              <Input id="token" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
            </Field>
            <Field label="New password" htmlFor="pw" hint="At least 12 characters.">
              <Input id="pw" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Field label="Confirm password" htmlFor="pw2">
              <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </Field>
            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" loading={busy} disabled={!token || password.length < 12}>
              Create account
            </Button>
          </form>
        )}
      </StageCard>
    </AuthStage>
  );
}
