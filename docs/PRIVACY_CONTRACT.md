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

## Opt-In Alternative Supplier Directory
Suppliers joining Kulgo may explicitly opt in (`openToNewBuyers = true`) to appear in Kulgo's alternative-supplier directory. Directory profiles expose only self-declared public capability info (name, country, capabilities, ESG badges) and **never** reveal existing buyers or private supply links.
