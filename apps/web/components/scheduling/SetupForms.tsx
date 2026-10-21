"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, boundaryInstant, EXCEPTION_KINDS, EXCEPTION_KIND_LABEL, MODALITIES, MODALITY_LABEL, toZonedIso } from "@projectos/shared";
import { Button } from "@projectos/ui";
import { FormDialog, orNull } from "@/components/FormDialog";
import { apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";

type Site = { id: string; code: string; name: string; timezone: string };
type Prov = { id: string; displayName: string; siteIds: string[] };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const modalityOptions = MODALITIES.map((m) => ({ value: m, label: MODALITY_LABEL[m] }));
const clean = (p: string) => p.replace(/ \(SYNTHETIC\)$/, "");

export function NewTypeButton({ services }: { services: { id: string; name: string }[] }) {
  return (
    <FormDialog
      title="New appointment type"
      submitLabel="Create type"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          New type
        </Button>
      )}
      fields={[
        { name: "code", label: "Code", type: "text", required: true, placeholder: "PC_FU", hint: "Capital letters, digits, _" },
        { name: "name", label: "Name", type: "text", required: true },
        {
          name: "serviceId",
          label: "Service (providers must offer it)",
          type: "select",
          options: services.map((s) => ({ value: s.id, label: s.name })),
          allowEmpty: "Any provider",
        },
        { name: "durationMinutes", label: "Duration (min)", type: "number", required: true, defaultValue: "30" },
        { name: "bufferBeforeMinutes", label: "Buffer before (min)", type: "number", defaultValue: "0" },
        { name: "bufferAfterMinutes", label: "Buffer after (min)", type: "number", defaultValue: "5" },
        { name: "minNoticeMinutes", label: "Minimum notice (min)", type: "number", defaultValue: "60" },
        { name: "maxDaysOut", label: "Bookable up to (days ahead)", type: "number", defaultValue: "90" },
        { name: "modalities", label: "Modalities", type: "multi", options: modalityOptions, defaultValue: ["IN_PERSON"] },
        { name: "requiresRoom", label: "In-person visits need a room", type: "checkbox", defaultValue: true },
      ]}
      onSubmit={(v) =>
        apiFetch("/api/v1/appointment-types", {
          method: "POST",
          body: {
            ...v,
            serviceId: orNull(v.serviceId),
            durationMinutes: Number(v.durationMinutes),
            bufferBeforeMinutes: Number(v.bufferBeforeMinutes || 0),
            bufferAfterMinutes: Number(v.bufferAfterMinutes || 0),
            minNoticeMinutes: Number(v.minNoticeMinutes || 0),
            maxDaysOut: Number(v.maxDaysOut || 90),
          },
        })
      }
    />
  );
}

export function TypeActiveToggle({ id, version, active }: { id: string; version: number; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await apiFetch(`/api/v1/appointment-types/${id}`, { method: "PATCH", body: { version, active: !active } });
            reliableRefresh(router);
          } catch (e) {
            setErr(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {active ? "Deactivate" : "Activate"}
      </Button>
      {err && <span className="ml-2 text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function NewRoomButton({ sites }: { sites: Site[] }) {
  return (
    <FormDialog
      title="New room"
      submitLabel="Create room"
      trigger={(open) => (
        <Button size="sm" variant="secondary" onClick={open}>
          New room
        </Button>
      )}
      fields={[
        { name: "siteId", label: "Site", type: "select", required: true, options: sites.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })), defaultValue: sites[0]?.id },
        { name: "code", label: "Code", type: "text", required: true, placeholder: "EX-3" },
        { name: "name", label: "Name", type: "text", required: true },
      ]}
      onSubmit={(v) => apiFetch("/api/v1/rooms", { method: "POST", body: v })}
    />
  );
}

