import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@projectos/db";
import { payerPlans, payers, practitionerSites, practitioners, professionalAuthorities, providerEnrollments, sites } from "@projectos/db/schema";
import type { AuthContext } from "@projectos/auth";
import { authorize, parse } from "@projectos/core";
import { ORG_TIMEZONE, readinessQuery, todayIn, type AuthorityType, type Profession } from "@projectos/shared";
import { practitionerScopeWhere } from "./access";
import { evaluateLicenseReadiness, evaluatePayerReadiness, type AuthorityFact, type RuleFact } from "./readiness";
import { loadApprovedRules } from "./rules";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toAuthorityFact(a: typeof professionalAuthorities.$inferSelect): AuthorityFact {
  return {
    id: a.id,
    authorityType: a.authorityType as AuthorityType,
    profession: a.profession as Profession,
    jurisdiction: a.jurisdiction,
    homeState: a.homeState,
    status: a.status,
    effectiveOn: a.effectiveOn,
    expiresOn: a.expiresOn,
    verifiedAt: iso(a.verifiedAt),
  };
}

export function toRuleFact(r: Awaited<ReturnType<typeof loadApprovedRules>>[number]): RuleFact {
  return { ...r, profession: r.profession as Profession, modality: r.modality as RuleFact["modality"] };
}

/**
 * Readiness matrix computed live from verified evidence + approved rules.
 * License readiness (provider × jurisdiction) and payer readiness (provider × site × plan) are separate outputs.
 */
export async function getReadinessMatrix(db: Db, ctx: AuthContext, query: unknown) {
  await authorize(db, ctx, "credentialing.read", "ANY");
  const q = parse(readinessQuery, query);
  const asOf = todayIn(ORG_TIMEZONE);
  const date = q.date ?? asOf;
  const where = [practitionerScopeWhere(ctx), eq(practitioners.active, true)];
  if (q.profession) where.push(eq(practitioners.profession, q.profession));
  const ps = await db
    .select()
    .from(practitioners)
    .where(and(...where))
    .orderBy(asc(practitioners.displayName));
  const ids = ps.map((p) => p.id);
  const [auths, rules, orgSites, links, plans, enrolls] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(professionalAuthorities)
          .where(and(eq(professionalAuthorities.organizationId, ctx.organizationId), inArray(professionalAuthorities.practitionerId, ids)))
      : [],
    loadApprovedRules(db, ctx.organizationId),
    db
      .select()
      .from(sites)
      .where(and(eq(sites.organizationId, ctx.organizationId), eq(sites.active, true)))
      .orderBy(asc(sites.code)),
    ids.length
      ? db
          .select()
          .from(practitionerSites)
          .where(and(eq(practitionerSites.organizationId, ctx.organizationId), inArray(practitionerSites.practitionerId, ids)))
      : [],
    db
      .select({ plan: payerPlans, payerName: payers.name })
      .from(payerPlans)
      .innerJoin(payers, eq(payers.id, payerPlans.payerId))
      .where(eq(payerPlans.organizationId, ctx.organizationId))
      .orderBy(asc(payers.name), asc(payerPlans.name)),
    ids.length
      ? db
          .select()
          .from(providerEnrollments)
          .where(and(eq(providerEnrollments.organizationId, ctx.organizationId), inArray(providerEnrollments.practitionerId, ids)))
      : [],
  ]);
  const ruleFacts = rules.map(toRuleFact);
  const jurisdictions = [
    ...new Set([
      ...orgSites.map((s) => s.state),
      ...rules.map((r) => r.jurisdiction),
      ...auths.filter((a) => a.authorityType !== "COMPACT_MEMBERSHIP_CLAIM").map((a) => a.jurisdiction),
    ]),
  ].sort();

  const license = ps.map((p) => {
    const facts = auths.filter((a) => a.practitionerId === p.id).map(toAuthorityFact);
    return {
      practitioner: { id: p.id, displayName: p.displayName, profession: p.profession, physicalState: p.physicalState },
      cells: Object.fromEntries(
        jurisdictions.map((j) => [
          j,
          evaluateLicenseReadiness(
            { profession: p.profession as Profession, jurisdiction: j, modality: q.modality, date, providerPhysicalState: p.physicalState, asOf },
            ruleFacts,
            facts,
          ),
        ]),
      ),
    };
  });

  const payer = ps.flatMap((p) =>
    links
      .filter((l) => l.practitionerId === p.id)
      .map((l) => {
        const site = orgSites.find((s) => s.id === l.siteId);
        return {
          practitioner: { id: p.id, displayName: p.displayName },
          site: site ? { id: site.id, code: site.code, state: site.state } : { id: l.siteId, code: "?", state: "" },
          plans: plans.map(({ plan, payerName }) => ({
            planId: plan.id,
            label: `${payerName} · ${plan.name}`,
            result: evaluatePayerReadiness(
              { practitionerId: p.id, siteId: l.siteId, date },
              { id: plan.id, requiresEnrollment: plan.requiresEnrollment },
              enrolls.map((e) => ({ ...e, verifiedAt: iso(e.verifiedAt) })),
            ),
          })),
        };
      }),
  );

  return {
    modality: q.modality,
    date,
    asOf,
    computedAt: new Date().toISOString(),
    jurisdictions,
    rulesConsidered: rules.length,
    demoRulesInUse: rules.some((r) => r.isDemo),
    license,
    payer,
  };
}

/** Readiness snapshot for one provider (all jurisdictions, both modalities). */
export async function getProviderReadiness(db: Db, ctx: AuthContext, practitionerId: string, date?: string) {
  const [video, inPerson] = await Promise.all([getReadinessMatrix(db, ctx, { modality: "VIDEO", date }), getReadinessMatrix(db, ctx, { modality: "IN_PERSON", date })]);
  return {
    jurisdictions: video.jurisdictions,
    VIDEO: video.license.find((r) => r.practitioner.id === practitionerId)?.cells ?? {},
    IN_PERSON: inPerson.license.find((r) => r.practitioner.id === practitionerId)?.cells ?? {},
    payer: video.payer.filter((r) => r.practitioner.id === practitionerId),
    demoRulesInUse: video.demoRulesInUse,
  };
}
