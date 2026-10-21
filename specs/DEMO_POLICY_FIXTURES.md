# Demo policy fixtures: NOT current law

**All entries below are invented for automated tests and demonstration only.** They MUST be labeled `DEMO SYNTHETIC POLICY — NOT VERIFIED LAW` and MUST NOT be deployed as production licensing rules.

## Fixture A — confirmed within designated state
- `Practitioner A`, profession physician, synthetic active VA authority; approved *test-only* VA in-person + VIDEO policy, patient verified in VA, provider VA, active associated site, no required payer issues, unoccupied slot => ALLOW.

## Fixture B — cross-state physician missing distinct state license
- A has VA authority, no verified MD authority. Patient physically in MD, VIDEO, no approved exception => REVIEW/BLOCK with no confirmation. IMLC participation flag alone does not change result.

## Fixture C — traveling patient
- Patient home VA, visit location MD. Decision uses MD. At check-in patient reports DC instead; reevaluate and block/review if no applicable DC authorization.

## Fixture D — RN compact privilege
- `Practitioner B`, profession RN, synthetic test multistate authorization with all conditions marked approved and destination among *test fixture approved states*: may ALLOW in fixture. A different APRN record with same RN credential does NOT receive authorization by inference.

## Fixture E — psychologist compact exception
- `Practitioner C`, profession psychologist, synthetic licensed in one PSYPACT test jurisdiction; no active verified APIT => REVIEW/BLOCK. When an active verified synthetic APIT plus all physical-location conditions and approved test rule are inserted, can ALLOW if other checks pass. Membership alone no allow.

## Fixture F — payer-site mismatch
- D has appropriate verified state authority, but payer X plan Y only approved at Site 1, not Site 2. Insurance visit at Site 2 => payer NOT_READY independent from license ALLOW; routine confirmation blocked if configured as required.

## Fixture G — authority lapse
- Provider authority expires Oct 31. Nov 1 booking disallowed even if slot is open. Suspended authority disallowed regardless of expiration date.

## Fixture H — unverified source and stale rule
- Authority uploaded but not verified, or governing policy review expires => REVIEW, `canConfirm=false`.

## Fixture I — resource race
- Two concurrent requests same provider and overlap, plus same room. Database exclusion constraint allows at most one ACTIVE reservation; loser gets 409, no outbound communication.

## Fixture J — EHR master offline
- Site mode EHR_MASTER; last synced time exceeds approved freshness; booking cannot be confirmed locally and is queued as draft for staff review.

## Fixture K — patient location unknown
- Virtual appointment's patient state unknown => REVIEW, cannot confirm until required location is recorded and evaluated.

Always assert exact `decision`, `canConfirm`, machine reason codes, evidence reference IDs and audit event creation; include unit tests without database and transaction tests with PostgreSQL.
