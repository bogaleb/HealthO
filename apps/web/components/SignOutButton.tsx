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
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-slate-200 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
      </button>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={onClick}
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
    </Button>
  );
}
