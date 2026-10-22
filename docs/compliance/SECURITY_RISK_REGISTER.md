# Security risk register (DRAFT — not a formal HIPAA risk analysis)

Prioritized by likelihood × impact for the *software as built*. Status reflects Phase 7. A qualified security officer must
perform the formal risk analysis for the real deployment.

| # | Risk | Likelihood / impact | Remediation | Status |
|---|---|---|---|---|
| 1 | Privileged account takeover (password only) | Medium / High | TOTP MFA + backup codes; mandatory for privileged roles outside synthetic modes (`REQUIRE_MFA_FOR_PRIVILEGED`); API also refuses privileged calls without MFA | **Done (Phase 7)** |
| 2 | Silent double booking / false confirmation against an authoritative EHR | Medium / High | EHR_MASTER fail-closed, DB CHECK forbids CONFIRMED before EHR acceptance, idempotent external create, reconciliation | **Done (Phase 7)** — simulator only |
| 3 | Undetected patient-record browsing | Medium / Medium | Patient search/read and appointment detail reads audited | **Done (Phase 7)**; review process external |
| 4 | Data loss / unrecoverable DB | Low / High | Encrypted dump + verified restore drill script | **Done**; off-host copy, RPO/RTO approval external |
| 5 | Secrets committed to the repo | Low / High | Secret scan in CI (`pnpm security:scan`) | **Done** (basic); add gitleaks in Phase 8 |
| 6 | Vulnerable dependencies | Medium / Medium | `pnpm audit` in CI. Current findings (2026-10-22): vitest/tinypool/@vitest/mocker/esbuild — **dev/test tooling only**, pulled in as better-auth peer deps; not executed in production | Accepted for synthetic phase; upgrade vitest 4 + slim production image (Phase 8) |
| 7 | Production image contains dev dependencies | Medium / Low | `pnpm deploy --prod` / multi-stage prune | Phase 8 |
| 8 | CSP allows inline scripts | Low / Medium | Nonce-based CSP | Phase 8 |
| 9 | In-memory rate limiting (single instance) | Low / Medium | Shared store when scaling out | Phase 8 |
| 10 | Invites shown on screen (no email) | Low / Medium | Email invites through a vetted vendor | Phase 8 (needs vendor decision) |
| 11 | Session hijack | Low / High | httpOnly SameSite cookies, 8 h sessions, origin check on mutations; HTTPS required in prod | Partly; HTTPS is a deployment item |
| 12 | Unverified licensure rules used in production | Medium / High | Rules labelled DEMO; readiness check fails while any DEMO rule is approved | Done (gate); counsel review external |
| 13 | EHR vendor capability assumed | Medium / High | Capabilities must be verified per connection; unverified vendor adapter refuses everything and shows "Not connected" | Done |
