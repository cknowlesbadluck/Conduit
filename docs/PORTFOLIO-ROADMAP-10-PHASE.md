# Portfolio 10-phase roadmap — refreshed 2026-11-02 18:00 UTC (full audit + innovate)

**Canonical source:** This file (mirrors to be updated in other repos).

**Live evidence (2026-11-02):**
- Conduit ready when warm (0.8.0). Resonance /api/ready owner-gate cleared, posture contract_passed.
- Open PRs: QS 18, Resonance 23, Conduit 23. Target <10.
- CHR-55: deviceAcceptance=not_recorded. Sole production gate for Quicksilver.
- githubAdapterConfigured=false (owner config).
- Free-tier cold starts recoverable.
- Entropy dashboard script now exists in Conduit.

Brutal assessment: Architecture solid. Stabilization holds. Not production-ready until CHR-55 recorded and entropy pruned. Jules micro-opts are pure noise.

## Phase 1 — Immediate Hygiene Prune
Exit: ≤10 open PRs/repo. Docs mirrors and Jules bolts closed. Green non-overlapping hardens merged.

## Phase 2 — CHR-55 Device Gate
Exit: Real IPA evidence recorded by owner on iPhone 16e / iOS 27.

## Phase 3 — Auth Fail-Closed Complete
Exit: All non-public routes 401 anonymous. Tests green.

## Phase 4 — Adapter Configuration
Exit: githubAdapterConfigured=true + evidence.

## Phase 5 — Memory / Budget Hardening (QS)
Exit: Bounded stores, AppTests green at scale.

## Phase 6 — Chamber Persistence (Resonance)
Exit: Scenario survives restart with audit.

## Phase 7 — iOS Native Peer
Exit: Compose/execute/approve loop on device.

## Phase 8 — Observability & Probe Hardening
Exit: Cold-start classifier live. Entropy trend gate.

## Phase 9 — Privacy / Logging Strict
Exit: Full redaction. Manifest complete.

## Phase 10 — Cross-Plane Acceptance & 1.0
Exit: Unified harness, entropy <10 sustained, device evidence, production verdict.

Highest-value next: Run entropy dashboard, prune, then record CHR-55. Configure adapter. Innovate under constraints. Do not invent owner evidence.
