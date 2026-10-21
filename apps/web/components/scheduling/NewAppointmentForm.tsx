"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { localDate, MODALITIES, MODALITY_LABEL, resolveLocal, toZonedIso, US_JURISDICTIONS, zoneAbbreviation, type Modality } from "@projectos/shared";
import { Button, ErrorState, Field, Input, Select } from "@projectos/ui";
import { ApiError, apiFetch, errorMessage } from "@/lib/client";
import { formatSlot } from "@/lib/format";
import { PatientPicker, type PickedPatient } from "./PatientPicker";
import { PolicyPendingBadge } from "./PolicyPending";

type Ref = {
  sites: { id: string; code: string; name: string; state: string; timezone: string }[];
  appointmentTypes: { id: string; name: string; durationMinutes: number; modalities: string[]; active: boolean }[];
  practitioners: { id: string; displayName: string; siteIds: string[] }[];
};
type Hold = {
  id: string;
  practitionerId: string;
  practitionerName: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  siteState: string;
  timezone: string;
  roomId: string | null;
  appointmentTypeId: string;
  modality: Modality;
  startAt: string;
  endAt: string;
  expiresAt: string;
  status: string;
};

function newKey() {
  return `appt-${crypto.randomUUID()}`;
}

export function NewAppointmentForm({
  refData,
  hold,
  initialState,
  initialPatient,
  today,
}: {
  refData: Ref;
  hold: Hold | null;
  initialState?: string;
  initialPatient?: PickedPatient | null;
  today: string;
}) {
  const router = useRouter();
  const types = refData.appointmentTypes.filter((t) => t.active);
  const [patient, setPatient] = useState<PickedPatient | null>(initialPatient ?? null);
  const [locState, setLocState] = useState(initialState ?? (hold?.modality === "IN_PERSON" ? hold.siteState : ""));
  const [locStatus, setLocStatus] = useState("PROPOSED");
  const [err, setErr] = useState<string | null>(null);
  const [alts, setAlts] = useState<{ startAt: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  // One idempotency key per intended booking: double-clicks and network retries can never create two appointments.
  const key = useRef(newKey());

  // Manual mode (no hold)
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId);
  const [modality, setModality] = useState<Modality>((type?.modalities[0] as Modality) ?? "IN_PERSON");
  const [siteId, setSiteId] = useState(refData.sites[0]?.id ?? "");
  const site = refData.sites.find((s) => s.id === siteId);
  const provs = refData.practitioners.filter((p) => p.siteIds.includes(siteId));
  const [practitionerId, setPractitionerId] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("09:00");
  const [occurrence, setOccurrence] = useState<0 | 1>(0);

  const resolution = useMemo(() => (site && date && time ? resolveLocal(date, time, site.timezone) : null), [site, date, time]);
  const manualStart = resolution?.kind === "ok" ? resolution.instant : resolution?.kind === "ambiguous" ? resolution.instants[occurrence] : null;

  // Hold countdown
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hold) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hold]);
  const secondsLeft = hold ? Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - nowMs) / 1000)) : 0;
  const holdExpired = !!hold && (secondsLeft <= 0 || hold.status !== "ACTIVE");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setAlts([]);
    if (!patient) return setErr("Choose or create a patient.");
    if (!locState) return setErr("Enter the patient's location (state) at the time of the visit.");
    let body: Record<string, unknown>;
    if (hold) {
      body = {
        holdId: hold.id,
        practitionerId: hold.practitionerId,
        siteId: hold.siteId,
        appointmentTypeId: hold.appointmentTypeId,
        modality: hold.modality,
        startAt: hold.startAt,
      };
    } else {
      if (!practitionerId) return setErr("Choose a provider.");
      if (!manualStart || !site) return setErr("That local time does not exist on this date (daylight-saving change). Choose another time.");
      body = { practitionerId, siteId, appointmentTypeId: typeId, modality, startAt: toZonedIso(manualStart, site.timezone) };
    }
    setBusy(true);
    try {
      const a = await apiFetch<{ id: string; startAt: string; timezone: string; siteId: string }>("/api/v1/appointments", {
        method: "POST",
        headers: { "Idempotency-Key": key.current },
        body: { ...body, patientId: patient.id, patientLocationState: locState, patientLocationStatus: locStatus },
      });
      router.push(`/scheduling/calendar?date=${localDate(new Date(a.startAt), a.timezone)}&siteId=${a.siteId}&appt=${a.id}`);
    } catch (x) {
      key.current = newKey(); // a failed attempt may be retried as a new booking
      setErr(errorMessage(x));
      if (x instanceof ApiError) setAlts(x.details.filter((d) => d.code === "ALTERNATIVE").map((d) => ({ startAt: d.field!, label: d.message! })));
      setBusy(false);
    }
  };

  return (
    <form method="post" onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_22rem]" aria-label="New appointment">
      <div className="space-y-5">
        {err && (
          <div>
            <ErrorState title="Not booked" message={err} />
            {alts.length > 0 && (
              <p className="mt-1 text-[13px] text-slate-700">
                Other times with this provider: {alts.map((a) => a.label).join(", ")}. Use{" "}
                <a href="/scheduling/find" className="text-teal-800 underline">
                  Find appointment
                </a>{" "}
                to hold one.
              </p>
            )}
          </div>
        )}
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-[15px] font-semibold">1. Patient</h2>
          <PatientPicker value={patient} onChange={setPatient} canCreate />
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-[15px] font-semibold">2. Time and provider</h2>
          {hold ? (
            <div className="text-sm" data-testid="hold-summary">
              <p>
                <strong>{formatSlot(hold.startAt, hold.timezone)}</strong> – {formatSlot(hold.endAt, hold.timezone, { date: false })} with {hold.practitionerName} at{" "}
                {hold.siteName} ({hold.siteCode}, {hold.siteState}) · {MODALITY_LABEL[hold.modality]} · {types.find((t) => t.id === hold.appointmentTypeId)?.name}
              </p>
              <p className={holdExpired ? "mt-1 font-medium text-red-700" : "mt-1 text-slate-600"} role="status" aria-live="polite">
                {holdExpired
                  ? "This hold has expired. Go back and search again."
                  : `Held for you for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")} more (others cannot book it meanwhile).`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Appointment type *" htmlFor="na-type">
                <Select
                  id="na-type"
                  value={typeId}
                  onChange={(e) => {
                    setTypeId(e.target.value);
                    const t = types.find((x) => x.id === e.target.value);
                    if (t && !t.modalities.includes(modality)) setModality(t.modalities[0] as Modality);
                  }}
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Modality *" htmlFor="na-mod">
                <Select id="na-mod" value={modality} onChange={(e) => setModality(e.target.value as Modality)}>
                  {MODALITIES.filter((m) => type?.modalities.includes(m)).map((m) => (
                    <option key={m} value={m}>
                      {MODALITY_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Site *" htmlFor="na-site">
                <Select
                  id="na-site"
                  value={siteId}
                  onChange={(e) => {
                    setSiteId(e.target.value);
                    setPractitionerId("");
                  }}
                >
                  {refData.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name} ({s.state})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Provider *" htmlFor="na-prov">
                <Select id="na-prov" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
                  <option value="">Choose…</option>
                  {provs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName.replace(/ \(SYNTHETIC\)$/, "")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date *" htmlFor="na-date">
                <Input id="na-date" type="date" required value={date} min={today} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={`Local start time (${site?.timezone ?? ""}) *`} htmlFor="na-time">
                <Input id="na-time" type="time" step={300} required value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
              <div className="col-span-2 text-[13px]" aria-live="polite">
                {resolution?.kind === "gap" && (
                  <p className="font-medium text-red-700">
                    {time} does not exist on {date} in {site?.timezone} (clocks spring forward). Choose another time.
                  </p>
                )}
                {resolution?.kind === "ambiguous" && site && (
                  <fieldset>
                    <legend className="font-medium text-amber-900">
                      {time} happens twice on {date} (clocks fall back). Which one?
                    </legend>
                    {resolution.instants.map((i, idx) => (
                      <label key={idx} className="mr-4 inline-flex items-center gap-1.5">
                        <input type="radio" name="occ" checked={occurrence === idx} onChange={() => setOccurrence(idx as 0 | 1)} />
                        {time} {zoneAbbreviation(i, site.timezone)} ({toZonedIso(i, site.timezone).slice(-6)})
                      </label>
                    ))}
                  </fieldset>
                )}
                {resolution?.kind === "ok" && site && (
                  <p className="text-slate-600">= {toZonedIso(resolution.instant, site.timezone)} (validated on the server inside the booking transaction)</p>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-[15px] font-semibold">3. Patient location at the time of the visit</h2>
          <p className="text-[12.5px] text-slate-600">
            Record where the patient will physically be. Home address, mailing address and phone area code do not count. It is re-checked at check-in in a later phase.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State / territory *" htmlFor="na-loc">
              <Select id="na-loc" value={locState} required onChange={(e) => setLocState(e.target.value)}>
                <option value="">Choose…</option>
                {US_JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How do we know?" htmlFor="na-locs">
              <Select id="na-locs" value={locStatus} onChange={(e) => setLocStatus(e.target.value)}>
                <option value="PROPOSED">Patient says they will be there (proposed)</option>
                <option value="VERIFIED">Confirmed with the patient today (verified)</option>
              </Select>
            </Field>
          </div>
          {patient?.homeState && locState && patient.homeState !== locState && (
            <p className="text-[12.5px] text-amber-900">
              Note: different from the patient&apos;s home state ({patient.homeState}). That is fine — the visit location is what matters.
            </p>
          )}
        </section>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-12 lg:self-start">
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="text-[15px] font-semibold">Book</h2>
          <PolicyPendingBadge />
          <p className="text-[12.5px] text-slate-600">
            The server re-checks working hours, time off, closures, rooms and conflicts in one transaction. Licensure and payer eligibility are not evaluated until Phase 5.
          </p>
          <Button type="submit" loading={busy} disabled={holdExpired} className="w-full">
            Book synthetic appointment
          </Button>
          {hold && !holdExpired && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={async () => {
                await apiFetch(`/api/v1/appointments/holds/${hold.id}`, { method: "DELETE" }).catch(() => undefined);
                router.push("/scheduling/find");
              }}
            >
              Release hold
            </Button>
          )}
        </div>
      </aside>
    </form>
  );
}
