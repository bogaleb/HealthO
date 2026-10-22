"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@projectos/ui";
import { authClient } from "@/lib/auth-client";

const msgOf = (e: { status?: number; message?: string } | null | undefined, fallback: string) =>
  e?.status === 429 ? "Too many attempts. Wait a minute and try again." : /password/i.test(e?.message ?? "") ? "Password is incorrect." : fallback;

/** TOTP enrollment (authenticator app) with one-time backup codes; disable/regenerate need the password again. */
export function MfaSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password, method: "totp" });
    setBusy(false);
    if (error || !data || !("totpURI" in data)) return setError(msgOf(error, "Could not start MFA setup."));
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ secret, uri: data.totpURI, backupCodes: data.backupCodes });
    setPassword("");
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s+/g, "") });
    setBusy(false);
    if (error) return setError("That code is not valid. Check the time on your device and try the next code.");
    setSetup(null);
    setCode("");
    router.refresh();
  }
  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (error) return setError(msgOf(error, "Could not turn MFA off."));
    setPassword("");
    router.refresh();
  }
  async function regenerate() {
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    setBusy(false);
    if (error || !data) return setError(msgOf(error, "Could not create new backup codes."));
    setCodes(data.backupCodes);
    setPassword("");
  }

  const err = error && (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
    </p>
  );

  if (enabled)
    return (
      <form onSubmit={disable} method="post" className="space-y-3" aria-label="Manage MFA">
        <p className="text-sm text-green-800" data-testid="mfa-status">
          Multi-factor authentication is ON for your account.
        </p>
        <Field label="Current password (to change MFA)" htmlFor="mfa-pw">
          <Input id="mfa-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {err}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={!password} loading={busy} onClick={regenerate}>
            New backup codes
          </Button>
          <Button type="submit" variant="danger" disabled={!password} loading={busy}>
            Turn MFA off
          </Button>
        </div>
        {codes && <BackupCodes codes={codes} />}
      </form>
    );

  if (!setup)
    return (
      <form onSubmit={start} method="post" className="space-y-3" aria-label="Set up MFA">
        <p className="text-sm text-slate-700" data-testid="mfa-status">
          Multi-factor authentication is OFF. Set it up with an authenticator app (any TOTP app).
        </p>
        <Field label="Current password" htmlFor="mfa-pw">
          <Input id="mfa-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {err}
        <Button type="submit" disabled={!password} loading={busy}>
          Set up MFA
        </Button>
      </form>
    );

  return (
    <form onSubmit={verify} method="post" className="space-y-4" aria-label="Confirm MFA">
      <div>
        <p className="text-sm font-medium text-slate-900">1. Add this account to your authenticator app</p>
        <p className="mt-1 text-[13px] text-slate-600">Choose “enter a setup key” and type this key (time-based, 6 digits, 30 seconds):</p>
        <code className="mt-1 block break-all rounded bg-slate-100 px-2 py-1.5 font-mono text-[13px]" data-testid="mfa-secret">
          {setup.secret}
        </code>
        <details className="mt-1 text-[12px] text-slate-500">
          <summary>Full otpauth link</summary>
          <code className="break-all">{setup.uri}</code>
        </details>
      </div>
      <div>
        <p className="text-sm font-medium text-slate-900">2. Save your backup codes</p>
        <BackupCodes codes={setup.backupCodes} />
      </div>
      <Field label="3. Enter the 6-digit code shown in the app" htmlFor="mfa-code">
        <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} />
      </Field>
      {err}
      <Button type="submit" disabled={!code} loading={busy}>
        Turn on MFA
      </Button>
    </form>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-[12.5px] text-amber-950">Each code works once. Store them somewhere safe (not in this app). They are not shown again.</p>
      <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-[13px]" data-testid="backup-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
