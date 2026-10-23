"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_META, MODALITIES, MODALITY_LABEL, US_JURISDICTIONS, type EligibilityCategory, type EligibilityDecision, type Modality } from "@projectos/shared";
import { Button, ErrorState, Field, Input, Select, cn } from "@projectos/ui";
import { ApiError, apiFetch, errorMessage } from "@/lib/client";
import { formatDay } from "@/lib/format";
import { DecisionBadge, type Flag } from "./Eligibility";

type Ref = {
  sites: { id: string; code: string; name: string; state: string; timezone: string }[];
  appointmentTypes: { id: string; name: string; durationMinutes: number; modalities: string[]; active: boolean }[];
  practitioners: { id: string; displayName: string; profession: string; siteIds: string[] }[];
  payerPlans: { id: string; name: string; payerName: string; requiresEnrollment: boolean }[];
};
type Slot = {
  practitionerId: string;
  practitionerName: string;
  siteId: string;
  date: string;
  timeZone: string;
  startAt: string;
  localStart: string;
  zone: string;
  roomCode: string | null;
  reasons: string[];
  eligibility: { decision: EligibilityDecision; summary: string; policyVersion: string | null; isDemoPolicy: boolean; flags: Flag[] };
};
type NotOffered = { practitionerId: string; practitionerName: string; siteId: string; decision: EligibilityDecision; summary: string; categories: string[]; freeTimes: number };
type Result = { slots: Slot[]; searchedProviders: number; eligibleProviders: number; notOffered: NotOffered[]; payerPlan: { name: string } | null };

/** "14:15" → "2:15 PM" */
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const clean = (n: string) => n.replace(/ \(SYNTHETIC\)$/, "");

function byProvider(slots: Slot[]) {
  const m = new Map<string, Slot[]>();
  for (const s of slots) m.set(`${s.practitionerId}:${s.siteId}`, [...(m.get(`${s.practitionerId}:${s.siteId}`) ?? []), s]);
  return [...m.entries()];
}

