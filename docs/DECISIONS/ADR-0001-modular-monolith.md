# ADR-0001 — Modular monolith

**Status:** Accepted (Phase 0)

One Next.js deployment (`apps/web`) plus one Postgres-polling worker (`apps/worker`). Domain logic lives in framework-free packages (`packages/core`, `auth`, `db`, `shared`); the web app only adapts HTTP/React to use-cases. An ESLint `no-restricted-imports` rule forbids `next`/`react` imports from domain packages.

**Why:** lowest hosting/ops cost, one place to enforce authorization, easy to extract a module later. **Not chosen:** microservices, NestJS process, Redis/Kafka (no load justifies them).

Future modules (`scheduling`, `licensing`, `credentialing`, `rcm`, `notifications`, `integrations`) get their own packages when their phase starts — none are created speculatively.
