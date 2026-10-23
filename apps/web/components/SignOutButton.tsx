"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@projectos/ui";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  };
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="press inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-slate-200 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-teal-300 disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
      </button>
    );
  }
  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={onClick}>
      <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
    </Button>
  );
}
