"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select } from "@projectos/ui";
import { apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: (r: unknown) => string) => {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: ok(r) });
      reliableRefresh(router);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  return { busy, msg, run };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-slate-700" : "font-medium text-red-700"}`}>
      {msg.text}
    </p>
  );
}

type RunResult = { ok?: boolean; health?: { ok: boolean; detail: string }; availability?: { ok: boolean; imported?: number; removed?: number; error?: string } };

/** Sync / reconcile / simulator controls for one connection. Only rendered for integrations.manage. */
export function ConnectionControls({
  connectionId,
  simulator,
  failureMode,
  synced,
}: {
  connectionId: string;
  simulator: boolean;
  failureMode: string | null;
  synced: { id: string; label: string }[];
}) {
  const { busy, msg, run } = useAction();
  const [mode, setMode] = useState(failureMode ?? "NONE");
  const [appt, setAppt] = useState(synced[0]?.id ?? "");
  return (
    <div className="space-y-2" data-testid="connection-controls">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={busy === "sync"}
          onClick={() =>
            run(
              "sync",
              () => apiFetch<RunResult>(`/api/v1/integrations/connections/${connectionId}/sync`, { method: "POST" }),
              (r) => {
                const x = r as RunResult;
                if (!x.ok) return `Sync not done: ${x.health?.detail ?? "EHR unavailable"}. The site stays/turns stale — booking fails closed.`;
                return `Synced: ${x.availability?.imported ?? 0} EHR busy block(s) imported, ${x.availability?.removed ?? 0} released.`;
              },
            )
          }
        >
          Sync now
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={busy === "reconcile"}
          onClick={() =>
            run(
              "reconcile",
              () =>
                apiFetch<{ ok: boolean; checked?: number; conflicts?: number; missing?: number; requeued?: number; error?: string }>(
                  `/api/v1/integrations/connections/${connectionId}/reconcile`,
                  { method: "POST" },
                ),
              (r) => {
                const x = r as { ok: boolean; checked?: number; conflicts?: number; missing?: number; requeued?: number; error?: string };
                return x.ok
                  ? `Reconciled ${x.checked} mapping(s): ${x.conflicts} new conflict(s), ${x.missing} missing in EHR, ${x.requeued} write(s) re-queued.`
                  : `Reconciliation failed: ${x.error}`;
              },
            )
          }
        >
          Reconcile now
        </Button>
      </div>
      {simulator && (
        <div className="rounded-md border border-dashed border-violet-300 bg-violet-50/50 p-2.5">
          <p className="mb-1.5 text-[12px] font-semibold text-violet-900">Rehearsal controls (synthetic simulator only)</p>
          <form
            className="flex flex-wrap items-end gap-2"
            aria-label="Simulator failure mode"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                "mode",
                () => apiFetch(`/api/v1/integrations/connections/${connectionId}/simulator`, { method: "POST", body: { failureMode: mode } }),
                () => `Simulator failure mode set to ${mode}.`,
              );
            }}
          >
            <div>
              <label htmlFor={`sim-mode-${connectionId}`} className="block text-xs font-medium text-slate-600">
                Simulated EHR behaviour
              </label>
              <Select id={`sim-mode-${connectionId}`} className="h-8 w-56 text-[13px]" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="NONE">Normal</option>
                <option value="UNREACHABLE">Outage (unreachable)</option>
                <option value="FAIL_WRITES">Writes fail (503)</option>
                <option value="TIMEOUT_AFTER_WRITE">Timeout after write</option>
              </Select>
            </div>
            <Button size="sm" type="submit" variant="secondary" loading={busy === "mode"}>
              Apply
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "book"}
              onClick={() =>
                run(
                  "book",
                  () => apiFetch(`/api/v1/integrations/connections/${connectionId}/simulate`, { method: "POST", body: { kind: "BOOK_IN_EHR" } }),
                  () => "Booked 1 hour directly in the synthetic EHR (tomorrow). Sync to import it as busy.",
                )
              }
            >
              Book in EHR directly
            </Button>
            {synced.length > 0 && (
              <>
                <div>
                  <label htmlFor={`sim-appt-${connectionId}`} className="block text-xs font-medium text-slate-600">
                    Synced appointment
                  </label>
                  <Select id={`sim-appt-${connectionId}`} className="h-8 w-60 text-[13px]" value={appt} onChange={(e) => setAppt(e.target.value)}>
                    {synced.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === "cancel"}
                  onClick={() =>
                    run(
                      "cancel",
                      () => apiFetch(`/api/v1/integrations/connections/${connectionId}/simulate`, { method: "POST", body: { kind: "CANCEL_IN_EHR", appointmentId: appt } }),
                      () => "Cancelled in the synthetic EHR. Sync to see the conflict.",
                    )
                  }
                >
                  Cancel it in EHR
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === "move"}
                  onClick={() =>
                    run(
                      "move",
                      () =>
                        apiFetch(`/api/v1/integrations/connections/${connectionId}/simulate`, { method: "POST", body: { kind: "MOVE_IN_EHR", appointmentId: appt, minutes: 30 } }),
                      () => "Moved +30 min in the synthetic EHR. Sync to see the conflict.",
                    )
                  }
                >
                  Move it in EHR
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <Msg msg={msg} />
    </div>
  );
}

