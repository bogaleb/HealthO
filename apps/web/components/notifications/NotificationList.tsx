"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, EmptyState } from "@projectos/ui";
import { apiFetch, errorMessage } from "@/lib/client";
import { reliableRefresh } from "@/lib/refresh";
import { formatInstant, humanize } from "@/lib/format";

type Item = { id: string; kind: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

const TONE: Record<string, "red" | "amber" | "blue" | "violet" | "neutral"> = {
  RCM_OVERDUE: "red",
  TASK_OVERDUE: "red",
  RCM_DUE_SOON: "amber",
  TASK_DUE_SOON: "amber",
  RCM_ESCALATED: "violet",
  RCM_ASSIGNED: "blue",
};

export function NotificationList({ items, unread }: { items: Item[]; unread: number }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mark = async (body: unknown) => {
    setErr(null);
    setBusy(true);
    try {
      await apiFetch("/api/v1/notifications/read", { method: "POST", body });
      reliableRefresh(router);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!items.length) return <EmptyState title="No notifications" description="Due-soon, overdue, assignment and escalation reminders appear here." />;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-600" aria-live="polite">
          {unread} unread
        </p>
        <Button size="sm" variant="secondary" disabled={!unread} loading={busy} onClick={() => mark({ all: true })}>
          Mark all read
        </Button>
      </div>
      {err && (
        <p role="alert" className="mb-2 text-sm text-red-700">
          {err}
        </p>
      )}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid="notification-list">
        {items.map((n) => (
          <li key={n.id} className={`flex items-start justify-between gap-3 px-4 py-3 ${n.readAt ? "" : "bg-amber-50/50"}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[n.kind] ?? "neutral"}>{humanize(n.kind.replace(/^RCM_|^TASK_/, ""))}</Badge>
                {n.link ? (
                  <Link href={n.link} className="font-medium text-slate-900 hover:underline" onClick={() => !n.readAt && void mark({ ids: [n.id] })}>
                    {n.title}
                  </Link>
                ) : (
                  <span className="font-medium">{n.title}</span>
                )}
                {!n.readAt && <span className="sr-only">(unread)</span>}
              </div>
              {n.body && <p className="mt-0.5 text-[13px] text-slate-600">{n.body}</p>}
              <time className="tabular text-xs text-slate-500" dateTime={n.createdAt}>
                {formatInstant(n.createdAt)}
              </time>
            </div>
            {!n.readAt && (
              <Button size="sm" variant="ghost" onClick={() => mark({ ids: [n.id] })} aria-label={`Mark "${n.title}" read`}>
                Mark read
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