export function FindAppointment({ refData, today, canBook, patientId }: { refData: Ref; today: string; canBook: boolean; patientId?: string }) {
  const router = useRouter();
  const types = refData.appointmentTypes.filter((t) => t.active);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId);
  const [modality, setModality] = useState<Modality>((type?.modalities[0] as Modality) ?? "IN_PERSON");
  const [siteId, setSiteId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [patientState, setPatientState] = useState("");
  const [payerPlanId, setPayerPlanId] = useState("");
  const [fromDate, setFromDate] = useState(today);
  const [days, setDays] = useState("7");
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<string | null>(null);
  const [holdErr, setHoldErr] = useState<{ msg: string; alts: string[] } | null>(null);

  const provs = refData.practitioners.filter((p) => !siteId || p.siteIds.includes(siteId));
  const site = (id: string) => refData.sites.find((s) => s.id === id);
  const telehealth = modality !== "IN_PERSON";
  const grouped = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of result?.slots ?? []) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return [...m.entries()];
  }, [result]);

  const search = async (e?: React.FormEvent, all = showAll) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    setHoldErr(null);
    try {
      setResult(
        await apiFetch<Result>("/api/v1/scheduling/search", {
          method: "POST",
          body: {
            appointmentTypeId: typeId,
            modality,
            fromDate,
            days: Number(days),
            show: all ? "all" : "eligible",
            ...(siteId ? { siteId } : {}),
            ...(practitionerId ? { practitionerId } : {}),
            ...(patientState ? { patientState } : {}),
            ...(payerPlanId ? { payerPlanId } : {}),
          },
        }),
      );
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };

  const hold = async (s: Slot) => {
    setHolding(s.startAt + s.practitionerId);
    setHoldErr(null);
    try {
      const h = await apiFetch<{ id: string }>("/api/v1/appointments/holds", {
        method: "POST",
        body: {
          practitionerId: s.practitionerId,
          siteId: s.siteId,
          appointmentTypeId: typeId,
          modality,
          startAt: s.startAt,
          patientLocationState: patientState || (modality === "IN_PERSON" ? (site(s.siteId)?.state ?? null) : null),
          payerPlanId: payerPlanId || null,
        },
      });
      const p = new URLSearchParams({ hold: h.id });
      if (patientState) p.set("state", patientState);
      if (patientId) p.set("patient", patientId);
      if (payerPlanId) p.set("plan", payerPlanId);
      router.push(`/scheduling/appointments/new?${p.toString()}`);
    } catch (x) {
      const alts = x instanceof ApiError ? x.details.filter((d) => d.code === "ALTERNATIVE" || d.code === "ELIGIBLE_ALTERNATIVE").map((d) => d.message!) : [];
      setHoldErr({ msg: errorMessage(x), alts });
      setHolding(null);
      void search();
    }
  };

  if (!types.length) return <ErrorState title="No appointment types" message="A scheduling manager must create appointment types first (Scheduling setup)." />;

  return (
    <div className="space-y-5">
      <form
        method="post"
        onSubmit={search}
        className="grid grid-cols-2 gap-3 rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)] p-4 md:grid-cols-4"
        aria-label="Find appointment"
      >
        <Field label="Appointment type *" htmlFor="fa-type">
          <Select
            id="fa-type"
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
              const t = types.find((x) => x.id === e.target.value);
              if (t && !t.modalities.includes(modality)) setModality(t.modalities[0] as Modality);
            }}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.durationMinutes} min)
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Modality *" htmlFor="fa-mod">
          <Select id="fa-mod" value={modality} onChange={(e) => setModality(e.target.value as Modality)}>
            {MODALITIES.filter((m) => type?.modalities.includes(m)).map((m) => (
              <option key={m} value={m}>
                {MODALITY_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Site" htmlFor="fa-site">
          <Select
            id="fa-site"
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setPractitionerId("");
            }}
          >
            <option value="">Any of my sites</option>
            {refData.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name} ({s.state})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider" htmlFor="fa-prov">
          <Select id="fa-prov" value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
            <option value="">Any provider</option>
            {provs.map((p) => (
              <option key={p.id} value={p.id}>
                {clean(p.displayName)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={`Patient location at visit time${telehealth ? " *" : ""}`}
          htmlFor="fa-state"
          hint={telehealth ? "Where the patient will physically be — decides which license applies. Not their home address." : "In person: the site's state applies."}
        >
          <Select id="fa-state" value={patientState} onChange={(e) => setPatientState(e.target.value)}>
            <option value="">{telehealth ? "Not yet known" : "At the site"}</option>
            {US_JURISDICTIONS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payer plan" htmlFor="fa-plan" hint="Enrollment is checked per site.">
          <Select id="fa-plan" value={payerPlanId} onChange={(e) => setPayerPlanId(e.target.value)}>
            <option value="">Self-pay / not specified</option>
            {refData.payerPlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.payerName.replace(/ \(SYNTHETIC\)$/, "")} — {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From date *" htmlFor="fa-from">
          <Input id="fa-from" type="date" required value={fromDate} min={today} onChange={(e) => setFromDate(e.target.value)} />
        </Field>
        <Field label="Days to search" htmlFor="fa-days">
          <Select id="fa-days" value={days} onChange={(e) => setDays(e.target.value)}>
            {["1", "3", "7", "14"].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-[13px] md:col-span-3">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
              if (result) void search(undefined, e.target.checked);
            }}
          />
          Also show times that need review or are blocked (with reasons)
        </label>
        <div className="flex items-end">
          <Button type="submit" loading={busy} className="w-full">
            Search
          </Button>
        </div>
      </form>

      {err && <ErrorState title="Search failed" message={err} />}
      {holdErr && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <strong>{holdErr.msg}</strong> Results were refreshed.
          {holdErr.alts.length > 0 && <span className="block text-[13px]">Eligible alternatives: {holdErr.alts.join("; ")}.</span>}
        </div>
      )}

      {result && (
        <section aria-labelledby="fa-results" className="space-y-3">
          <h2 id="fa-results" className="text-[15px] font-semibold">
            {result.slots.length} {showAll ? "" : "eligible "}open time{result.slots.length === 1 ? "" : "s"} · {result.eligibleProviders} of {result.searchedProviders} provider
            {result.searchedProviders === 1 ? "" : "s"} eligible{result.payerPlan ? ` for ${result.payerPlan.name}` : ""}
          </h2>
          {telehealth && !patientState && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
              Patient location unknown — no provider can be confirmed for a {MODALITY_LABEL[modality].toLowerCase()} visit until you record where the patient will be.
            </p>
          )}
          {result.notOffered.length > 0 && (
            <div className="rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)]" data-testid="not-offered">
              <h3 className="border-b border-slate-200 px-3 py-2 text-[13px] font-semibold text-slate-700">
                Not offered ({result.notOffered.length}) — has free time but is not eligible
              </h3>
              <ul className="divide-y divide-slate-100">
                {result.notOffered.map((n) => (
                  <li key={n.practitionerId + n.siteId} className="flex flex-wrap items-start gap-2 px-3 py-2 text-[13px]">
                    <DecisionBadge decision={n.decision} />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{clean(n.practitionerName)}</span> <span className="text-xs text-slate-500">at {site(n.siteId)?.code}</span>
                      <p className="text-slate-700">{n.summary}</p>
                      <p className="text-xs text-slate-500">
                        {n.categories
                          .map((c) => CATEGORY_META[c as EligibilityCategory]?.remediation)
                          .filter(Boolean)
                          .join(" ")}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.slots.length === 0 && (
            <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No {showAll ? "" : "eligible "}open times. Try more days, another site, modality or payer{showAll ? "" : ", or show times that need review"}.
            </p>
          )}
          {grouped.map(([date, slots]) => (
            <div key={date} className="rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)]">
              <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-700">{formatDay(date)}</h3>
              <ul className="divide-y divide-slate-100">
                {byProvider(slots).map(([key, ps]) => {
                  const first = ps[0]!;
                  const e = first.eligibility;
                  return (
                    <li key={key} className="grid gap-2 px-3 py-2.5 text-[13px] md:grid-cols-[16rem_1fr]" data-testid="slot-row">
                      <div>
                        <div className="font-medium">{clean(first.practitionerName)}</div>
                        <div className="text-xs text-slate-500">
                          {site(first.siteId)?.code} ({site(first.siteId)?.state}) · {first.timeZone}
                        </div>
                        <div className="mt-1">
                          <DecisionBadge decision={e.decision} />
                        </div>
                        <details className="mt-0.5">
                          <summary className="cursor-pointer text-xs text-teal-800">Why {e.decision === "ALLOW" ? "offered" : "not confirmable"}</summary>
                          <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">
                            <li>{e.summary}</li>
                            {e.flags.map((f) => (
                              <li key={f.code}>
                                {f.code}: {f.message}
                              </li>
                            ))}
                            {first.reasons
                              .filter((r) => !r.startsWith("Room"))
                              .map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            {e.policyVersion && (
                              <li>
                                Rule {e.policyVersion}
                                {e.isDemoPolicy ? " (DEMO — not verified law)" : ""}
                              </li>
                            )}
                          </ul>
                        </details>
                      </div>
                      <div className="flex flex-wrap content-start gap-1.5" role="list" aria-label={`Open times with ${first.practitionerName} on ${formatDay(date)}`}>
                        {ps.map((s) => {
                          const holdable = canBook && s.eligibility.decision !== "BLOCK";
                          return (
                            <span role="listitem" key={s.startAt}>
                              <button
                                type="button"
                                data-testid="slot"
                                data-decision={s.eligibility.decision}
                                disabled={!holdable || !!holding}
                                onClick={() => hold(s)}
                                title={s.roomCode ? `Room ${s.roomCode}` : undefined}
                                aria-label={`${holdable ? "Hold " : ""}${clock(s.localStart)} ${s.zone} with ${s.practitionerName} on ${formatDay(s.date)} — ${s.eligibility.decision === "ALLOW" ? "eligible" : s.eligibility.decision === "REVIEW" ? "needs review" : "blocked"}`}
                                className={cn(
                                  "min-w-[5.5rem] rounded-md border bg-white px-2 py-1 text-[12.5px] tabular-nums focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-default",
                                  s.eligibility.decision === "ALLOW" && "border-teal-700/40 text-teal-900 hover:bg-teal-50",
                                  s.eligibility.decision === "REVIEW" && "border-amber-500 border-dashed text-amber-900 hover:bg-amber-50",
                                  s.eligibility.decision === "BLOCK" && "border-red-300 text-red-800 line-through",
                                )}
                              >
                                {holding === s.startAt + s.practitionerId ? "Holding…" : clock(s.localStart)} <span className="text-[10.5px] text-slate-500">{s.zone}</span>
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {canBook && result.slots.length > 0 && (
            <p className="text-xs text-slate-500">Click a time to hold it, then pick the patient. Dashed times need review and can only be saved as pending (not confirmed).</p>
          )}
        </section>
      )}
    </div>
  );
}
