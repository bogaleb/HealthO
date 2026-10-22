"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@projectos/ui";
import { authClient } from "@/lib/auth-client";

/** Second sign-in step: 6-digit authenticator code, or a one-time backup code. */
export function TwoFactorForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const value = code.replace(/\s+/g, "");
    const { error } = backup ? await authClient.twoFactor.verifyBackupCode({ code: value }) : await authClient.twoFactor.verifyTotp({ code: value });
    setBusy(false);
    if (error) {
      setError(
        error.status === 401 && /expired|session/i.test(error.message ?? "")
          ? "This sign-in attempt expired. Start again from the sign-in page."
          : error.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : "That code is not valid.",
      );
      return;
    }
    router.replace("/home");
    router.refresh();
  }

  return (
    <form method="post" onSubmit={submit} className="mt-5 space-y-4" noValidate>
      <Field label={backup ? "Backup code" : "6-digit code from your authenticator app"} htmlFor="mfa-code">
        <Input
          id="mfa-code"
          autoComplete="one-time-code"
          inputMode={backup ? "text" : "numeric"}
          autoFocus
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={backup ? 24 : 8}
        />
      </Field>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy} disabled={!code}>
        Verify
      </Button>
      <button
        type="button"
        className="w-full text-center text-sm text-teal-800 underline"
        onClick={() => {
          setBackup(!backup);
          setCode("");
          setError(null);
        }}
      >
        {backup ? "Use the authenticator app instead" : "Use a backup code instead"}
      </button>
    </form>
  );
}
