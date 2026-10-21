import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "teal" | "blue" | "amber" | "red" | "green" | "violet";
const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  teal: "bg-teal-50 text-teal-800 ring-teal-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

/** Status chip. Always carries a text label — color is never the only signal. */
export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
