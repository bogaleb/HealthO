"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, ErrorState, Field, Input, Select, Textarea } from "@projectos/ui";
import { ApiError, errorMessage } from "@/lib/client";

export type FieldDef =
  | { name: string; label: string; type: "text" | "date" | "url" | "number"; required?: boolean; hint?: string; defaultValue?: string; placeholder?: string; maxLength?: number }
  | { name: string; label: string; type: "textarea"; required?: boolean; hint?: string; defaultValue?: string }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; hint?: string; defaultValue?: string; allowEmpty?: string }
  | { name: string; label: string; type: "checkbox"; hint?: string; defaultValue?: boolean }
  | { name: string; label: string; type: "multi"; options: { value: string; label: string }[]; hint?: string; defaultValue?: string[] };

type Values = Record<string, string | boolean | string[]>;

/**
 * Generic accessible form-in-a-dialog. `onSubmit` receives raw values and returns the API promise;
 * server validation messages are shown per field. On success the page data is refreshed.
 */
export function FormDialog({
  trigger,
  title,
  description,
  fields,
  submitLabel = "Save",
  danger,
  onSubmit,
  children,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description?: ReactNode;
  fields: FieldDef[];
  submitLabel?: string;
  danger?: boolean;
  onSubmit: (v: Values) => Promise<unknown>;
  children?: ReactNode;
}) {
  const router = useRouter();
  const init = (): Values => Object.fromEntries(fields.map((f) => [f.name, f.type === "checkbox" ? (f.defaultValue ?? false) : f.type === "multi" ? (f.defaultValue ?? []) : (f.defaultValue ?? "")]));
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Values>(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const id = (n: string) => `fd-${title.replace(/\W+/g, "-").toLowerCase()}-${n}`;
  const formId = id("form");

  return (
    <>
      {trigger(() => {
        setV(init());
        setError(null);
        setFe({});
        setOpen(true);
      })}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant={danger ? "danger" : "primary"} loading={busy}>
              {submitLabel}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          method="post"
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setFe({});
            try {
              await onSubmit(v);
              setOpen(false);
              router.refresh();
            } catch (err) {
              setError(errorMessage(err));
              if (err instanceof ApiError) setFe(err.fieldErrors());
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <ErrorState title="Not saved" message={error} />}
          {children}
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => {
              const wide = f.type === "textarea" || f.type === "multi" || f.type === "checkbox";
              if (f.type === "checkbox")
                return (
                  <label key={f.name} className="col-span-2 flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={v[f.name] as boolean} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} />
                    {f.label}
                  </label>
                );
              if (f.type === "multi")
                return (
                  <fieldset key={f.name} className="col-span-2">
                    <legend className="text-[13px] font-medium text-slate-700">{f.label}</legend>
                    {f.hint && <p className="text-xs text-slate-500">{f.hint}</p>}
                    <div className="mt-1 flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
                      {f.options.map((o) => (
                        <label key={o.value} className="flex items-center gap-1.5 text-[13px]">
                          <input
                            type="checkbox"
                            checked={(v[f.name] as string[]).includes(o.value)}
                            onChange={(e) => setV({ ...v, [f.name]: e.target.checked ? [...(v[f.name] as string[]), o.value] : (v[f.name] as string[]).filter((x) => x !== o.value) })}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                    {fe[f.name] && <p className="text-xs font-medium text-red-700">{fe[f.name]}</p>}
                  </fieldset>
                );
              return (
                <Field key={f.name} label={f.label + ("required" in f && f.required ? " *" : "")} htmlFor={id(f.name)} hint={f.hint} error={fe[f.name]} className={wide ? "col-span-2" : undefined}>
                  {f.type === "select" ? (
                    <Select id={id(f.name)} value={v[f.name] as string} required={f.required} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
                      {f.allowEmpty !== undefined && <option value="">{f.allowEmpty}</option>}
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : f.type === "textarea" ? (
                    <Textarea id={id(f.name)} rows={3} value={v[f.name] as string} required={f.required} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
                  ) : (
                    <Input
                      id={id(f.name)}
                      type={f.type}
                      value={v[f.name] as string}
                      required={f.required}
                      placeholder={f.placeholder}
                      maxLength={f.maxLength}
                      onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Helpers to turn empty strings into nulls for optional API fields. */
export const orNull = (s: unknown) => (typeof s === "string" && s.trim() === "" ? null : s);
