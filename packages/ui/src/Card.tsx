import type { ReactNode } from "react";
import { cn } from "./cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-[var(--hairline)] bg-white shadow-[var(--shadow-card)]", className)}>{children}</section>;
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-3.5">
      <div>
        <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Page title with the app's one orchestrated motion: the title rises line-by-line out of a mask and a pearl
 * hairline draws beneath it. Reduced motion → static.
 */
export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="reveal-mask mb-1.5">
              <div className="reveal-line text-[13px] font-medium text-slate-500">{eyebrow}</div>
            </div>
          )}
          <h1 className="display-title text-[30px] md:text-[34px]">
            <span className="reveal-mask">
              <span className="reveal-line" style={{ ["--i" as string]: 1 }}>
                {title}
              </span>
            </span>
          </h1>
          {description && (
            <div className="reveal-mask mt-2">
              <p className="reveal-line max-w-3xl text-[14.5px] leading-relaxed text-slate-600" style={{ ["--i" as string]: 2 }}>
                {description}
              </p>
            </div>
          )}
        </div>
        {actions && (
          <div className="rise flex flex-wrap gap-2" style={{ ["--i" as string]: 3 }}>
            {actions}
          </div>
        )}
      </div>
      <div aria-hidden className="rule-draw mt-5" />
    </header>
  );
}
