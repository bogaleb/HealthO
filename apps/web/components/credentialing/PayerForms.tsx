"use client";
import { Plus } from "lucide-react";
import { Button } from "@projectos/ui";
import { apiFetch } from "@/lib/client";
import { FormDialog } from "@/components/FormDialog";

export function NewPayerButton() {
  return (
    <FormDialog
      title="New payer"
      description="Synthetic payer names only in demo mode."
      trigger={(open) => (
        <Button onClick={open}>
          <Plus className="h-4 w-4" aria-hidden /> New payer
        </Button>
      )}
      fields={[
        { name: "code", label: "Code", type: "text", required: true, maxLength: 16 },
        { name: "name", label: "Name", type: "text", required: true },
      ]}
      onSubmit={(v) => apiFetch("/api/v1/payers", { method: "POST", body: v })}
    />
  );
}

export function NewPlanButton({ payerId, payerName }: { payerId: string; payerName: string }) {
  return (
    <FormDialog
      title={`New plan for ${payerName}`}
      trigger={(open) => (
        <Button size="sm" variant="secondary" onClick={open}>
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add plan
        </Button>
      )}
      fields={[
        { name: "code", label: "Code", type: "text", required: true, maxLength: 16 },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "requiresEnrollment", label: "Providers must be enrolled (per site) to see these patients", type: "checkbox", defaultValue: true },
      ]}
      onSubmit={(v) => apiFetch("/api/v1/payer-plans", { method: "POST", body: { ...v, payerId } })}
    />
  );
}
