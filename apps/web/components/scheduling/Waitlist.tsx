"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MODALITIES, MODALITY_LABEL, US_JURISDICTIONS, type Modality } from "@projectos/shared";
import { Badge, Button, ErrorState, Field, Input, Select } from "@projectos/ui";
import { ApiError, apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";
import { formatDate, formatSlot } from "@/lib/format";
import { PatientPicker, type PickedPatient } from "./PatientPicker";

type Ref = {
  sites: { id: string; code: string; name: string; state: string }[];
  appointmentTypes: { id: string; name: string; modalities: string[]; active: boolean }[];
  practitioners: { id: string; displayName: string; siteIds: string[] }[];
  payerPlans: { id: string; name: string; payerName: string }[];
};
type Offer = { id: string; status: string; startAt: string; expiresAt: string; practitionerName: string; siteCode: string; timezone: string; statusReason: string | null };
type Entry = {
  id: string;
  patientName: string;
  patientMrn: string | null;
  typeName: string;
  modality: Modality;
  patientLocationState: string;
  siteCode: string | null;
  practitionerName: string | null;
  earliestDate: string;
  latestDate: string;
  weekdays: number[];
  afterTime: string | null;
  beforeTime: string | null;
  priority: number;
  note: string | null;
  status: string;
  offers: Offer[];
};

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OFFER_TONE: Record<string, "amber" | "green" | "neutral" | "red"> = { OFFERED: "amber", ACCEPTED: "green", DECLINED: "neutral", EXPIRED: "neutral", INVALIDATED: "red" };

export function WaitlistBoard({ entries, refData, canManage, today }: { entries: Entry[]; refData: Ref; canManage: boolean; today: string }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "ok", text: ok });
    } catch (e) {
      const extra = e instanceof ApiError ? e.details.filter((d) => d.message && d.code !== "ELIGIBLE_ALTERNATIVE").map((d) => d.message) : [];
      setMsg({ kind: "err", text: `${errorMessage(e)}${extra.length ? ` (${extra.join("; ")})` : ""}` });
    } finally {
      setBusy(null);
      reliableRefresh(router);
    }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div>
          {adding ? (
            <AddEntry refData={refData} today={today} onDone={() => setAdding(false)} />
          ) : (
            <Button size="sm" onClick={() => setAdding(true)}>
              Add to waitlist
            </Button>
          )}
        </div>
      )}
      {msg && (
        <p
          role={msg.kind === "err" ? "alert" : "status"}
          className={
            msg.kind === "err"
              ? "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
              : "rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900"
          }
        >
          {msg.text}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No active waitlist requests.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const open = e.offers.find((o) => o.status === "OFFERED");
            return (
              <li key={e.id} className="rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)] p-3 text-[13px]" data-testid="waitlist-entry">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      <Badge tone={e.priority === 1 ? "red" : e.priority === 2 ? "amber" : "neutral"}>P{e.priority}</Badge> {e.patientName}{" "}
                      {e.patientMrn && <span className="font-mono text-xs text-slate-500">{e.patientMrn}</span>}
                    </div>
                    <div className="text-slate-700">
                      {e.typeName} · {MODALITY_LABEL[e.modality]} · patient in {e.patientLocationState}
                      {e.siteCode ? ` · ${e.siteCode}` : " · any site"}
                      {e.practitionerName ? ` · ${e.practitionerName.replace(/ \(SYNTHETIC\)$/, "")}` : ""}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDate(e.earliestDate)} – {formatDate(e.latestDate)} · {e.weekdays.map((w) => WD[w]).join(", ")}
                      {e.afterTime ? ` · after ${e.afterTime.slice(0, 5)}` : ""}
                      {e.beforeTime ? ` · before ${e.beforeTime.slice(0, 5)}` : ""}
                      {e.note ? ` · ${e.note}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={e.status === "OFFERED" ? "amber" : "blue"}>{e.status === "OFFERED" ? "Offer out" : "Waiting"}</Badge>
                    {canManage && e.status === "ACTIVE" && (
                      <Button
                        size="sm"
                        loading={busy === `offer-${e.id}`}
                        onClick={() =>
                          run(
                            `offer-${e.id}`,
                            () => apiFetch(`/api/v1/waitlist/${e.id}/offer`, { method: "POST", body: {} }),
                            "Offer created: the time is held until the offer expires.",
                          )
                        }
                      >
                        Find &amp; offer eligible time
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === `rm-${e.id}`}
                        onClick={() => run(`rm-${e.id}`, () => apiFetch(`/api/v1/waitlist/${e.id}`, { method: "DELETE" }), "Removed from waitlist.")}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                {e.offers.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {e.offers.slice(0, 3).map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="waitlist-offer">
                        <Badge tone={OFFER_TONE[o.status]}>{o.status.toLowerCase()}</Badge>
                        {formatSlot(o.startAt, o.timezone)} with {o.practitionerName.replace(/ \(SYNTHETIC\)$/, "")} at {o.siteCode}
                        {o.status === "OFFERED" && <span className="text-slate-500">· expires {formatSlot(o.expiresAt, o.timezone)}</span>}
                        {o.statusReason && o.status !== "OFFERED" && <span className="text-slate-500">· {o.statusReason}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {canManage && open && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      loading={busy === `acc-${open.id}`}
                      onClick={() =>
                        run(
                          `acc-${open.id}`,
                          () => apiFetch(`/api/v1/waitlist/offers/${open.id}/accept`, { method: "POST" }),
                          "Patient accepted — booked after a fresh eligibility check.",
                        )
                      }
                    >
                      Patient accepted — book
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === `dec-${open.id}`}
                      onClick={() => run(`dec-${open.id}`, () => apiFetch(`/api/v1/waitlist/offers/${open.id}/decline`, { method: "POST" }), "Declined; time released.")}
                    >
                      Patient declined
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AddEntry({ refData, today, onDone }: { refData: Ref; today: string; onDone: () => void }) {
  const router = useRouter();
  const types = refData.appointmentTypes.filter((t) => t.active);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId);
  const [modality, setModality] = useState<Modality>((type?.modalities[0] as Modality) ?? "IN_PERSON");
  const [loc, setLoc] = useState("");
  const [siteId, setSiteId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [planId, setPlanId] = useState("");
  const [earliest, setEarliest] = useState(today);
  const [latest, setLatest] = useState(today);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [priority, setPriority] = useState("2");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      method="post"
      aria-label="Add to waitlist"
      className="space-y-3 rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)] p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!patient) return setErr("Choose a patient.");
        setBusy(true);
        setErr(null);
        try {
          await apiFetch("/api/v1/waitlist", {
            method: "POST",
            body: {
              patientId: patient.id,
              appointmentTypeId: typeId,
              modality,
              patientLocationState: loc,
              payerPlanId: planId || null,
              siteId: siteId || null,
              practitionerId: practitionerId || null,
              earliestDate: earliest,
              latestDate: latest,
              weekdays,
              afterTime: after || null,
              beforeTime: before || null,
              priority: Number(priority),
              note: note || null,
            },
          });
          onDone();
          reliableRefresh(router);
        } catch (x) {
          setErr(errorMessage(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      {err && <ErrorState title="Not added" message={err} />}
      <PatientPicker value={patient} onChange={setPatient} canCreate />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Appointment type *" htmlFor="wl-type">
          <Select
            id="wl-type"
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
        <Field label="Modality *" htmlFor="wl-mod">
          <Select id="wl-mod" value={modality} onChange={(e) => setModality(e.target.value as Modality)}>
            {MODALITIES.filter((m) => type?.modalities.includes(m)).map((m) => (
              <option key={m} value={m}>
                {MODALITY_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Patient location at visit time *" htmlFor="wl-loc">
          <Select id="wl-loc" value={loc} required onChange={(e) => setLoc(e.target.value)}>
            <option value="">Choose…</option>
            {US_JURISDICTIONS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payer plan" htmlFor="wl-plan">
          <Select id="wl-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Self-pay / not specified</option>
            {refData.payerPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.payerName.replace(/ \(SYNTHETIC\)$/, "")} — {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Site" htmlFor="wl-site">
          <Select id="wl-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Any</option>
            {refData.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider" htmlFor="wl-prov">
          <Select id="wl-prov" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
            <option value="">Any eligible</option>
            {refData.practitioners
              .filter((p) => !siteId || p.siteIds.includes(siteId))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName.replace(/ \(SYNTHETIC\)$/, "")}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Earliest *" htmlFor="wl-from">
          <Input id="wl-from" type="date" required min={today} value={earliest} onChange={(e) => setEarliest(e.target.value)} />
        </Field>
        <Field label="Latest *" htmlFor="wl-to">
          <Input id="wl-to" type="date" required min={earliest} value={latest} onChange={(e) => setLatest(e.target.value)} />
        </Field>
        <Field label="After (local)" htmlFor="wl-after">
          <Input id="wl-after" type="time" value={after} onChange={(e) => setAfter(e.target.value)} />
        </Field>
        <Field label="Before (local)" htmlFor="wl-before">
          <Input id="wl-before" type="time" value={before} onChange={(e) => setBefore(e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor="wl-pri">
          <Select id="wl-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="1">1 — high</option>
            <option value="2">2 — normal</option>
            <option value="3">3 — low</option>
          </Select>
        </Field>
        <Field label="Note (no clinical details)" htmlFor="wl-note">
          <Input id="wl-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <fieldset>
        <legend className="text-[13px] font-medium text-slate-700">Days</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {WD.map((w, i) => (
            <label key={w} className="flex items-center gap-1 text-[13px]">
              <input type="checkbox" checked={weekdays.includes(i)} onChange={(e) => setWeekdays(e.target.checked ? [...weekdays, i].sort() : weekdays.filter((x) => x !== i))} />
              {w}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          Add to waitlist
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
