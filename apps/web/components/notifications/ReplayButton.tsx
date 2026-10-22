"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@projectos/ui";
import { apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";

export function ReplayButton({ path, label }: { path: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        aria-label={label}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await apiFetch(path, { method: "POST" });
            reliableRefresh(router);
          } catch (e) {
            setErr(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Replay
      </Button>
      {err && (
        <span role="alert" className="text-xs text-red-700">
          {err}
        </span>
      )}
    </span>
  );
}

export function RunScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = await apiFetch<{ rcm: { queued: number }; tasks: { queued: number }; dispatch: { delivered: number; failed: number } }>("/api/v1/jobs/notifications-scan", {
              method: "POST",
            });
            setMsg(`Queued ${r.rcm.queued + r.tasks.queued} new reminder(s); delivered ${r.dispatch.delivered}, failed ${r.dispatch.failed}.`);
            reliableRefresh(router);
          } catch (e) {
            setMsg(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Run reminder scan now
      </Button>
      {msg && (
        <span role="status" className="text-sm text-slate-600">
          {msg}
        </span>
      )}
    </span>
  );
}
