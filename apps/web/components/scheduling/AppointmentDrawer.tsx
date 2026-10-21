"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { APPOINTMENT_STATUS_LABEL, MODALITY_LABEL, STATUS_TRANSITIONS, type AppointmentStatus, type Modality } from "@projectos/shared";
import { Badge, Button, Dialog, ErrorState, Field, Input, Spinner, Textarea } from "@projectos/ui";
import { apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";
import { APPT_STATUS_TONE, formatInstant, formatSlot } from "@/lib/format";
import { PolicyPendingBadge } from "./PolicyPending";

type Detail = {
  id: string;
  version: number;
  status: AppointmentStatus;
  modality: Modality;
  startAt: string;
  endAt: string;
  reservedStartAt: string;
  reservedEndAt: string;
  timezone: string;
  patientName: string;
  patientMrn: string | null;
  practitionerId: string;
  practitionerName: string;
  profession: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  siteState: string;
  appointmentTypeId: string;
  typeName: string;
  roomCode: string | null;
  patientLocationState: string | null;
  patientLocationStatus: string;
  providerLocationState: string | null;
  bookingChannel: string;
  dataSource: string;
  eligibilityStatus: string;
  cancelReason: string | null;
  canManage: boolean;
  bookingEnabled: boolean;
  events: { id: string; event: string; fromStatus: string | null; toStatus: string | null; reason: string | null; at: string; actorName: string }[];
};
type SlotResult = { slots: { startAt: string; localStart: string; zone: string; date: string; roomCode: string | null }[] };

const ACTION_LABEL: Partial<Record<AppointmentStatus, string>> = { CHECKED_IN: "Check in", COMPLETED: "Mark completed", NO_SHOW: "Mark no-show" };

/** Appointment drawer driven by `?appt=<id>` (survives reload / back button). */
export function AppointmentDrawer() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const id = sp.get("appt");
  const [a, setA] = useState<Detail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "cancel" | "reschedule">("none");
  const [reason, setReason] = useState("");
  const [rDate, setRDate] = useState("");
  const [slots, setSlots] = useState<SlotResult["slots"] | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(null);
    try {
      setA(await apiFetch<Detail>(`/api/v1/appointments/${id}`));
    } catch (e) {
      setLoadErr(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    setA(null);
    setMode("none");
    setErr(null);
    setReason("");
    setSlots(null);
    void load();
  }, [load]);

  const close = () => {
    const next = new URLSearchParams(sp.toString());
    next.delete("appt");
    const qs = next.toString();
    router.push(qs ? `${path}?${qs}` : path, { scroll: false });
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      setMode("none");
      setReason("");
      setSlots(null);
      await load();
      reliableRefresh(router);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const findSlots = async () => {
    if (!a || !rDate) return;
    setBusy("search");
    setErr(null);
    try {
      const r = await apiFetch<SlotResult>("/api/v1/scheduling/search", {
        method: "POST",
        body: { appointmentTypeId: a.appointmentTypeId, modality: a.modality, siteId: a.siteId, practitionerId: a.practitionerId, fromDate: rDate, days: 1 },
      });
      setSlots(r.slots);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const transitions = a ? (STATUS_TRANSITIONS[a.status] ?? []) : [];
  const editable = a && a.canManage && ["PENDING", "CONFIRMED", "NEEDS_RESCHEDULE"].includes(a.status);

  return (
    <Dialog open={!!id} onClose={close} side title={a ? `${a.typeName}` : "Appointment"} description={a ? formatSlot(a.startAt, a.timezone) : undefined}>
      {!a && !loadErr && <Spinner label="Loading appointment" />}
      {loadErr && <ErrorState title="Could not load the appointment" message={loadErr} />}
      {a && (
        <div className="space-y-5 text-sm" data-testid="appointment-drawer">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={APPT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
            <Badge>{MODALITY_LABEL[a.modality]}</Badge>
            <PolicyPendingBadge />
          </div>
          {err && <ErrorState title="Not saved" message={err} />}
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-slate-500">Patient</dt>
            <dd>
              {a.patientName} {a.patientMrn && <span className="font-mono text-xs text-slate-500">{a.patientMrn}</span>}
            </dd>
            <dt className="text-slate-500">Provider</dt>
            <dd>{a.practitionerName}</dd>
            <dt className="text-slate-500">Site</dt>
            <dd>
              {a.siteName} ({a.siteCode}, {a.siteState}){a.roomCode ? ` · Room ${a.roomCode}` : ""}
            </dd>
            <dt className="text-slate-500">Time</dt>
            <dd>
              {formatSlot(a.startAt, a.timezone)} – {formatSlot(a.endAt, a.timezone, { date: false })}
              <span className="block text-xs text-slate-500">
                Reserved {formatSlot(a.reservedStartAt, a.timezone, { date: false })} – {formatSlot(a.reservedEndAt, a.timezone, { date: false })} incl. buffers · zone {a.timezone}
              </span>
            </dd>
            <dt className="text-slate-500">Patient location</dt>
            <dd>
              {a.patientLocationState ?? "Unknown"} <span className="text-xs text-slate-500">({a.patientLocationStatus.toLowerCase()} — at time of visit, not home address)</span>
            </dd>
            <dt className="text-slate-500">Provider location</dt>
            <dd>{a.providerLocationState ?? "—"}</dd>
            <dt className="text-slate-500">Booked via</dt>
            <dd>
              {a.bookingChannel.toLowerCase()} · source {a.dataSource}
            </dd>
            {a.cancelReason && (
              <>
                <dt className="text-slate-500">Cancel reason</dt>
                <dd>{a.cancelReason}</dd>
              </>
            )}
          </dl>

          {a.canManage && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap gap-2">
                {transitions.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant="secondary"
                    loading={busy === t}
                    onClick={() => run(t, () => apiFetch(`/api/v1/appointments/${a.id}/status`, { method: "POST", body: { status: t, version: a.version } }))}
                  >
                    {ACTION_LABEL[t] ?? t}
                  </Button>
                ))}
                {editable && a.bookingEnabled && (
                  <Button size="sm" variant="secondary" onClick={() => setMode(mode === "reschedule" ? "none" : "reschedule")} aria-expanded={mode === "reschedule"}>
                    Reschedule
                  </Button>
                )}
                {editable && (
                  <Button size="sm" variant="danger" onClick={() => setMode(mode === "cancel" ? "none" : "cancel")} aria-expanded={mode === "cancel"}>
                    Cancel appointment
                  </Button>
                )}
              </div>
              {mode === "cancel" && (
                <form
                  method="post"
                  className="space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("cancel", () => apiFetch(`/api/v1/appointments/${a.id}/cancel`, { method: "POST", body: { version: a.version, reason } }));
                  }}
                >
                  <Field label="Reason (no clinical details) *" htmlFor="cancel-reason">
                    <Textarea id="cancel-reason" rows={2} required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  <p className="text-xs text-slate-600">The time is released immediately. No patient message is sent (outbound messages are not enabled).</p>
                  <Button type="submit" size="sm" variant="danger" loading={busy === "cancel"}>
                    Confirm cancellation
                  </Button>
                </form>
              )}
              {mode === "reschedule" && (
                <div className="space-y-2 rounded-md border border-slate-200 p-3">
                  <p className="text-xs text-slate-600">Same provider, type and site. The move is atomic: if the new time is taken, the original booking stays exactly as it is.</p>
                  <div className="flex items-end gap-2">
                    <Field label="New date" htmlFor="rs-date">
                      <Input id="rs-date" type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} />
                    </Field>
                    <Button size="sm" variant="secondary" loading={busy === "search"} onClick={findSlots} disabled={!rDate}>
                      Find times
                    </Button>
                  </div>
                  <Field label="Reason *" htmlFor="rs-reason">
                    <Input id="rs-reason" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  {slots && slots.length === 0 && <p className="text-xs text-slate-600">No free times that day.</p>}
                  {slots && slots.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Available times">
                      {slots.map((s) => (
                        <button
                          key={s.startAt}
                          role="listitem"
                          type="button"
                          disabled={!reason.trim() || busy === "move"}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs tabular-nums hover:border-teal-600 hover:bg-teal-50 disabled:opacity-50"
                          onClick={() => run("move", () => apiFetch(`/api/v1/appointments/${a.id}`, { method: "PATCH", body: { version: a.version, startAt: s.startAt, reason } }))}
                        >
                          {s.localStart} {s.zone}
                        </button>
                      ))}
                    </div>
                  )}
                  {slots && slots.length > 0 && !reason.trim() && <p className="text-xs text-amber-800">Enter a reason, then pick a time.</p>}
                </div>
              )}
            </div>
          )}

          <section className="border-t border-slate-200 pt-4">
            <h3 className="text-[13px] font-semibold">History (append-only)</h3>
            <ol className="mt-2 space-y-1.5">
              {a.events.map((e) => (
                <li key={e.id} className="text-[12.5px]">
                  <span className="font-medium">{e.event.replace("_", " ").toLowerCase()}</span>
                  {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus ? ` (${e.fromStatus} → ${e.toStatus})` : ""} by {e.actorName} · {formatInstant(e.at, a.timezone)}
                  {e.reason && <span className="block text-slate-500">“{e.reason}”</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Dialog>
  );
}
