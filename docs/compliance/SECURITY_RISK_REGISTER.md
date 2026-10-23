# Security risk register (DRAFT — not a formal HIPAA risk analysis)

Prioritized by likelihood × impact for the *software as built*. Status reflects Phase 8 (v0.3.0-rc.1). A qualified security officer must
perform the formal risk analysis for the real deployment.

| # | Risk | Likelihood / impact | Remediation | Status |
|---|---|---|---|---|
| 1 | Privileged account takeover (password only) | Medium / High | TOTP MFA + backup codes; mandatory for privileged roles outside synthetic modes (`REQUIRE_MFA_FOR_PRIVILEGED`); API also refuses privileged calls without MFA | **Done (Phase 7)** |
| 2 | Silent double booking / false confirmation against an authoritative EHR | Medium / High | EHR_MASTER fail-closed, DB CHECK forbids CONFIRMED before EHR acceptance, idempotent external create, reconciliation | **Done (Phase 7)** — simulator only |
| 3 | Undetected patient-record browsing | Medium / Medium | Patient search/read and appointment detail reads audited | **Done (Phase 7)**; review process external |
| 4 | Data loss / unrecoverable DB | Low / High | Encrypted dump + verified restore drill script | **Done**; off-host copy, RPO/RTO approval external |
| 5 | Secrets committed to the repo | Low / High | Secret scan in CI (`pnpm security:scan`); gitleaks over full history in `security.yml`; Terraform never holds secret values | **Done** — gitleaks full-history scan green in CI |
| 6 | Vulnerable dependencies | Medium / Medium | vitest 4.1.12 + esbuild override → `pnpm audit --prod`: no known vulnerabilities (2026-10-22); CI fails on high/critical; weekly scheduled scan; Trivy on images | **Done (Phase 8)** — Trivy image scan green in CI |
| 7 | Production image contains dev dependencies | Medium / Low | Standalone Next server + esbuild bundles, no pnpm/source/dev deps, non-root; CI manifest guard | **Done (Phase 8)** — images built + smoke-tested on Docker Desktop (RC SEC-IMG) |
| 8 | CSP allows inline scripts | Low / Medium | Per-request nonce + strict-dynamic; styles still `unsafe-inline` (React style attributes) | **Done (Phase 8)** for scripts; style residual accepted |
| 9 | In-memory rate limiting (single instance) | Low / Medium | Postgres-backed counters; trusted-proxy IP resolution; WAF rate rule at the edge | **Done (Phase 8)** |
| 10 | Invites shown on screen (no email) | Low / Medium | Email invites through a vetted vendor | **Open** — vendor decision (RC GATE-INVITE) |
| 11 | Session hijack | Low / High | httpOnly SameSite cookies, 8 h sessions, origin check on mutations; HSTS; TLS 1.2+ ALB policy + secure cookies when `https` (IaC) | IaC done; live HTTPS pending deployment |
| 12 | Unverified licensure rules used in production | Medium / High | Rules labelled DEMO; readiness check fails while any DEMO rule is approved | Done (gate); counsel review external |
| 13 | EHR vendor capability assumed | Medium / High | Capabilities must be verified per connection; unverified vendor adapter refuses everything and shows "Not connected" | Done |
| 14 | Authorization checked after reading record state (information leak) | Low / Medium | Auto-discovered privilege matrix e2e over every mutating route; two leaks fixed (RCM undo, waitlist offer) | **Done (Phase 8)** |
| 15 | Application DB user can alter schema / disable audit triggers | Low / High | Runtime role `projectos_app` with DML only; migrations use a separate master credential | **Done (Phase 8)** — e2e 45/45 as that role |
| 16 | Patient identifiers leak into logs | Medium / High | Structured logs without patient fields; CI scan of real logs against every patient identity; RDS statement logging off; WAF logs redacted | **Done (Phase 8)** |
| 17 | Failed or destructive migration in production | Medium / High | Release task with pre-migration backup, schema-contract smoke, automatic restore; expand/contract rule; ECS circuit breaker | **Done (Phase 8)** — drilled locally |
| 18 | Restored deployment inherits rate-limit lock-outs | Low / Low | Ephemeral counters excluded from dumps | **Done (Phase 8)** (found by the clean-restore drill) |
| 19 | Web container root filesystem writable | Low / Medium | Read-only root + scratch volume for `.next/cache` | **Open** — verify in staging (RC SEC-ROFS) |
| 20 | Cloud configuration drift / misconfiguration | Medium / High | Terraform + checkov (313/0) + `tofu test` PHI gate; AWS Config/Security Hub as account baseline | IaC done; baseline is an organization item |
| 21 | Missing organization filter in a query (app-only isolation) | Low / High | PostgreSQL RLS on every tenant table, runtime role bound to its organization, fail-closed when unbound (ADR-0015) | **Done (2026-10-23)** |
