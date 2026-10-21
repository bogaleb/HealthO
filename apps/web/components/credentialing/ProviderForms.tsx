"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Plus } from "lucide-react";
import { Button, Dialog, Spinner } from "@projectos/ui";
import { AUTHORITY_TYPES, AUTHORITY_TYPE_LABEL, CASE_TYPES, ENROLLMENT_STATUSES, PROFESSIONS, PROFESSION_LABEL, US_JURISDICTIONS, type Profession } from "@projectos/shared";
import { apiFetch, errorMessage } from "@/lib/client";
import { formatInstant, humanize } from "@/lib/format";
import { FormDialog, orNull } from "@/components/FormDialog";

interface Ref {
  sites: { id: string; code: string; name: string }[];
  specialties: { id: string; name: string }[];
  services: { id: string; name: string }[];
}
const states = US_JURISDICTIONS.map((j) => ({ value: j, label: j }));
const today = () => new Date().toISOString().slice(0, 10);

export function NewProviderButton({ reference }: { reference: Ref }) {
  const router = useRouter();
  return (
    <FormDialog
      title="New provider"
      description="Use fictional (synthetic) providers only. Evidence is added after creation."
      submitLabel="Create provider"
      trigger={(open) => (
        <Button onClick={open}>
          <Plus className="h-4 w-4" aria-hidden /> New provider
        </Button>
      )}
      fields={[
        { name: "displayName", label: "Display name", type: "text", required: true, placeholder: "Practitioner X (SYNTHETIC)" },
        { name: "profession", label: "Profession", type: "select", required: true, options: PROFESSIONS.map((p) => ({ value: p, label: PROFESSION_LABEL[p] })), defaultValue: "PHYSICIAN" },
        { name: "physicalState", label: "Usually works physically from", type: "select", options: states, allowEmpty: "Unknown" },
        { name: "npi", label: "NPI (synthetic, optional)", type: "text", maxLength: 10 },
        { name: "telehealthCapable", label: "Telehealth capable", type: "checkbox" },
        { name: "siteIds", label: "Sites", type: "multi", options: reference.sites.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })) },
        { name: "specialtyIds", label: "Specialties", type: "multi", options: reference.specialties.map((s) => ({ value: s.id, label: s.name })) },
        { name: "serviceIds", label: "Services offered", type: "multi", options: reference.services.map((s) => ({ value: s.id, label: s.name })) },
      ]}
      onSubmit={async (v) => {
        const p = await apiFetch<{ id: string }>("/api/v1/practitioners", { method: "POST", body: { ...v, npi: orNull(v.npi), physicalState: orNull(v.physicalState) } });
        router.push(`/providers/${p.id}`);
      }}
    />
  );
}

export function EditProviderButton({ p, reference, siteIds, specialtyIds, serviceIds }: { p: { id: string; displayName: string; physicalState: string | null; telehealthCapable: boolean; active: boolean; version: number }; reference: Ref; siteIds: string[]; specialtyIds: string[]; serviceIds: string[] }) {
  return (
    <FormDialog
      title="Edit provider"
      trigger={(open) => (
        <Button variant="secondary" size="sm" onClick={open}>
          Edit details
        </Button>
      )}
      fields={[
        { name: "displayName", label: "Display name", type: "text", required: true, defaultValue: p.displayName },
        { name: "physicalState", label: "Usually works physically from", type: "select", options: states, allowEmpty: "Unknown", defaultValue: p.physicalState ?? "" },
        { name: "telehealthCapable", label: "Telehealth capable", type: "checkbox", defaultValue: p.telehealthCapable },
        { name: "active", label: "Active", type: "checkbox", defaultValue: p.active },
        { name: "siteIds", label: "Sites", type: "multi", options: reference.sites.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })), defaultValue: siteIds },
        { name: "specialtyIds", label: "Specialties", type: "multi", options: reference.specialties.map((s) => ({ value: s.id, label: s.name })), defaultValue: specialtyIds },
        { name: "serviceIds", label: "Services offered", type: "multi", options: reference.services.map((s) => ({ value: s.id, label: s.name })), defaultValue: serviceIds },
      ]}
      onSubmit={(v) => apiFetch(`/api/v1/practitioners/${p.id}`, { method: "PATCH", body: { ...v, physicalState: orNull(v.physicalState), version: p.version } })}
    />
  );
}

