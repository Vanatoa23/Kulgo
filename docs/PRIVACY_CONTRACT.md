# Kulgo Privacy & Data Isolation Contract

## Core Rule
**A company only ever sees the suppliers, facilities, products, materials, and lanes it entered itself.**

When a Tier-1 supplier (`Org B`) accepts a Kulgo invitation from a buyer (`Org A`) and maps *its* own upstream suppliers (`Org C`, `Org D`, ...):
1. `Org A` receives a **Network-Verified** status badge on its Tier-1 node for `Org B`.
2. `Org A` **never** receives any `facilityId`, `orgId`, company name, total revenue, email address, contract detail, unit cost/margin, or exact geographic coordinates belonging to `Org C` or any deeper upstream tier.
3. Kulgo's server-side `AnalyticsRepository` traverses `VERIFIED_PARTNER_LINK` edges in memory, passes raw topology to `@kulgo/engine`, and returns **only** anonymized aggregate scores, region-level warnings (e.g., secondary sanctions exposure or shared upstream chokepoint), and attributed Scope 3 emission totals.

## Graph Traversal, Partner Bridge & Scope 3 Attribution Rules
1. **Cycle-Safe Multi-Tier Traversal:** Server-side `VERIFIED_PARTNER_LINK` traversal enforces a per-path `visited` organization set (`visitedOrgIds`) and a hard maximum tier depth (`MAX_TRAVERSAL_DEPTH = 4`). Circular supply loops (`Org A -> Org B -> Org C -> Org A` or `Org B <-> Org C`) are terminated immediately without infinite recursion or double-counting, while valid diamond topologies (`Org A -> {Org B1, Org B2} -> Org C`) are evaluated on each distinct path so shared upstream chokepoints across 2+ distinct Tier-1 partners are accurately detected.
2. **Conservative Fallback & Two-Sided Facility Reconciliation:**
   - **Two-Sided Facility Binding (`fulfilledByFacilityId`):** When a Tier-1 partner (`Org B`) has multiple own facilities and explicitly binds which specific partner facility fulfills `Org A`'s supply link (`fulfilledByFacilityId`), traversal scopes `Org B`'s upstream lanes and facility emissions strictly to the subgraph feeding that fulfilling facility.
   - **Conservative Org-Level Fallback:** When a `VERIFIED_PARTNER_LINK` does not yet specify `fulfilledByFacilityId` (or the bound facility is not found in `Org B`'s active workspace), the resolver applies a **conservative fallback** across `Org B`'s active upstream network so no potential sanctions or chokepoint exposure is missed, until two-sided facility reconciliation is completed.
3. **Privacy-Safe GHG Protocol Scope 3 Category 1 Attribution:**
   - A buyer (`Org A`) is **never** attributed 100% of a Tier-1 supplier's total corporate Scope 1/2/3 emissions when purchasing only a fraction of their output.
   - Attribution follows the GHG Protocol Category 1 hierarchy strictly server-side: (a) **Product/Volume-based PCF** (`purchasedVolume * productEmissionFactorTco2ePerUnit`) when primary product carbon footprint intensity is available; (b) **Economic Attribution via Emission Intensity** (`buyerActiveSpendEur * (supplierTotalTco2e / supplierAnnualRevenueEur)`) computed strictly in memory on the server so `Org B`'s total revenue is **never** exposed to `Org A`; or (c) an explicit proportional allocation share / sector baseline estimate.

## Enforcement Layers
1. **Network Layer:** ArcadeDB has zero public ports in production and runs with unused protocol plugins disabled.
2. **Repository Layer:** `WorkspaceRepository` requires an authenticated `orgId` on every query and filters `ownerOrgId = :orgId`.
3. **Contract Layer:** `AnalyticsSummarySchema` and `AnonymizedRiskAlertSchema` in `@kulgo/shared` use `.strict()`, causing Zod to throw if any unexpected Tier-2+ field is ever attached.
4. **CI Gate:** `pnpm test:privacy` (`apps/api/tests/privacy-boundary.test.ts`) runs on every pull request and blocks merge on any privacy violation.

## Invitation Transitions
Accepting a pending, unexpired invitation consumes it and creates its verified partner link in one ArcadeDB transaction, including facility refinement, connected-lane recalculation, and any requested directory update. A unique index on the link's outgoing buyer-facility endpoint enforces one partner per placeholder across all invitations. Accept and revoke compete for the same pending invitation: only one transition commits; the loser receives HTTP 409 after revalidation. Distinct invitations to an already-linked facility also receive HTTP 409 and remain pending. The in-memory repository serializes invitation transitions to preserve these concurrency rules in tests and local development.

## Opt-In Alternative Supplier Directory
Suppliers joining Kulgo may explicitly opt in (`openToNewBuyers = true`) to appear in Kulgo's alternative-supplier directory. Directory profiles expose only self-declared public capability info (name, country, capabilities, ESG badges) and **never** reveal existing buyers or private supply links.

## Training Data Vault (Two-Plane Isolation & Copyright Hygiene)
Kulgo archives append-only `.jsonl.gz` batches for future internal model training and Supply Chain Gym simulation under a strict two-plane boundary (see [`docs/specs/TRAINING_DATA_VAULT.md`](./specs/TRAINING_DATA_VAULT.md)):
1. **Plane A (`global_public`):** Contains strictly public world feeds, pre-filter decisions, public-only LLM extractions, signal lifecycles, and verified public-registry entity pairs. Zero tenant identifiers, zero customer supply graphs, and zero unresolved free-text supplier strings may ever enter Plane A. Open/public-domain sources (`FULL_TEXT`) are archived in full; copyrighted news sources (`EXCERPT_ONLY`) store only feed-provided titles, summaries, verbatim `evidenceQuote` spans, URLs, and SHA-256 hashes with `fullText: null` enforced at schema validation time.
2. **Plane B (`anonymized_outcomes`):** Stores strictly non-invertible, day-bucketed (`YYYY-MM-DD`) operational feedback (e.g., alert dismissal reason codes) with all `orgId`, `userId`, `facilityId`, coordinates, notes, financials, and Tier-2+ partner topology stripped before serialization.
3. **Per-Organization Opt-Out (`allowAnonymizedTraining`):** Organization owners may set `allowAnonymizedTraining = false` via `PATCH /api/v1/alerts/preferences`. When disabled, **zero** Plane B records are emitted for that organization.
4. **Contract & CI Enforcement:** All Training Data Vault schemas in `@kulgo/shared` use `.strict()` Zod validation before compression, and `pnpm test:privacy` blocks merge if any forbidden tenant/PII field or `EXCERPT_ONLY` full-text violation can be serialized.

