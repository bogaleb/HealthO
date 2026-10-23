"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

/**
 * Accessible modal built on the native <dialog> element: focus trapping, Esc to close,
 * inert background and focus restoration are provided by the browser.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  side,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Render as a right-hand drawer instead of a centered modal. */
  side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn(
        "p-0 text-slate-900 shadow-[0_30px_80px_-30px_rgb(7_9_13/0.55),0_0_0_1px_rgb(16_19_26/0.06)] backdrop:bg-ink-950/45 backdrop:backdrop-blur-[3px]",
        side ? "dlg-drawer m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl rounded-l-2xl" : cn("dlg-modal m-auto w-[calc(100%-2rem)] rounded-2xl", widths[size]),
      )}
    >
      {open && (
        <div className={cn("flex flex-col", side ? "h-full" : "max-h-[85dvh]")}>
          <div className="flex items-start justify-between gap-4 border-b border-[var(--hairline)] px-6 py-4">
            <div className="min-w-0">
              <h2 id="dialog-title" className="text-[17px] font-semibold tracking-[-0.015em]">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="press rounded-full p-1.5 text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-800" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-[var(--hairline)] bg-paper/80 px-6 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
