"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { APPOINTMENT_STATUS_LABEL, EHR_STATE_LABEL, MODALITY_LABEL, STATUS_TRANSITIONS, US_JURISDICTIONS, type AppointmentStatus, type Modality } from "@projectos/shared";
import { Badge, Button, Dialog, ErrorState, Field, Input, Select, Spinner, Textarea } from "@projectos/ui";
import { ApiError, apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";
import { APPT_STATUS_TONE, formatInstant, formatSlot } from "@/lib/format";
import { DecisionBadge, EligibilityPanel, type EligibilityLike } from "./Eligibility";

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
  payerPlanName: string | null;
  bookingChannel: string;
  dataSource: string;
  eligibilityDecision: "ALLOW" | "REVIEW" | "BLOCK" | null;
  ehrState?: string;
  eligibility: (EligibilityLike & { trigger: string }) | null;
  eligibilityHistory: { id: string; trigger: string; decision: string; jurisdiction: string | null; evaluatedAt: string }[];
  cancelReason: string | null;
  canManage: boolean;
  bookingEnabled: boolean;
  events: { id: string; event: string; fromStatus: string | null; toStatus: string | null; reason: string | null; at: string; actorName: string }[];
};
type SlotResult = { slots: { startAt: string; localStart: string; zone: string; eligibility: { decision: string } }[] };

const ACTION_LABEL: Partial<Record<AppointmentStatus, string>> = { COMPLETED: "Mark completed", NO_SHOW: "Mark no-show" };
const UPCOMING = ["PENDING", "CONFIRMED", "NEEDS_RESCHEDULE"];