export function SiteModeForm({ siteId, mode, freshness, connected }: { siteId: string; mode: string; freshness: number; connected: boolean }) {
  const { busy, msg, run } = useAction();
  const [m, setM] = useState(mode);
  const [f, setF] = useState(String(freshness));
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label="Source of truth"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          "mode",
          () => apiFetch(`/api/v1/integrations/sites/${siteId}/mode`, { method: "PATCH", body: { ehrSyncMode: m, ehrFreshnessMinutes: Number(f) } }),
          () => `Source of truth set to ${m}.`,
        );
      }}
    >
      <div>
        <label htmlFor={`mode-${siteId}`} className="block text-xs font-medium text-slate-600">
          Source of truth
        </label>
        <Select id={`mode-${siteId}`} className="h-8 w-52 text-[13px]" value={m} onChange={(e) => setM(e.target.value)}>
          <option value="DEMO">DEMO (synthetic)</option>
          <option value="EHR_MASTER">EHR_MASTER (EHR is authoritative)</option>
          <option value="READ_ONLY">READ_ONLY (book in the EHR)</option>
          <option value="STANDALONE_APPROVED">STANDALONE_APPROVED (needs approval)</option>
        </Select>
      </div>
      <div>
        <label htmlFor={`fresh-${siteId}`} className="block text-xs font-medium text-slate-600">
          Freshness limit (min)
        </label>
        <input
          id={`fresh-${siteId}`}
          type="number"
          min={5}
          max={1440}
          value={f}
          onChange={(e) => setF(e.target.value)}
          className="h-8 w-24 rounded-md border border-slate-300 px-2 text-[13px]"
        />
      </div>
      <Button size="sm" type="submit" variant="secondary" loading={busy === "mode"}>
        Save
      </Button>
      {m === "EHR_MASTER" && !connected && <span className="text-xs text-amber-800">No verified EHR connection: bookings here can only be saved as drafts.</span>}
      <div className="w-full">
        <Msg msg={msg} />
      </div>
    </form>
  );
}

export function ConnectSimulatorButton({ siteId }: { siteId: string }) {
  const { busy, msg, run } = useAction();
  return (
    <div>
      <Button
        size="sm"
        variant="secondary"
        loading={!!busy}
        onClick={() =>
          run(
            "c",
            () => apiFetch("/api/v1/integrations/connections", { method: "POST", body: { siteId } }),
            () => "Synthetic simulator connected.",
          )
        }
      >
        Connect synthetic simulator
      </Button>
      <Msg msg={msg} />
    </div>
  );
}

export function ConflictActions({ id, kind, canRetry }: { id: string; kind: string; canRetry: boolean }) {
  const { busy, msg, run } = useAction();
  const go = (action: string) =>
    run(
      action,
      () => apiFetch(`/api/v1/integrations/conflicts/${id}/resolve`, { method: "POST", body: { action } }),
      () => `Conflict ${action === "DISMISS" ? "dismissed" : "resolved"}.`,
    );
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {kind === "EXTERNAL_CANCELLED" && (
        <Button size="sm" loading={busy === "ACCEPT_EHR"} onClick={() => go("ACCEPT_EHR")}>
          Accept EHR (cancel here)
        </Button>
      )}
      {canRetry && (
        <Button size="sm" loading={busy === "RETRY"} onClick={() => go("RETRY")}>
          Retry write
        </Button>
      )}
      <Button size="sm" variant="secondary" loading={busy === "RESOLVED"} onClick={() => go("RESOLVED")}>
        Mark resolved
      </Button>
      <Button size="sm" variant="ghost" loading={busy === "DISMISS"} onClick={() => go("DISMISS")}>
        Dismiss
      </Button>
      <div className="w-full text-right">
        <Msg msg={msg} />
      </div>
    </div>
  );
}
