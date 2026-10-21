# ADR-0006 — Local invite simulation (no email)

**Status:** Accepted for synthetic modes. **Must be replaced before any cloud deployment.**

Invitations create a single-use, 7-day token; only its SHA-256 hash is stored. The token is shown **once** to the inviting admin, who shares it out of band; the invitee redeems it on `/invite` (POST body, never a URL). An existing identity cannot be attached via invite (prevents account takeover).

**Upgrade task:** deliver invites through an approved email provider (no PHI in content) and add MFA enrollment at acceptance. Tracked in PROGRESS.md.
