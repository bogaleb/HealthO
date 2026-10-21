"use client";

type Router = { refresh: () => void };

const stamp = () => document.querySelector("[data-render-stamp]")?.getAttribute("data-render-stamp") ?? null;

/**
 * router.refresh() whose result is confirmed.
 *
 * On content-heavy pages we observed (Next 15.5 / React 19.2) that a refresh is occasionally fetched
 * but never committed, leaving stale data on screen after a successful mutation. The app layout renders
 * a per-request stamp; if it has not changed after a refresh we retry once, then fall back to a full
 * reload so the user never sees stale state after a mutation.
 */
export function reliableRefresh(router: Router, opts: { waitMs?: number } = {}) {
  const wait = opts.waitMs ?? 2500;
  const before = stamp();
  router.refresh();
  if (before === null) return;
  let retried = false;
  const check = () => {
    if (stamp() !== before) return;
    if (!retried) {
      retried = true;
      router.refresh();
      window.setTimeout(check, wait);
      return;
    }
    window.location.reload();
  };
  window.setTimeout(check, wait);
}
