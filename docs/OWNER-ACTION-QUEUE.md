# Owner Action Queue

Living checklist of owner-gated actions. Updated with evidence. Does not invent authorization. Do not claim applied until owner confirms.

## Pending Security Migrations (Critical)
- [ ] Resonance #265: lock down Supabase public API ACLs and RLS. PR open, tests green on CI, **NOT applied** to live DB. Owner must review policy changes and explicitly authorize production application.
- [ ] Resonance #208: composite indexes for GET /api/nexus/executions. Migration in PR, **NOT applied**. Owner must apply after review.
- [ ] Resonance #196: verify-rls.sql + docs for migration-vs-live drift. Supporting evidence.

## Device Acceptance Fence (High)
- [ ] CHR-55: Record real iPhone 16e / iOS 27 IPA install + basic surface validation via Diagnostics export (content-free). deviceAcceptance remains **not_recorded**. Simulator is insufficient.

## Optional Adapter Gates (Medium)
- [ ] Configure GITHUB_TOKEN + webhook secret on Resonance Netlify host so githubAdapterConfigured becomes true. Not required for /ready.

## Entropy / Hygiene
- [ ] Review and merge or close residual drafts after CI: Conduit #321 (HTTP factory), Conduit #120 (migrations), Resonance #250 (two-key draft).
- [ ] QuicksilverV1 #416 Spotlight opt-in: review after CI green; physical device verification still required for full acceptance.

## How to Update
Owner or authorized agent updates checkboxes only after explicit confirmation and evidence (e.g., migration applied, device log uploaded). This file is the surface; it does not execute changes.
