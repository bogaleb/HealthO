import type { Metadata } from "next";
import { getDb } from "@projectos/db";
import { hasAny } from "@projectos/auth";
import { workerStatus } from "@projectos/notifications";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@projectos/ui";
import { requireContext } from "@/lib/session";
import { formatInstant } from "@/lib/format";
import { Forbidden } from "@/components/Forbidden";
import { ReplayButton, RunScanButton } from "@/components/notifications/ReplayButton";

export const metadata: Metadata = { title: "Worker & Outbox" };

const STATUSES = ["PENDING", "PROCESSING", "RUNNING", "DONE", "FAILED", "DEAD"];

export default async function WorkerPage() {
  const ctx = await requireContext();
  if (!hasAny(ctx, "org.manage")) return <Forbidden what="worker status" />;
  const s = await workerStatus(getDb(), ctx);
  const counts = (c: Record<string, number>) => (
    <div className="flex flex-wrap gap-1.5 p-4">
      {STATUSES.filter((k) => c[k] !== undefined).map((k) => (
        <Badge key={k} tone={k === "DEAD" ? "red" : k === "FAILED" ? "amber" : k === "DONE" ? "green" : "neutral"}>
          {k}: {c[k]}
        </Badge>
      ))}
      {Object.keys(c).length === 0 && <span className="text-sm text-slate-500">No rows yet.</span>}
    </div>
  );
  return (
    <div>
      <PageHeader
        title="Worker & outbox"
        description={`Postgres job queue and notification outbox (no Redis). Computed ${formatInstant(s.computedAt)}. Failed rows retry with backoff; DEAD rows need a replay after the cause is fixed.`}
        actions={<RunScanButton />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Jobs" description={`Last completed: ${s.jobs.lastCompletedAt ? formatInstant(s.jobs.lastCompletedAt) : "never — is the worker running?"}`} />
          {counts(s.jobs.counts)}
        </Card>
        <Card>
          <CardHeader title="Notification outbox" description={`Last delivered: ${s.outbox.lastProcessedAt ? formatInstant(s.outbox.lastProcessedAt) : "never"}`} />
          {counts(s.outbox.counts)}
        </Card>
      </div>
      <h2 className="mb-2 mt-6 text-[15px] font-semibold">Needs attention</h2>
      {s.jobs.problems.length + s.outbox.problems.length === 0 ? (
        <EmptyState title="No failed or dead work" description="Everything the worker picked up has completed." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-[13px]" data-testid="worker-problems">
            <thead className="border-b border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Kind
                </th>
                <th scope="col" className="px-3 py-2">
                  Type
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2">
                  Attempts
                </th>
                <th scope="col" className="px-3 py-2">
                  Last error
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.outbox.problems.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">Outbox</td>
                  <td className="px-3 py-2">{p.type}</td>
                  <td className="px-3 py-2">
                    <Badge tone={p.status === "DEAD" ? "red" : "amber"}>{p.status}</Badge>
                  </td>
                  <td className="tabular px-3 py-2">
                    {p.attempts}/{p.maxAttempts}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.lastError ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {p.status !== "PROCESSING" && <ReplayButton path={`/api/v1/admin/outbox/${p.id}/replay`} label={`Replay outbox event ${p.type}`} />}
                  </td>
                </tr>
              ))}
              {s.jobs.problems.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">Job</td>
                  <td className="px-3 py-2">{p.type}</td>
                  <td className="px-3 py-2">
                    <Badge tone={p.status === "DEAD" ? "red" : "amber"}>{p.status}</Badge>
                  </td>
                  <td className="tabular px-3 py-2">
                    {p.attempts}/{p.maxAttempts}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.lastError ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <ReplayButton path={`/api/v1/admin/jobs/${p.id}/replay`} label={`Replay job ${p.type}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
