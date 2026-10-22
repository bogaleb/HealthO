"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@projectos/ui";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) {
      // Same message for unknown email and wrong password: no account enumeration.
      setError(error.status === 429 ? "Too many attempts. Wait a minute and try again." : "Email or password is incorrect.");
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      // Password accepted; a second factor is required before a session is issued.
      router.replace("/login/two-factor");
      return;
    }
    router.replace("/home");
    router.refresh();
  }

  return (
    <form method="post" onSubmit={submit} className="mt-5 space-y-4" noValidate>
      <Field label="Work email" htmlFor="email">
        <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>
        Sign in
      </Button>
    </form>
  );
}
