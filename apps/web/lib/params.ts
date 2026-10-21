/** Keep only the known, PHI-free filter keys from a searchParams object. */
export function pickFilters(sp: Record<string, string | string[] | undefined>, keys: string[]) {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) {
    const v = sp[k];
    out[k] = Array.isArray(v) ? v[0] : v || undefined;
  }
  return out;
}
export const TASK_FILTER_KEYS = ["q", "status", "priority", "ownerUserId", "label", "dueFrom", "dueTo", "open", "mine", "page"];
