import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { listRules } from "@projectos/credentialing";
import { hasAny, hasOrgWide } from "@projectos/auth";
import { AUTHORITY_TYPE_LABEL, MODALITY_LABEL, PROFESSION_LABEL, todayIn, type AuthorityType, type Modality, type Profession } from "@projectos/shared";
import { Badge, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { formatDate, humanize } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { NewRuleButton, RuleActions } from "@/components/credentialing/RuleForms";

export const metadata: Metadata = { title: "License Policy Rules" };

export default async function RulesPage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "credentialing.read") && !hasAny(ctx, "policy.publish")) return <Forbidden what="license policy rules" />;
  const rules = await load(listRules(getDb(), ctx));
  const today = todayIn("America/New_York");
  const canDraft = hasOrgWide(ctx, "credentialing.edit") || hasOrgWide(ctx, "policy.publish");
  const canPublish = hasOrgWide(ctx, "policy.publish");
  return (
    <div>
      <PageHeader
        title="License policy rules"
        description="Effective-dated, versioned rules stating which verified evidence permits a profession to serve a patient located in a jurisdiction by a modality. The app makes no legal conclusion on its own: rules must be reviewed by qualified staff."
        actions={canDraft && <NewRuleButton />}
      />
      <p role="note" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
        <strong>Rules marked DEMO are synthetic fixtures — NOT VERIFIED LAW.</strong> Approved rules are immutable (enforced in the database); change a rule by drafting a new version. Jurisdictions with no approved rule always show “No approved policy”.
      </p>
      {rules.length === 0 ? (
        <EmptyState title="No rules" description="Without approved rules, every readiness check returns 'No approved policy'." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">Rule</th>
                <th scope="col" className="px-3 py-2">Accepted evidence</th>
                <th scope="col" className="px-3 py-2">Conditions</th>
                <th scope="col" className="px-3 py-2">Effective</th>
                <th scope="col" className="px-3 py-2">Review due</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">Author → approver</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((r) => (
                <tr key={r.id} className="align-top" data-testid={`rule-${r.ruleKey}-v${r.ruleVersion}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.jurisdiction} · {PROFESSION_LABEL[r.profession as Profession]} · {MODALITY_LABEL[r.modality as Modality]}</div>
                    <div className="font-mono text-[11px] text-slate-500">{r.ruleKey} v{r.ruleVersion}</div>
                    {r.isDemo && <Badge tone="amber" className="mt-1">DEMO — not verified law</Badge>}
                  </td>
                  <td className="px-3 py-2">{r.authorizationBasis.map((b) => <div key={b}>{AUTHORITY_TYPE_LABEL[b as AuthorityType]}</div>)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {r.acceptedHomeStates.length > 0 && <div>Home states: {r.acceptedHomeStates.join(", ")}</div>}
                    {r.providerStates.length > 0 ? <div>Provider in: {r.providerStates.join(", ")}</div> : <div>Provider anywhere in US</div>}
                    {r.serviceCategory && <div>Service: {humanize(r.serviceCategory)}</div>}
                  </td>
                  <td className="tabular px-3 py-2">{formatDate(r.effectiveFrom)}{r.effectiveTo && <> – {formatDate(r.effectiveTo)}</>}</td>
                  <td className={`tabular px-3 py-2 ${r.nextReviewOn < today ? "font-semibold text-red-700" : ""}`}>{formatDate(r.nextReviewOn)}{r.nextReviewOn < today && <div className="text-xs">Overdue — readiness on hold</div>}</td>
                  <td className="px-3 py-2"><Badge tone={r.status === "APPROVED" ? "green" : r.status === "DRAFT" ? "amber" : "neutral"}>{humanize(r.status)}</Badge></td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.creatorName ?? "—"} → {r.approverName ?? "—"}</td>
                  <td className="px-3 py-2 text-right"><RuleActions id={r.id} status={r.status} canPublish={canPublish} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
