# Device Evidence Stub

**Immutable fence.** This document refuses to claim device acceptance. CHR-55 remains the sole physical gate for Quicksilver production claim.

## Current Status
- deviceAcceptance: **not_recorded**
- Primary target: iPhone 16e / iOS 27
- SideStore IPA path documented in QuicksilverV1/Documentation/SIDESTORE.md
- Simulator / CI builds are necessary but insufficient

## Required Evidence (Owner-only)
1. Trigger Archive IPA workflow on QuicksilverV1 main.
2. Install unsigned IPA via SideStore on physical iPhone 16e (LocalDevVPN connected).
3. Validate surfaces: Sanctum / Home → Workshop → Observatory → Diagnostics → Memory → Ask.
4. Export Diagnostics summary (content-free) confirming no crashes and basic aspect routing.
5. Record timestamp and confirmation in Linear CHR-55 or this file (only after real upload).

## Explicit Non-Claims
- No agent may mark this as accepted.
- No simulator screenshot or CI log substitutes for physical device evidence.
- Spotlight (#416) or any other feature still requires this gate for full production claim.

## Innovation Note
Stub created 2026-11-13 14:04Z to protect the fence while automation surfaces the requirement. Update only with real evidence.
