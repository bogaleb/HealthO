import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { listPayers } from "@projectos/credentialing";
import { hasAny, hasOrgWide } from "@projectos/auth";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { Forbidden } from "@/components/Forbidden";
import { NewPayerButton, NewPlanButton } from "@/components/credentialing/PayerForms";

export const metadata: Metadata = { title: "Payers & Plans" };

export default async function PayersPage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "credentialing.read")) return <Forbidden what="payers" />;
  const payers = await load(listPayers(getDb(), ctx));
  const canEdit = hasOrgWide(ctx, "credentialing.edit");
  return (
    <div>
      <PageHeader title="Payers & plans" description="Payer master data. Provider participation is tracked per plan and site on each provider's page." actions={canEdit && <NewPayerButton />} />
      {payers.length === 0 ? (
        <EmptyState title="No payers yet" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {payers.map((p) => (
            <Card key={p.id}>
              <CardHeader title={p.name} description={<span className="font-mono">{p.code}</span>} actions={canEdit && <NewPlanButton payerId={p.id} payerName={p.name} />} />
              <ul className="divide-y divide-slate-100 text-[13.5px]">
                {p.plans.map((pl) => (
                  <li key={pl.id} className="flex items-center justify-between px-4 py-2">
                    <span>{pl.name} <span className="font-mono text-xs text-slate-500">{pl.code}</span></span>
                    {pl.requiresEnrollment ? <Badge tone="blue">Enrollment required</Badge> : <Badge>No enrollment needed</Badge>}
                  </li>
                ))}
                {!p.plans.length && <li className="px-4 py-2 text-sm text-slate-500">No plans.</li>}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