/** Appointment drawer driven by `?appt=<id>` (survives reload / back button). */
export function AppointmentDrawer() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const id = sp.get("appt");
  const [a, setA] = useState<Detail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<{ msg: string; alts: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "cancel" | "reschedule" | "checkin" | "location">("none");
  const [reason, setReason] = useState("");
  const [rDate, setRDate] = useState("");
  const [slots, setSlots] = useState<SlotResult["slots"] | null>(null);
  const [loc, setLoc] = useState("");
  const [locConfirmed, setLocConfirmed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(null);
    try {
      const d = await apiFetch<Detail>(`/api/v1/appointments/${id}`);
      setA(d);
      setLoc(d.patientLocationState ?? "");
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
    setLocConfirmed(false);
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
    } catch (e) {
      const alts = e instanceof ApiError ? e.details.filter((d) => d.code === "ELIGIBLE_ALTERNATIVE" || d.code === "ALTERNATIVE").map((d) => d.message!) : [];
      setErr({ msg: errorMessage(e), alts });
    } finally {
      setBusy(null);
      // Eligibility stops (e.g. a stopped check-in) are committed server-side: always reload.
      await load();
      reliableRefresh(router);
    }
  };
  const findSlots = async () => {
    if (!a || !rDate) return;
    setBusy("search");
    setErr(null);
    try {
      const r = await apiFetch<SlotResult>("/api/v1/scheduling/search", {
        method: "POST",
        body: {
          appointmentTypeId: a.appointmentTypeId,
          modality: a.modality,
          siteId: a.siteId,
          practitionerId: a.practitionerId,
          fromDate: rDate,
          days: 1,
          ...(a.patientLocationState ? { patientState: a.patientLocationState } : {}),
        },
      });
      setSlots(r.slots);
    } catch (e) {
      setErr({ msg: errorMessage(e), alts: [] });
    } finally {
      setBusy(null);
    }
  };

  const transitions = a ? (STATUS_TRANSITIONS[a.status] ?? []) : [];
  const upcoming = a && UPCOMING.includes(a.status);
  const telehealth = a?.modality !== "IN_PERSON";

  return (
    <Dialog open={!!id} onClose={close} side title={a ? `${a.typeName}` : "Appointment"} description={a ? formatSlot(a.startAt, a.timezone) : undefined}>
      {!a && !loadErr && <Spinner label="Loading appointment" />}
      {loadErr && <ErrorState title="Could not load the appointment" message={loadErr} />}
      {a && (
        <div className="space-y-5 text-sm" data-testid="appointment-drawer">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={APPT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
            <Badge>{MODALITY_LABEL[a.modality]}</Badge>
            <DecisionBadge decision={a.eligibility?.decision ?? a.eligibilityDecision} stale={a.eligibility?.stale} />
            {a.ehrState && a.ehrState !== "NOT_APPLICABLE" && (
              <Badge tone={a.ehrState === "SYNCED" ? "green" : a.ehrState === "FAILED" || a.ehrState === "CONFLICT" ? "red" : "amber"}>
                {EHR_STATE_LABEL[a.ehrState] ?? a.ehrState}
              </Badge>
            )}
          </div>
          {a.ehrState && ["PENDING_CREATE", "PENDING_UPDATE"].includes(a.ehrState) && (
            <p role="note" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900" data-testid="ehr-note">
              This site&apos;s master schedule is the EHR. The booking was sent and is confirmed automatically only when the EHR accepts it.
            </p>
          )}
          {a.ehrState === "FAILED" && (
            <p role="note" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-900" data-testid="ehr-note">
              The EHR did not accept this booking, so it is NOT confirmed. An administrator can see the reason and retry under Administration → Integration Health.
            </p>
          )}
          {err && (
            <div>
              <ErrorState title="Not done" message={err.msg} />
              {err.alts.length > 0 && <p className="mt-1 text-[12.5px] text-slate-700">Eligible alternatives: {err.alts.join("; ")}.</p>}
            </div>
          )}
          {a.status === "NEEDS_RESCHEDULE" && (
            <p role="note" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-900">
              Stopped from routine progression: eligibility no longer allows this visit. Reschedule with an eligible provider, or cancel. A follow-up task was created.
            </p>
          )}
          {a.status === "PENDING" && (
            <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
              Pending — not confirmed. The time is held while staff resolve the eligibility review; confirm once the re-check is eligible.
            </p>
          )}

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
            <dd data-testid="patient-location">
              {a.patientLocationState ?? "Unknown"} <span className="text-xs text-slate-500">({a.patientLocationStatus.toLowerCase()} — at time of visit, not home address)</span>
            </dd>
            <dt className="text-slate-500">Provider location</dt>
            <dd>{a.providerLocationState ?? "—"}</dd>
            <dt className="text-slate-500">Payer</dt>
            <dd>{a.payerPlanName ?? "Self-pay / not specified"}</dd>
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

          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold">Eligibility</h3>
            {a.eligibility ? (
              <EligibilityPanel e={a.eligibility} />
            ) : (
              <p className="text-[12.5px] text-slate-600">Not evaluated yet (booked before license-aware scheduling). Re-check to evaluate.</p>
            )}
          </section>

          {a.canManage && (
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap gap-2">
                {a.status === "CONFIRMED" && (
                  <Button size="sm" onClick={() => setMode(mode === "checkin" ? "none" : "checkin")} aria-expanded={mode === "checkin"}>
                    Check in
                  </Button>
                )}
                {a.status === "PENDING" && (
                  <Button
                    size="sm"
                    loading={busy === "confirm"}
                    onClick={() => run("confirm", () => apiFetch(`/api/v1/appointments/${a.id}/confirm`, { method: "POST", body: { version: a.version } }))}
                  >
                    Confirm booking
                  </Button>
                )}
                {upcoming && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === "recheck"}
                    onClick={() => run("recheck", () => apiFetch(`/api/v1/appointments/${a.id}/recheck`, { method: "POST" }))}
                  >
                    Re-check eligibility
                  </Button>
                )}
                {upcoming && (
                  <Button size="sm" variant="secondary" onClick={() => setMode(mode === "location" ? "none" : "location")} aria-expanded={mode === "location"}>
                    Change patient location
                  </Button>
                )}
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
                {upcoming && a.bookingEnabled && (
                  <Button size="sm" variant="secondary" onClick={() => setMode(mode === "reschedule" ? "none" : "reschedule")} aria-expanded={mode === "reschedule"}>
                    Reschedule
                  </Button>
                )}
                {upcoming && (
                  <Button size="sm" variant="danger" onClick={() => setMode(mode === "cancel" ? "none" : "cancel")} aria-expanded={mode === "cancel"}>
                    Cancel appointment
                  </Button>
                )}
              </div>

              {mode === "checkin" && (
                <form
                  method="post"
                  className="space-y-2 rounded-md border border-teal-200 bg-teal-50/40 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("checkin", () =>
                      apiFetch(`/api/v1/appointments/${a.id}/check-in`, {
                        method: "POST",
                        body: { version: a.version, ...(telehealth ? { patientLocationState: loc, locationConfirmed: locConfirmed } : {}) },
                      }),
                    );
                  }}
                >
                  {telehealth ? (
                    <>
                      <p className="text-[12.5px] text-slate-700">Ask the patient where they are right now. Eligibility is re-checked for that state before the visit can start.</p>
                      <Field label="Patient is physically in *" htmlFor="ci-state">
                        <Select id="ci-state" value={loc} required onChange={(e) => setLoc(e.target.value)}>
                          <option value="">Choose…</option>
                          {US_JURISDICTIONS.map((j) => (
                            <option key={j} value={j}>
                              {j}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <label className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={locConfirmed} onChange={(e) => setLocConfirmed(e.target.checked)} /> I confirmed this with the patient just now
                      </label>
                    </>
                  ) : (
                    <p className="text-[12.5px] text-slate-700">
                      In person: the patient is at {a.siteCode} ({a.siteState}); eligibility is re-checked for that state.
                    </p>
                  )}
                  <Button type="submit" size="sm" loading={busy === "checkin"} disabled={telehealth && (!loc || !locConfirmed)}>
                    Confirm and check in
                  </Button>
                </form>
              )}

              {mode === "location" && (
                <form
                  method="post"
                  className="space-y-2 rounded-md border border-slate-200 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("location", () =>
                      apiFetch(`/api/v1/appointments/${a.id}/confirm-location`, {
                        method: "POST",
                        body: {
                          version: a.version,
                          patientLocationState: loc,
                          patientLocationStatus: locConfirmed ? "VERIFIED" : "PROPOSED",
                          reason: reason || "Patient updated location",
                        },
                      }),
                    );
                  }}
                >
                  <Field label="Patient location at visit time *" htmlFor="lc-state">
                    <Select id="lc-state" value={loc} required onChange={(e) => setLoc(e.target.value)}>
                      <option value="">Choose…</option>
                      {US_JURISDICTIONS.map((j) => (
                        <option key={j} value={j}>
                          {j}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={locConfirmed} onChange={(e) => setLocConfirmed(e.target.checked)} /> Confirmed with the patient (verified)
                  </label>
                  <Field label="Note" htmlFor="lc-reason">
                    <Input id="lc-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  <Button type="submit" size="sm" loading={busy === "location"} disabled={!loc}>
                    Save and re-check
                  </Button>
                </form>
              )}

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
                  <p className="text-xs text-slate-600">
                    The time is released immediately. No patient message is sent (outbound messages are not enabled). Matching waitlist requests can be offered from the Waitlist
                    page.
                  </p>
                  <Button type="submit" size="sm" variant="danger" loading={busy === "cancel"}>
                    Confirm cancellation
                  </Button>
                </form>
              )}
              {mode === "reschedule" && (
                <div className="space-y-2 rounded-md border border-slate-200 p-3">
                  <p className="text-xs text-slate-600">
                    Same provider, type and site. Eligibility is re-checked for the new time; the move is atomic — if it fails, the original booking stays exactly as it is.
                  </p>
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
                  {slots && slots.length === 0 && <p className="text-xs text-slate-600">No eligible free times that day.</p>}
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

          {a.eligibilityHistory.length > 0 && (
            <section className="border-t border-slate-200 pt-4">
              <h3 className="text-[13px] font-semibold">Eligibility evaluations (immutable)</h3>
              <ol className="mt-2 space-y-1">
                {a.eligibilityHistory.map((h) => (
                  <li key={h.id} className="text-[12.5px]">
                    <DecisionBadge decision={h.decision as "ALLOW"} /> {h.trigger.toLowerCase().replace(/_/g, " ")}
                    {h.jurisdiction ? ` · ${h.jurisdiction}` : ""} · {formatInstant(h.evaluatedAt, a.timezone)}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="border-t border-slate-200 pt-4">
            <h3 className="text-[13px] font-semibold">History (append-only)</h3>
            <ol className="mt-2 space-y-1.5">
              {a.events.map((e) => (
                <li key={e.id} className="text-[12.5px]">
                  <span className="font-medium">{e.event.replace(/_/g, " ").toLowerCase()}</span>
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
