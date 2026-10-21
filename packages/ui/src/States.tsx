import type { ReactNode } from "react";
import { cn } from "./cn";

export function EmptyState({ title, description, action, className }: { title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center", className)}>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, action }: { title?: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm font-semibold text-red-800">{title}</p>
      {message && <p className="mt-0.5 text-sm text-red-700">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-slate-200/70", className)} />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-r-transparent" aria-hidden />
      {label}
    </span>
  );
}
