"use client";
import { Plus } from "lucide-react";
import { Button } from "@projectos/ui";
import {
  AUTHORIZING_TYPES,
  AUTHORITY_TYPE_LABEL,
  MODALITIES,
  MODALITY_LABEL,
  PROFESSIONS,
  PROFESSION_LABEL,
  SERVICE_CATEGORIES,
  US_JURISDICTIONS,
  addDays,
  todayIn,
} from "@projectos/shared";
import { apiFetch } from "@/lib/client";
import { humanize } from "@/lib/format";
import { FormDialog, orNull } from "@/components/FormDialog";

const states = US_JURISDICTIONS.map((j) => ({ value: j, label: j }));
// Local calendar date (not UTC: after 8 pm Eastern the UTC date is already tomorrow).
const plus = (n: number) => addDays(todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone), n);

export function NewRuleButton() {
  return (
    <FormDialog
      title="New policy rule (draft)"
      description="Drafts never affect readiness. A different person with policy-publish rights must approve it. Never encode a compact as a blanket allow: list accepted home states explicitly."
      submitLabel="Save draft"
      trigger={(open) => (
        <Button onClick={open}>
          <Plus className="h-4 w-4" aria-hidden /> New rule draft
        </Button>
      )}
      fields={[
        { name: "jurisdiction", label: "Patient location (jurisdiction)", type: "select", required: true, options: states, defaultValue: "DC" },
        {
          name: "profession",
          label: "Profession",
          type: "select",
          required: true,
          options: PROFESSIONS.map((p) => ({ value: p, label: PROFESSION_LABEL[p] })),
          defaultValue: "LCSW",
        },
        { name: "modality", label: "Modality", type: "select", required: true, options: MODALITIES.map((m) => ({ value: m, label: MODALITY_LABEL[m] })), defaultValue: "VIDEO" },
        {
          name: "serviceCategory",
          label: "Service category",
          type: "select",
          options: SERVICE_CATEGORIES.map((s) => ({ value: s, label: humanize(s) })),
          allowEmpty: "Any service",
        },
        {
          name: "authorizationBasis",
          label: "Evidence types that satisfy this rule",
          type: "multi",
          options: AUTHORIZING_TYPES.map((t) => ({ value: t, label: AUTHORITY_TYPE_LABEL[t] })),
          defaultValue: ["STATE_LICENSE"],
        },
        { name: "acceptedHomeStates", label: "Accepted home states (multistate / APIT only)", type: "multi", options: states },
        { name: "providerStates", label: "Provider must be physically in (empty = anywhere in US)", type: "multi", options: states },
        { name: "effectiveFrom", label: "Effective from", type: "date", required: true, defaultValue: plus(0) },
        { name: "effectiveTo", label: "Effective to", type: "date" },
        { name: "nextReviewOn", label: "Next review due", type: "date", required: true, defaultValue: plus(180) },
        { name: "sourceUrl", label: "Source URL", type: "url" },
        { name: "sourceSummary", label: "Source summary / rationale", type: "textarea", required: true, defaultValue: "DEMO SYNTHETIC POLICY — NOT VERIFIED LAW." },
        { name: "isDemo", label: "Demo / synthetic rule (label everywhere as NOT VERIFIED LAW)", type: "checkbox", defaultValue: true },
      ]}
      onSubmit={(v) =>
        apiFetch("/api/v1/policy-rules", {
          method: "POST",
          body: { ...v, serviceCategory: orNull(v.serviceCategory), effectiveTo: orNull(v.effectiveTo), sourceUrl: orNull(v.sourceUrl) },
        })
      }
    />
  );
}

export function RuleActions({ id, status, canPublish }: { id: string; status: string; canPublish: boolean }) {
  if (!canPublish) return null;
  if (status === "DRAFT")
    return (
      <FormDialog
        title="Approve and publish rule"
        description="Publishing makes this rule count in readiness and supersedes any earlier approved version of the same rule. Dual control: you cannot approve a rule you authored."
        submitLabel="Approve"
        trigger={(open) => (
          <Button size="sm" onClick={open}>
            Approve
          </Button>
        )}
        fields={[{ name: "reason", label: "Approval reason / review reference", type: "textarea", required: true }]}
        onSubmit={(v) => apiFetch(`/api/v1/policy-rules/${id}/approve`, { method: "POST", body: { reason: v.reason } })}
      />
    );
  if (status === "APPROVED")
    return (
      <FormDialog
        title="Retire rule"
        description="Readiness that depended on this rule becomes 'No approved policy'. Existing appointments are not cancelled automatically."
        submitLabel="Retire"
        danger
        trigger={(open) => (
          <Button size="sm" variant="ghost" className="text-red-700" onClick={open}>
            Retire
          </Button>
        )}
        fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]}
        onSubmit={(v) => apiFetch(`/api/v1/policy-rules/${id}/retire`, { method: "POST", body: { reason: v.reason } })}
      />
    );
  return null;
}
