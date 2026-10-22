import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { hasAny } from "@projectos/auth";
import { EHR_CAPABILITIES, EHR_CAPABILITY_LABEL, getIntegrationHealth } from "@projectos/integrations";
import { EHR_STATE_LABEL } from "@projectos/shared";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { formatInstant } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { ConflictActions, ConnectSimulatorButton, ConnectionControls, SiteModeForm } from "@/components/integrations/IntegrationActions";
import { ReplayButton } from "@/components/notifications/ReplayButton";

export const metadata: Metadata = { title: "Integration Health" };

const MODE_HELP: Record<string, string> = {
  DEMO: "Synthetic demo — not an authoritative schedule.",
  EHR_MASTER: "The EHR is the official schedule: ProjectOS writes through the adapter and confirms only after the EHR accepts. Stale/unreachable → drafts only.",
  READ_ONLY: "ProjectOS shows and suggests; appointments are made in the EHR.",
  STANDALONE_APPROVED: "ProjectOS is the official schedule (requires signed approval and an approved APP_MODE).",
};

export default async function IntegrationsPage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "integrations.manage") && !hasAny(ctx, "scheduling.configure")) return <Forbidden what="integration health" />;
  const h = await getIntegrationHealth(getDb(), ctx);
  const canManage = hasAny(ctx, "integrations.manage");
  return (
    <div>
      <PageHeader
        eyebrow="Administration · EHR integration (Phase 7)"
        title="Integration health"
        description={
          <>
            Source of truth per site, EHR connection status, data freshness, write-through queue and conflicts. Computed {formatInstant(h.computedAt)}. Only a{" "}
            <strong>synthetic EHR simulator</strong> exists in this build — no real EHR is connected and no vendor capability has been verified.
          </>
        }
      />
      <div role="note" className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
        NOT APPROVED FOR REAL PHI. Connecting a real EHR needs a vendor agreement, verified API documentation and test access, a signed source-of-truth decision and the PHI
        readiness gate (Administration → PHI Readiness).
      </div>

      <div className="space-y-4">
        {h.sites.map((s) => (
          <Card key={s.site.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2" data-testid={`site-${s.site.code}`}>
                  {s.site.code} — {s.site.name}
                  <Badge tone={s.site.mode === "EHR_MASTER" ? "violet" : s.site.mode === "DEMO" ? "neutral" : "blue"}>{s.site.mode}</Badge>
                  {s.connection ? <Badge tone={s.connection.label.tone}>{s.connection.label.text}</Badge> : <Badge>No EHR connection</Badge>}
                </span>
              }
              description={MODE_HELP[s.site.mode]}
            />
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5 self-start text-[13px]">
                <dt className="text-slate-500">Data freshness</dt>
                <dd>
                  {s.site.lastSyncedAt ? (
                    <span className={s.fresh ? "text-green-800" : "font-semibold text-red-700"}>
                      Last availability sync {formatInstant(s.site.lastSyncedAt)} ({s.site.ageMin} min ago; limit {s.site.freshnessMinutes}) — {s.fresh ? "current" : "STALE"}
                    </span>
                  ) : (
                    <span className="text-slate-500">Never synchronized</span>
                  )}
                </dd>
                {s.connection && (
                  <>
                    <dt className="text-slate-500">Last health check</dt>
                    <dd>{s.connection.lastHealthAt ? `${formatInstant(s.connection.lastHealthAt)} — ${s.connection.lastHealthOk ? "OK" : "FAILED"}` : "Never"}</dd>
                    <dt className="text-slate-500">Last success</dt>
                    <dd>{s.connection.lastSuccessAt ? formatInstant(s.connection.lastSuccessAt) : "—"}</dd>
                    <dt className="text-slate-500">Last error</dt>
                    <dd className={s.connection.lastError ? "text-red-700" : ""}>
                      {s.connection.lastError ? `${s.connection.lastError} (${formatInstant(s.connection.lastErrorAt)})` : "—"}
                    </dd>
                    {s.connection.simulatorFailureMode && (
                      <>
                        <dt className="text-slate-500">Simulator mode</dt>
                        <dd>
                          <Badge tone={s.connection.simulatorFailureMode === "NONE" ? "green" : "red"}>{s.connection.simulatorFailureMode}</Badge>
                        </dd>
                      </>
                    )}
                  </>
                )}
                <dt className="text-slate-500">Bookings by EHR state</dt>
                <dd className="flex flex-wrap gap-1">
                  {Object.keys(s.ehrStates).length === 0 ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    Object.entries(s.ehrStates).map(([k, n]) => (
                      <Badge key={k} tone={k === "SYNCED" ? "green" : k === "FAILED" || k === "CONFLICT" ? "red" : "amber"}>
                        {EHR_STATE_LABEL[k] ?? k}: {n}
                      </Badge>
                    ))
                  )}
                </dd>
              </dl>
              <div className="space-y-3">
                {s.connection ? (
                  <table className="w-full text-left text-[12.5px]" aria-label={`${s.site.code} capabilities`}>
                    <thead className="text-[11.5px] font-semibold text-slate-600">
                      <tr>
                        <th scope="col" className="py-1">
                          Capability
                        </th>
                        <th scope="col" className="py-1">
                          Supported
                        </th>
                        <th scope="col" className="py-1">
                          Verified (by)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {EHR_CAPABILITIES.map((c) => {
                        const f = s.connection!.capabilities[c];
                        return (
                          <tr key={c}>
                            <td className="py-1">{EHR_CAPABILITY_LABEL[c]}</td>
                            <td className="py-1">{f.supported ? "Yes" : <span className="text-slate-500">No</span>}</td>
                            <td className="py-1">
                              {f.verified ? <span className="text-green-800">{f.verifiedBy}</span> : <span className="text-red-700">Not verified — not used</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[13px] text-slate-600">No connection. A real vendor can be added only after its API access and capabilities are verified.</p>
                )}
                {canManage && <SiteModeForm siteId={s.site.id} mode={s.site.mode} freshness={s.site.freshnessMinutes} connected={!!s.connection?.usableWrite} />}
                {canManage && !s.connection && <ConnectSimulatorButton siteId={s.site.id} />}
                {canManage && s.connection && s.connection.vendor === "SYNTHETIC_SIMULATOR" && (
                  <ConnectionControls
                    connectionId={s.connection.id}
                    simulator
                    failureMode={s.connection.simulatorFailureMode}
                    synced={s.syncedUpcoming.map((a) => ({ id: a.appointmentId, label: `${formatInstant(a.startAt)} (${a.status.toLowerCase()})` }))}
                  />
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <h2 className="mb-2 mt-8 text-[15px] font-semibold">Open conflicts ({h.conflicts.length})</h2>
      {h.conflicts.length === 0 ? (
        <EmptyState title="No open conflicts" description="Mapping, write and reconciliation problems appear here — they are never resolved silently." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-[13px]" data-testid="conflicts-table">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Kind
                </th>
                <th scope="col" className="px-3 py-2">
                  Detail
                </th>
                <th scope="col" className="px-3 py-2">
                  Raised
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {h.conflicts.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-3 py-2">
                    <Badge tone="red">{c.kind}</Badge>
                  </td>
                  <td className="max-w-xl px-3 py-2 text-slate-700">{c.detail}</td>
                  <td className="tabular px-3 py-2 text-slate-600">{formatInstant(c.createdAt.toISOString())}</td>
                  <td className="px-3 py-2">
                    {canManage ? (
                      <ConflictActions
                        id={c.id}
                        kind={c.kind}
                        canRetry={!!c.appointmentId && ["WRITE_FAILED", "WRITE_REJECTED", "PATIENT_NOT_FOUND", "PATIENT_AMBIGUOUS", "UNMAPPED_RESOURCE"].includes(c.kind)}
                      />
                    ) : (
                      <span className="text-xs text-slate-500">Read-only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="EHR write queue (outbox)"
            description="Every EHR write is queued in the same transaction as the booking; retries back off; dead letters need a fix and a replay."
          />
          <div className="space-y-2 p-4 text-[13px]">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(h.outbox.counts).map(([k, n]) => (
                <Badge key={k} tone={k === "DEAD" ? "red" : k === "FAILED" ? "amber" : k === "DONE" ? "green" : "neutral"}>
                  {k}: {n}
                </Badge>
              ))}
              {Object.keys(h.outbox.counts).length === 0 && <span className="text-slate-500">No EHR writes yet.</span>}
            </div>
            {h.outbox.problems.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-2 rounded border border-slate-200 p-2">
                <div>
                  <Badge tone={p.status === "DEAD" ? "red" : "amber"}>{p.status}</Badge>{" "}
                  <span className="text-slate-700">
                    {(p.payload as { op?: string }).op} · attempts {p.attempts}/{p.maxAttempts} · {p.lastError ?? ""}
                  </span>
                </div>
                {canManage && hasAny(ctx, "org.manage") && <ReplayButton path={`/api/v1/admin/outbox/${p.id}/replay`} label={`Replay EHR write ${p.id}`} />}
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent sync runs" description="Health, availability, change feed and reconciliation — append-only log." />
          <ul className="divide-y divide-slate-100 text-[12.5px]" data-testid="sync-runs">
            {h.runs.slice(0, 14).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                <span>
                  <Badge tone={r.status === "OK" ? "green" : "red"}>{r.kind}</Badge> <span className="text-slate-600">{formatInstant(r.startedAt.toISOString())}</span>
                </span>
                <span className="truncate text-slate-600">
                  {r.error ??
                    Object.entries(r.stats as Record<string, unknown>)
                      .map(([k, v]) => `${k} ${String(v)}`)
                      .join(" · ")}
                </span>
              </li>
            ))}
            {h.runs.length === 0 && <li className="px-4 py-3 text-slate-500">No runs yet. The worker syncs every 5 minutes.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
