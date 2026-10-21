"use client";
import { useEffect, useId, useState } from "react";
import { US_JURISDICTIONS } from "@projectos/shared";
import { Button, Field, Input, Select } from "@projectos/ui";
import { apiFetch, errorMessage } from "@/lib/client";

export type PickedPatient = { id: string; mrn: string; displayName: string; birthYear: number | null; homeState: string | null };

/** Minimum-necessary patient search (name or demo MRN) with "create synthetic patient". */
export function PatientPicker({ value, onChange, canCreate }: { value: PickedPatient | null; onChange: (p: PickedPatient | null) => void; canCreate: boolean }) {
  const uid = useId();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PickedPatient[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [homeState, setHomeState] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRows([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setRows(await apiFetch<PickedPatient[]>(`/api/v1/patients?q=${encodeURIComponent(q.trim())}`));
        setErr(null);
      } catch (e) {
        setErr(errorMessage(e));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value)
    return (
      <div className="flex items-center justify-between rounded-md border border-teal-300 bg-teal-50 px-3 py-2 text-sm" data-testid="picked-patient">
        <div>
          <div className="font-medium">{value.displayName}</div>
          <div className="text-xs text-slate-600">
            <span className="font-mono">{value.mrn}</span>
            {value.birthYear ? ` · born ${value.birthYear}` : ""}
            {value.homeState ? ` · home state ${value.homeState}` : ""}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );

  return (
    <div className="space-y-2">
      <Field label="Find patient (name or DEMO MRN) *" htmlFor={`${uid}-q`} hint="Type at least 2 characters. Synthetic patients only.">
        <Input id={`${uid}-q`} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" role="searchbox" />
      </Field>
      {err && <p className="text-xs text-red-700">{err}</p>}
      {rows.length > 0 && (
        <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200" aria-label="Matching patients">
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 focus:bg-teal-50 focus:outline-none" onClick={() => onChange(p)}>
                {p.displayName} <span className="font-mono text-xs text-slate-500">{p.mrn}</span>
                {p.homeState && <span className="text-xs text-slate-500"> · {p.homeState}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && rows.length === 0 && !err && <p className="text-xs text-slate-500">No match.</p>}
      {canCreate &&
        (creating ? (
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
            <p className="text-xs text-slate-600">Creates a fictional patient labelled SYNTHETIC with a generated DEMO MRN. Never enter a real person.</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Display name *" htmlFor={`${uid}-n`} className="col-span-3">
                <Input id={`${uid}-n`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Birth year" htmlFor={`${uid}-y`}>
                <Input id={`${uid}-y`} type="number" min={1900} max={2100} value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
              </Field>
              <Field label="Home state" htmlFor={`${uid}-s`}>
                <Select id={`${uid}-s`} value={homeState} onChange={(e) => setHomeState(e.target.value)}>
                  <option value="">—</option>
                  {US_JURISDICTIONS.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={busy}
                disabled={!name.trim()}
                onClick={async () => {
                  setBusy(true);
                  setErr(null);
                  try {
                    const p = await apiFetch<PickedPatient>("/api/v1/patients", {
                      method: "POST",
                      body: { displayName: name, birthYear: birthYear ? Number(birthYear) : null, homeState: homeState || null },
                    });
                    onChange(p);
                  } catch (e) {
                    setErr(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Create synthetic patient
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            New synthetic patient
          </Button>
        ))}
    </div>
  );
}