export function NewHoursButton({ sites, practitioners, today }: { sites: Site[]; practitioners: Prov[]; today: string }) {
  return (
    <FormDialog
      title="Add working hours"
      description="A weekly block in the site's time zone. Breaks are the gaps between blocks (e.g. 09:00–12:00 and 13:00–17:00)."
      submitLabel="Add block"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          Add working hours
        </Button>
      )}
      fields={[
        {
          name: "practitionerId",
          label: "Provider",
          type: "select",
          required: true,
          options: practitioners.map((p) => ({ value: p.id, label: clean(p.displayName) })),
          defaultValue: practitioners[0]?.id,
        },
        {
          name: "siteId",
          label: "Site",
          type: "select",
          required: true,
          options: sites.map((s) => ({ value: s.id, label: `${s.code} (${s.timezone})` })),
          defaultValue: sites[0]?.id,
        },
        { name: "weekday", label: "Day", type: "select", required: true, options: WEEKDAYS.map((w, i) => ({ value: String(i), label: w })), defaultValue: "1" },
        { name: "effectiveFrom", label: "Effective from", type: "date", required: true, defaultValue: today },
        { name: "startTime", label: "Start (HH:MM)", type: "text", required: true, defaultValue: "09:00" },
        { name: "endTime", label: "End (HH:MM)", type: "text", required: true, defaultValue: "12:00" },
        { name: "modalities", label: "Modalities offered", type: "multi", options: modalityOptions, defaultValue: ["IN_PERSON", "VIDEO"] },
      ]}
      onSubmit={(v) => apiFetch("/api/v1/schedule-templates", { method: "POST", body: { ...v, weekday: Number(v.weekday) } })}
    />
  );
}

export function NewExceptionButton({ sites, practitioners, today, timezone }: { sites: Site[]; practitioners: Prov[]; today: string; timezone: string }) {
  return (
    <FormDialog
      title="Add time off or closure"
      description={`Whole days in ${timezone}. Existing appointments are not cancelled automatically — the response lists them for review.`}
      submitLabel="Save"
      trigger={(open) => (
        <Button size="sm" variant="secondary" onClick={open}>
          Add time off / closure
        </Button>
      )}
      fields={[
        { name: "kind", label: "Kind", type: "select", required: true, options: EXCEPTION_KINDS.map((k) => ({ value: k, label: EXCEPTION_KIND_LABEL[k] })), defaultValue: "PTO" },
        {
          name: "practitionerId",
          label: "Provider (time off / block)",
          type: "select",
          options: practitioners.map((p) => ({ value: p.id, label: clean(p.displayName) })),
          allowEmpty: "—",
        },
        { name: "siteId", label: "Site (closure)", type: "select", options: sites.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })), allowEmpty: "—" },
        { name: "startDate", label: "First day", type: "date", required: true, defaultValue: today },
        { name: "endDate", label: "Last day", type: "date", required: true, defaultValue: today },
        { name: "reason", label: "Reason (no clinical/personal details)", type: "text", required: true },
      ]}
      onSubmit={(v) =>
        apiFetch("/api/v1/schedule-exceptions", {
          method: "POST",
          body: {
            kind: v.kind,
            practitionerId: orNull(v.practitionerId),
            siteId: orNull(v.siteId),
            startAt: toZonedIso(boundaryInstant(v.startDate as string, "00:00", timezone, "start"), timezone),
            endAt: toZonedIso(boundaryInstant(addDays(v.endDate as string, 1), "00:00", timezone, "start"), timezone),
            reason: v.reason,
          },
        })
      }
    />
  );
}

/** Two-step inline confirmation (no browser dialogs). */
export function RowAction({ label, path, confirmText }: { label: string; path: string; confirmText: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!asking)
    return (
      <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span>{confirmText}</span>
      <Button
        size="sm"
        variant="danger"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await apiFetch(path, { method: "DELETE" });
            reliableRefresh(router);
          } catch (e) {
            setErr(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Yes
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setAsking(false)}>
        No
      </Button>
      {err && <span className="text-red-700">{err}</span>}
    </span>
  );
}
