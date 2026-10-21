import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@projectos/ui";
import { AUTHORITY_STATUS_TONE, READINESS_LABEL, READINESS_TONE, daysUntil, formatDate, humanize } from "@/lib/format";

export function ExpiryBadge({ expiresOn, status, today }: { expiresOn: string | null; status: string; today: string }) {
  if (!expiresOn) return <span className="text-xs text-slate-500">No expiration</span>;
  const d = daysUntil(expiresOn, today);
  if (d < 0 || status === "EXPIRED") return <Badge tone="red" icon={<XCircle className="h-3 w-3" aria-hidden />}>Expired {formatDate(expiresOn)}</Badge>;
  if (d <= 30) return <Badge tone="red" icon={<AlertTriangle className="h-3 w-3" aria-hidden />}>Expires in {d} d</Badge>;
  if (d <= 90) return <Badge tone="amber" icon={<Clock className="h-3 w-3" aria-hidden />}>Expires in {d} d</Badge>;
  return <span className="tabular text-xs text-slate-600">Expires {formatDate(expiresOn)}</span>;
}

export function AuthorityStatusBadge({ status }: { status: string }) {
  return <Badge tone={AUTHORITY_STATUS_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

export interface CellResult {
  status: string;
  decision: string;
  reasons: { code: string; message: string; severity: string }[];
  ruleLabel: string | null;
  isDemoRule: boolean;
  validThrough: string | null;
}

/** Readiness cell: label + icon (never color alone) with an accessible disclosure of every reason. */
export function ReadinessCell({ r, compact }: { r: CellResult; compact?: boolean }) {
  const Icon = r.decision === "ALLOW" ? CheckCircle2 : r.decision === "BLOCK" ? XCircle : AlertTriangle;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none rounded focus-visible:outline-2 focus-visible:outline-teal-600 [&::-webkit-details-marker]:hidden">
        <Badge tone={READINESS_TONE[r.decision]} icon={<Icon className="h-3 w-3" aria-hidden />}>
          {READINESS_LABEL[r.status] ?? r.status}
        </Badge>
        {!compact && r.validThrough && <span className="ml-1 text-[11px] text-slate-500">thru {formatDate(r.validThrough, { withYear: true })}</span>}
      </summary>
      <div className="mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 text-[12px] shadow-sm">
        {r.ruleLabel && (
          <p className="mb-1 text-slate-500">
            Rule {r.ruleLabel}
            {r.isDemoRule && <span className="ml-1 font-semibold text-amber-700">(DEMO — not verified law)</span>}
          </p>
        )}
        <ul className="space-y-1">
          {r.reasons
            .filter((x) => x.code !== "DEMO_RULE")
            .map((x, i) => (
              <li key={i} className={x.severity === "BLOCK" ? "text-red-800" : x.severity === "REVIEW" ? "text-amber-900" : "text-slate-700"}>
                <span className="font-mono text-[10.5px]">{x.code}</span> — {x.message}
              </li>
            ))}
        </ul>
      </div>
    </details>
  );
}
