# ADR-0008 — Upgrade Next.js 15.5 → 16.4

**Status:** Accepted (Phase 3, 2026-10-21)

## Context
During Phase 3 E2E work, client-side navigations and `router.refresh()` updates intermittently never appeared on screen
(the request completed with a correct, complete RSC payload, but React never committed the new tree). Measured in a
25-iteration Playwright loop (Projects → Billing Improvement board): **12–30 % of navigations stalled** on Next 15.5.28
(the latest 15.5 backport). Instrumentation showed the root's transition lanes left suspended on an already-fulfilled
Flight chunk with no ping — a framework-level issue, not app code. Disabling prefetch, gzip, or inlining CSS did not help.

## Decision
Upgrade to **Next.js 16.4.2** (latest stable). Required changes were small:
- `middleware.ts` → `proxy.ts` (`export function proxy`), same matcher and behaviour.
- Removed the `eslint` key from `next.config.ts` (Next 16 no longer runs ESLint; we already lint from the repo root).
- `@next/eslint-plugin-next` 16.4.2. Builds now use Turbopack (the Next 16 default).

As defence in depth, mutation components call `reliableRefresh()` (`apps/web/lib/refresh.ts`): the app layout renders a
per-request stamp; if it has not changed after a refresh, the refresh is retried once and then the page is reloaded,
so a user never keeps looking at stale data after a successful save.

## Consequences
- Same loop on 16.4.2: **0 / 50** stalled navigations; full E2E suite 25/25 on two consecutive fresh runs.
- Future upgrades: re-run the E2E suite twice from a fresh `pnpm db:reset` before accepting a framework bump.
