import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@projectos/db";
import { listMemberDirectory } from "@projectos/core";
import { getPractitionerDetail, getProviderReadiness, listCases, listPayers, listReference } from "@projectos/credentialing";
import { AUTHORITY_TYPE_LABEL, MODALITY_LABEL, PROFESSION_LABEL, todayIn, type AuthorityType, type Profession } from "@projectos/shared";
import { Badge, Card, CardHeader, EmptyState } from "@projectos/ui";
import { requireContext, load } from "@/lib/session";
import { CASE_STATUS_TONE, ENROLLMENT_TONE, PAYER_LABEL, PAYER_TONE, formatDate, formatInstant, humanize } from "@/lib/format";
import { AuthorityStatusBadge, ExpiryBadge, ReadinessCell } from "@/components/credentialing/Badges";
import { AddAuthorityButton, AddEnrollmentButton, AuthorityActions, EditProviderButton, EnrollmentActions, NewCaseButton } from "@/components/credentialing/ProviderForms";

export const metadata: Metadata = { title: "Provider" };

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const db = getDb();
  const d = await load(getPractitionerDetail(db, ctx, id));
  const [ref, readiness, cases, payerList, members] = await Promise.all([listReference(db, ctx), getProviderReadiness(db, ctx, id), listCases(db, ctx, { practitionerId: id }), listPayers(db, ctx), listMemberDirectory(db, ctx)]);
  const today = todayIn("America/New_York");
  const p = d.practitioner;
  const siteById = new Map(ref.sites.map((s) => [s.id, s]));
  const plans = payerList.flatMap((py) => py.plans.map((pl) => ({ id: pl.id, label: `${py.name} · ${pl.name}` })));
  const planLabel = new Map(plans.map((x) => [x.id, x.label]));
  const sortedAuth = [...d.authorities].sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.authorityType.localeCompare(b.authorityType));

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-[12.5px] text-slate-500">
          <Link href="/providers" className="hover:underline">Providers</Link> / {p.displayName}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{p.displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-600">
              <Badge>{PROFESSION_LABEL[p.profession as Profession]}</Badge>
              {!p.active && <Badge tone="red">Inactive</Badge>}
              {p.isSynthetic && <Badge tone="amber">SYNTHETIC</Badge>}
              <span>Works physically from {p.physicalState ?? "unknown"}</span>
              <span>· Sites: {d.siteIds.map((s) => siteById.get(s)?.code).join(", ") || "none"}</span>
              <span>· {p.telehealthCapable ? "Telehealth capable" : "In person only"}</span>
              {p.npi && <span>· NPI {p.npi}</span>}
            </div>
          </div>
          {d.permissions.edit && <EditProviderButton p={p} reference={ref} siteIds={d.siteIds} specialtyIds={d.specialtyIds} serviceIds={d.serviceIds} />}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Licenses & authorities"
          description="Evidence authorizes nothing until verified by an approver. Compact membership claims are informational only."
          actions={d.permissions.edit && <AddAuthorityButton practitionerId={p.id} profession={p.profession as Profession} />}
        />
        {sortedAuth.length === 0 ? (
          <div className="p-4"><EmptyState title="No evidence on file" description="Add a license or other authority to begin verification." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2">State</th>
                  <th scope="col" className="px-3 py-2">Type</th>
                  <th scope="col" className="px-3 py-2">Number</th>
                  <th scope="col" className="px-3 py-2">Effective</th>
                  <th scope="col" className="px-3 py-2">Expiration</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Verified</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedAuth.map((a) => (
                  <tr key={a.id} data-testid={`authority-${a.jurisdiction}-${a.authorityType}`}>
                    <td className="px-3 py-2 font-medium">{a.jurisdiction}{a.homeState && a.homeState !== a.jurisdiction && <span className="text-xs text-slate-500"> (home {a.homeState})</span>}</td>
                    <td className="px-3 py-2">{AUTHORITY_TYPE_LABEL[a.authorityType as AuthorityType]}<div className="text-xs text-slate-500">{PROFESSION_LABEL[a.profession as Profession]}</div></td>
                    <td className="px-3 py-2 font-mono text-[12px]">{a.licenseNumberLast4 ? `••••${a.licenseNumberLast4}` : "—"}</td>
                    <td className="tabular px-3 py-2">{formatDate(a.effectiveOn)}</td>
                    <td className="px-3 py-2"><ExpiryBadge expiresOn={a.expiresOn} status={a.status} today={today} /></td>
                    <td className="px-3 py-2"><AuthorityStatusBadge status={a.status} /></td>
                    <td className="px-3 py-2 text-xs text-slate-600">{a.verifiedAt ? formatInstant(a.verifiedAt) : "—"}</td>
                    <td className="px-3 py-2"><AuthorityActions a={a} canEdit={d.permissions.edit} canApprove={d.permissions.approve} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="License readiness (today)"
          description={
            <>
              Derived from verified evidence + compliance-approved rules. Click a status for reasons.
              {readiness.demoRulesInUse && <span className="ml-1 font-semibold text-amber-700">DEMO SYNTHETIC POLICY — NOT VERIFIED LAW.</span>}
            </>
          }
        />
        <div className="overflow-x-auto p-3">
          <table className="text-left text-[13px]">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1 text-[12px] font-semibold text-slate-600">Patient located in</th>
                {(["IN_PERSON", "VIDEO"] as const).map((m) => <th key={m} scope="col" className="px-2 py-1 text-[12px] font-semibold text-slate-600">{MODALITY_LABEL[m]}</th>)}
              </tr>
            </thead>
            <tbody>
              {readiness.jurisdictions.map((j) => (
                <tr key={j} className="align-top">
                  <th scope="row" className="px-2 py-1 font-medium">{j}</th>
                  <td className="px-2 py-1" data-testid={`readiness-${j}-IN_PERSON`}>{readiness.IN_PERSON[j] && <ReadinessCell r={readiness.IN_PERSON[j]!} />}</td>
                  <td className="px-2 py-1" data-testid={`readiness-${j}-VIDEO`}>{readiness.VIDEO[j] && <ReadinessCell r={readiness.VIDEO[j]!} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Payer enrollment"
          description="Independent of licensure. Per plan × site; the approval confirmation date and the retro effective date are shown separately."
          actions={d.permissions.edit && <AddEnrollmentButton practitionerId={p.id} sites={d.siteIds.map((s) => ({ id: s, code: siteById.get(s)?.code ?? "?" }))} plans={plans} />}
        />
        {d.enrollments.length === 0 ? (
          <div className="p-4"><EmptyState title="No enrollments" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2">Plan</th>
                  <th scope="col" className="px-3 py-2">Site</th>
                  <th scope="col" className="px-3 py-2">Status</th>
                  <th scope="col" className="px-3 py-2">Submitted</th>
                  <th scope="col" className="px-3 py-2">Approval confirmed</th>
                  <th scope="col" className="px-3 py-2">Effective (retro)</th>
                  <th scope="col" className="px-3 py-2">Readiness today</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.enrollments.map((e) => {
                  const r = readiness.payer.find((x) => x.site.id === e.siteId)?.plans.find((x) => x.planId === e.payerPlanId)?.result;
                  return (
                    <tr key={e.id}>
                      <td className="px-3 py-2">{planLabel.get(e.payerPlanId)}</td>
                      <td className="px-3 py-2">{siteById.get(e.siteId)?.code}</td>
                      <td className="px-3 py-2"><Badge tone={ENROLLMENT_TONE[e.status]}>{humanize(e.status)}</Badge>{e.status === "APPROVED" && !e.verifiedAt && <Badge tone="amber" className="ml-1">Unverified</Badge>}</td>
                      <td className="tabular px-3 py-2">{formatDate(e.submittedOn)}</td>
                      <td className="tabular px-3 py-2">{formatDate(e.approvedOn)}</td>
                      <td className="tabular px-3 py-2">{formatDate(e.effectiveOn)}</td>
                      <td className="px-3 py-2">{r && <Badge tone={PAYER_TONE[r.status]} className="cursor-help" >{PAYER_LABEL[r.status]}</Badge>}{r && <div className="text-[11px] text-slate-500">{r.reasons[0]?.message}</div>}</td>
                      <td className="px-3 py-2"><EnrollmentActions e={{ ...e, verifiedAt: e.verifiedAt ? e.verifiedAt.toISOString() : null }} canEdit={d.permissions.edit} canApprove={d.permissions.approve} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Credentialing cases" actions={d.permissions.edit && <NewCaseButton practitioners={[{ id: p.id, displayName: p.displayName }]} members={members} defaultPractitionerId={p.id} />} />
        {cases.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">No cases.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-[13.5px]">
            {cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="flex-1 font-medium">{c.title}</span>
                <Badge>{humanize(c.caseType)}</Badge>
                <Badge tone={CASE_STATUS_TONE[c.status]}>{humanize(c.status)}</Badge>
                <span className="text-xs text-slate-500">due {formatDate(c.dueDate)} · {c.ownerName ?? "Unassigned"}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100 px-4 py-2 text-right">
          <Link href={`/credentialing/cases?practitionerId=${p.id}`} className="text-[13px] font-medium text-teal-700 hover:underline">Open in case queue →</Link>
        </div>
      </Card>
    </div>
  );
}