export function AddAuthorityButton({ practitionerId, profession }: { practitionerId: string; profession: Profession }) {
  return (
    <FormDialog
      title="Add license / authority evidence"
      description="Saved as a DRAFT. It authorizes nothing until it is submitted and verified by an approver against a primary source."
      submitLabel="Save draft"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add evidence
        </Button>
      )}
      fields={[
        { name: "authorityType", label: "Type", type: "select", required: true, options: AUTHORITY_TYPES.map((t) => ({ value: t, label: AUTHORITY_TYPE_LABEL[t] })), defaultValue: "STATE_LICENSE" },
        { name: "profession", label: "For profession", type: "select", required: true, options: PROFESSIONS.map((p) => ({ value: p, label: PROFESSION_LABEL[p] })), defaultValue: profession, hint: "Must match the provider's profession." },
        { name: "jurisdiction", label: "Issuing jurisdiction", type: "select", required: true, options: states, defaultValue: "VA" },
        { name: "homeState", label: "Home state (multistate/APIT)", type: "select", options: states, allowEmpty: "Not applicable" },
        { name: "licenseNumberLast4", label: "License # — last 4 only", type: "text", maxLength: 4, hint: "Full numbers are never stored." },
        { name: "issuingAuthority", label: "Issuing board", type: "text" },
        { name: "effectiveOn", label: "Effective on", type: "date", required: true, defaultValue: today() },
        { name: "expiresOn", label: "Expires on", type: "date" },
        { name: "restrictions", label: "Restrictions / notes", type: "textarea" },
      ]}
      onSubmit={(v) =>
        apiFetch(`/api/v1/practitioners/${practitionerId}/authorities`, {
          method: "POST",
          body: { ...v, homeState: orNull(v.homeState), licenseNumberLast4: orNull(v.licenseNumberLast4), issuingAuthority: orNull(v.issuingAuthority), expiresOn: orNull(v.expiresOn), restrictions: orNull(v.restrictions) },
        })
      }
    />
  );
}

export function AuthorityActions({ a, canEdit, canApprove }: { a: { id: string; status: string; version: number; authorityType: string }; canEdit: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {canEdit && (a.status === "DRAFT" || a.status === "REJECTED") && (
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await apiFetch(`/api/v1/authorities/${a.id}/submit-review`, { method: "POST", body: { version: a.version } });
              router.refresh();
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Submit for verification
        </Button>
      )}
      {canApprove && a.status === "SUBMITTED" && a.authorityType !== "COMPACT_MEMBERSHIP_CLAIM" && (
        <FormDialog
          title="Verify evidence"
          description="Record the primary source you checked. Dual control: you cannot verify evidence you entered or submitted."
          submitLabel="Mark verified"
          trigger={(open) => (
            <Button size="sm" onClick={open}>
              Verify
            </Button>
          )}
          fields={[
            { name: "sourceName", label: "Primary source checked", type: "text", required: true, placeholder: "e.g. State board online lookup (synthetic)" },
            { name: "sourceUrl", label: "Source URL", type: "url" },
            { name: "verifiedOn", label: "Verified on", type: "date", required: true, defaultValue: today() },
            { name: "nextReviewOn", label: "Next review", type: "date" },
            { name: "note", label: "Note", type: "textarea" },
          ]}
          onSubmit={(v) => apiFetch(`/api/v1/authorities/${a.id}/approve`, { method: "POST", body: { ...v, sourceUrl: orNull(v.sourceUrl), nextReviewOn: orNull(v.nextReviewOn), note: orNull(v.note), version: a.version } })}
        />
      )}
      {canApprove && a.status === "SUBMITTED" && (
        <FormDialog
          title="Reject evidence"
          submitLabel="Reject"
          danger
          trigger={(open) => (
            <Button size="sm" variant="ghost" className="text-red-700" onClick={open}>
              Reject
            </Button>
          )}
          fields={[{ name: "note", label: "Reason", type: "textarea", required: true }]}
          onSubmit={(v) => apiFetch(`/api/v1/authorities/${a.id}/reject`, { method: "POST", body: { note: v.note, version: a.version } })}
        />
      )}
      {canApprove && (a.status === "VERIFIED" || a.status === "SUSPENDED") && (
        <FormDialog
          title="Suspend or revoke authority"
          description="Readiness for this profession and jurisdiction is blocked immediately. Future visits are not cancelled automatically."
          submitLabel="Apply"
          danger
          trigger={(open) => (
            <Button size="sm" variant="ghost" className="text-red-700" onClick={open}>
              Suspend / revoke
            </Button>
          )}
          fields={[
            { name: "status", label: "New status", type: "select", required: true, options: [{ value: "SUSPENDED", label: "Suspended" }, { value: "REVOKED", label: "Revoked" }], defaultValue: "SUSPENDED" },
            { name: "note", label: "Reason / source", type: "textarea", required: true },
          ]}
          onSubmit={(v) => apiFetch(`/api/v1/authorities/${a.id}/status`, { method: "POST", body: { ...v, version: a.version } })}
        />
      )}
      <HistoryButton authorityId={a.id} />
      {err && <p role="alert" className="w-full text-right text-xs text-red-700">{err}</p>}
    </div>
  );
}

