import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

// Primary = ink with a pearl sheen on hover; secondary = paper with a hairline; spring press on all of them.
const variants: Record<Variant, string> = {
  primary:
    "sheen bg-ink-900 text-white shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_1px_2px_rgb(16_19_26/0.2),0_8px_20px_-10px_rgb(43_51_105/0.55)] hover:bg-ink-800 disabled:bg-ink-900/45 disabled:shadow-none",
  secondary:
    "bg-white text-slate-800 border border-[var(--hairline-strong)] shadow-[0_1px_2px_rgb(16_19_26/0.05)] hover:border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-slate-700 hover:bg-slate-900/[0.05] disabled:text-slate-400",
  danger: "bg-red-700 text-white shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_6px_16px_-8px_rgb(185_28_28/0.6)] hover:bg-red-800 disabled:bg-red-700/50",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-4 text-sm" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "press inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium tracking-[-0.005em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}
