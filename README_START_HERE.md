# ProjectOS Health — Claude-Ready Development Package

## What's in the package

- `MASTER_BLUEPRINT.md` — comprehensive PRD, business workflows, scheduling licensing logic, architecture, database design, API, UX, security, budget, tests, phased delivery and references.
- `CLAUDE.md` — persistent development instructions Claude Code should read on each session.
- `prompts/00_START_HERE.md` through `prompts/09_COMMERCIAL_EXPANSION.md` — copy-paste phase-specific coding prompts.
- `specs/TEST_CASES.csv` — acceptance cases, especially cross-state provider booking and concurrency.
- `specs/DEMO_POLICY_FIXTURES.md` — explicitly synthetic licensing scenarios, not current-law rules.
- `specs/GO_LIVE_CHECKLIST.md` — conditions that **must** be complete before any PHI/patient operation.
- `specs/IMPLEMENTATION_TRACKER.csv` — work sequencing and hard pass/fail gates.

## Recommended use

1. Make a **private** GitHub repository: `projectos-health`.
2. Add the entire **contents of this package to the repo root**. Keep docs under source control; no real credentials or patient files.
3. Install Node LTS, pnpm, Docker/Podman, Git and Claude Code on the development machine. An AI coding tool subscription/API may cost money; this blueprint does not include subscription charges.
4. In the repository directory, start Claude Code and paste the entire content of `prompts/00_START_HERE.md`.
5. Have Claude implement Phase 0, run it, verify login. Then proceed through prompts in order, not all at once.
6. Insist that Claude runs the verification commands and presents actual errors/fixes. Do not accept a screenshot as proof that data persistence or booking safety works.
7. Use **synthetic records only** until the PHI-readiness checklist is independently approved.

## Version-1 architecture decisions

- One organization, many clinics/sites/providers/users.
- Next.js / TypeScript / PostgreSQL / Drizzle.
- No paid services or cloud required until local release works.
- No SMS, AI inference, EHR connector, patient portal, subscriptions or public self-booking required for the first working build.
- An appointment can be confirmed only if server-side license/payer/service/availability checks pass, including the relevant patient's actual location and any provider-location restrictions.
- Source-of-truth with an existing EHR must be decided before any live scheduling.

## What success looks like

A scheduler logs into a browser, chooses a fake patient and specialty, selects video from Maryland or in-person at a configured site, sees only eligible provider slots with explanations, books with conflict-safe persistence, changes a patient state at check-in and sees a valid licensing block if appropriate. A credentialing specialist changes a synthetic authorization; scheduling readiness recalculates. A revenue cycle analyst can manage real persisted **synthetic** work cases, and managers can view a functioning projects board and live dashboards.

## What this package is not

This is a detailed engineering specification, not a built app, a legal determination, a HIPAA compliance attestation, or authorization to handle patient information.