function HistoryButton({ authorityId }: { authorityId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ id: string; action: string; fromStatus: string | null; toStatus: string; actorName: string | null; sourceName: string | null; note: string | null; createdAt: string }[] | null>(null);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Verification history"
        onClick={async () => {
          setOpen(true);
          setRows(await apiFetch(`/api/v1/authorities/${authorityId}/history`));
        }}
      >
        <History className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Verification history" description="Append-only record of every status change.">
        {!rows ? (
          <Spinner />
        ) : (
          <ol className="space-y-2 text-[13px]">
            {rows.map((h) => (
              <li key={h.id} className="rounded border border-slate-200 px-3 py-2">
                <div className="font-medium">
                  {humanize(h.action)} {h.fromStatus && <>· {humanize(h.fromStatus)} → </>}
                  {humanize(h.toStatus)}
                </div>
                <div className="text-xs text-slate-500">
                  {h.actorName ?? "System"} · {formatInstant(h.createdAt)}
                </div>
                {h.sourceName && <div className="text-xs">Source: {h.sourceName}</div>}
                {h.note && <div className="text-xs text-slate-700">{h.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </Dialog>
    </>
  );
}

export function AddEnrollmentButton({ practitionerId, sites, plans }: { practitionerId: string; sites: { id: string; code: string }[]; plans: { id: string; label: string }[] }) {
  return (
    <FormDialog
      title="Add payer enrollment"
      description="Enrollment is per provider × plan × site. Approval at one site never implies another."
      submitLabel="Add enrollment"
      trigger={(open) => (
        <Button size="sm" onClick={open} disabled={!sites.length || !plans.length}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add enrollment
        </Button>
      )}
      fields={[
        { name: "payerPlanId", label: "Payer plan", type: "select", required: true, options: plans.map((p) => ({ value: p.id, label: p.label })), defaultValue: plans[0]?.id },
        { name: "siteId", label: "Site", type: "select", required: true, options: sites.map((s) => ({ value: s.id, label: s.code })), defaultValue: sites[0]?.id },
        { name: "status", label: "Status", type: "select", options: ["NOT_STARTED", "SUBMITTED", "AWAITING_INFO"].map((s) => ({ value: s, label: humanize(s) })), defaultValue: "NOT_STARTED" },
        { name: "submittedOn", label: "Submitted on", type: "date" },
      ]}
      onSubmit={(v) => apiFetch("/api/v1/enrollments", { method: "POST", body: { ...v, practitionerId, submittedOn: orNull(v.submittedOn) } })}
    />
  );
}

export function EnrollmentActions({ e, canEdit, canApprove }: { e: { id: string; status: string; version: number; submittedOn: string | null; approvedOn: string | null; effectiveOn: string | null; terminatedOn: string | null; verifiedAt: string | null }; canEdit: boolean; canApprove: boolean }) {
  return (
    <div className="flex justify-end gap-1">
      {canEdit && (
        <FormDialog
          title="Update enrollment"
          description="Any change clears verification; an approver must re-verify. Approval needs both the confirmation date and the (possibly retro) effective date."
          trigger={(open) => (
            <Button size="sm" variant="secondary" onClick={open}>
              Update
            </Button>
          )}
          fields={[
            { name: "status", label: "Status", type: "select", required: true, options: ENROLLMENT_STATUSES.map((s) => ({ value: s, label: humanize(s) })), defaultValue: e.status },
            { name: "submittedOn", label: "Submitted on", type: "date", defaultValue: e.submittedOn ?? "" },
            { name: "approvedOn", label: "Approval confirmed on", type: "date", defaultValue: e.approvedOn ?? "" },
            { name: "effectiveOn", label: "Participation effective (retro) date", type: "date", defaultValue: e.effectiveOn ?? "" },
            { name: "terminatedOn", label: "Terminated on", type: "date", defaultValue: e.terminatedOn ?? "" },
            { name: "note", label: "Note", type: "textarea" },
          ]}
          onSubmit={(v) =>
            apiFetch(`/api/v1/enrollments/${e.id}`, {
              method: "PATCH",
              body: { status: v.status, submittedOn: orNull(v.submittedOn), approvedOn: orNull(v.approvedOn), effectiveOn: orNull(v.effectiveOn), terminatedOn: orNull(v.terminatedOn), note: orNull(v.note), version: e.version },
            })
          }
        />
      )}
      {canApprove && e.status === "APPROVED" && !e.verifiedAt && (
        <FormDialog
          title="Verify payer approval"
          description="Dual control: the person who recorded the approval cannot verify it."
          submitLabel="Verify"
          trigger={(open) => (
            <Button size="sm" onClick={open}>
              Verify
            </Button>
          )}
          fields={[{ name: "sourceName", label: "Evidence checked", type: "text", required: true, placeholder: "e.g. payer approval letter (synthetic)" }]}
          onSubmit={(v) => apiFetch(`/api/v1/enrollments/${e.id}/verify`, { method: "POST", body: { sourceName: v.sourceName, version: e.version } })}
        />
      )}
    </div>
  );
}

export function NewCaseButton({ practitioners, members, defaultPractitionerId }: { practitioners: { id: string; displayName: string }[]; members: { userId: string; displayName: string }[]; defaultPractitionerId?: string }) {
  return (
    <FormDialog
      title="New credentialing case"
      submitLabel="Create case"
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> New case
        </Button>
      )}
      fields={[
        { name: "practitionerId", label: "Provider", type: "select", required: true, options: practitioners.map((p) => ({ value: p.id, label: p.displayName })), defaultValue: defaultPractitionerId ?? practitioners[0]?.id },
        { name: "caseType", label: "Type", type: "select", required: true, options: CASE_TYPES.map((c) => ({ value: c, label: humanize(c) })), defaultValue: "LICENSE_NEW_STATE" },
        { name: "title", label: "Title", type: "text", required: true },
        { name: "ownerUserId", label: "Owner", type: "select", options: members.map((m) => ({ value: m.userId, label: m.displayName })), allowEmpty: "Unassigned" },
        { name: "dueDate", label: "Due", type: "date" },
        { name: "nextAction", label: "Next action", type: "text" },
      ]}
      onSubmit={(v) => apiFetch("/api/v1/credentialing/cases", { method: "POST", body: { ...v, ownerUserId: orNull(v.ownerUserId), dueDate: orNull(v.dueDate), nextAction: orNull(v.nextAction) } })}
    />
  );
}
