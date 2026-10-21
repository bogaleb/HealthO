import { CATEGORY_META, DECISION_LABEL, type EligibilityCategory, type EligibilityDecision } from "@projectos/shared";
import { Badge, cn, type Tone } from "@projectos/ui";

export const DECISION_TONE: Record<EligibilityDecision, Tone> = { ALLOW: "green", REVIEW: "amber", BLOCK: "red" };

export type Flag = { code: string; category: string; severity: string; message: string; remediation?: string; evidenceId?: string };
export type EligibilityLike = {
  decision: EligibilityDecision;
  summary: string;
  flags: Flag[];
  policyVersion?: string | null;
  isDemoPolicy?: boolean;
  evaluatedAt?: string | Date;
  stale?: boolean;
  jurisdiction?: string | null;
  evidenceIds?: string[];
};

export function DecisionBadge({ decision, stale }: { decision: EligibilityDecision | null | undefined; stale?: boolean }) {
  if (!decision) return <Badge tone="neutral">Not evaluated</Badge>;
  return (
    <Badge tone={stale ? "neutral" : DECISION_TONE[decision]}>
      {DECISION_LABEL[decision]}
      {stale ? " (stale — re-check)" : ""}
    </Badge>
  );
}

/** Readable explanation: decision, summary, every non-info reason with its category and remediation. */
export function EligibilityPanel({ e, compact }: { e: EligibilityLike; compact?: boolean }) {
  const issues = e.flags.filter((f) => f.severity !== "INFO");
  const tone = e.stale
    ? "border-slate-300 bg-slate-50"
    : e.decision === "ALLOW"
      ? "border-green-300 bg-green-50"
      : e.decision === "REVIEW"
        ? "border-amber-300 bg-amber-50"
        : "border-red-300 bg-red-50";
  return (
    <div className={cn("rounded-md border px-3 py-2 text-[13px]", tone)} data-testid="eligibility-panel" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <DecisionBadge decision={e.decision} stale={e.stale} />
        {e.policyVersion && (
          <span className="text-xs text-slate-600">
            Rule {e.policyVersion}
            {e.isDemoPolicy ? " · DEMO — not verified law" : ""}
          </span>
        )}
      </div>
      <p className="mt-1 font-medium">{e.summary}</p>
      {!compact && issues.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {issues.map((f, i) => {
            const meta = CATEGORY_META[f.category as EligibilityCategory];
            return (
              <li key={i} className="text-[12.5px]">
                <span className="font-semibold">{meta?.label ?? f.category}</span> <span className="font-mono text-[11px] text-slate-500">{f.code}</span> — {f.message}
                {f.remediation && <span className="block text-slate-600">Next step: {f.remediation}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {e.evaluatedAt && (
        <p className="mt-1 text-[11px] text-slate-500">
          Evaluated {new Date(e.evaluatedAt).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}
          {e.jurisdiction ? ` · patient location ${e.jurisdiction}` : ""}
          {e.evidenceIds?.length ? ` · ${e.evidenceIds.length} evidence record(s)` : ""}
        </p>
      )}
    </div>
  );
}
