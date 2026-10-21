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
        "backdrop:bg-slate-900/40 p-0 text-slate-900 shadow-xl",
        side ? "m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl rounded-none border-l border-slate-200" : cn("w-[calc(100%-2rem)] rounded-lg", widths[size]),
      )}
    >
      {open && (
        <div className={cn("flex flex-col", side ? "h-full" : "max-h-[85dvh]")}>
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
            <div className="min-w-0">
              <h2 id="dialog-title" className="text-base font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
