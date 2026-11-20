# Kulgo Privacy & Data Isolation Contract

## Core Rule
**A company only ever sees the suppliers, facilities, products, materials, and lanes it entered itself.**

When a Tier-1 supplier (`Org B`) accepts a Kulgo invitation from a buyer (`Org A`) and maps *its* own upstream suppliers (`Org C`, `Org D`, ...):
1. `Org A` receives a **Network-Verified** status badge on its Tier-1 node for `Org B`.
2. `Org A` **never** receives any `facilityId`, `orgId`, company name, email address, contract detail, or exact geographic coordinates belonging to `Org C` or any deeper upstream tier.
3. Kulgo's server-side `AnalyticsRepository` traverses `VERIFIED_PARTNER_LINK` edges in memory, passes raw topology to `@kulgo/engine`, and returns **only** anonymized aggregate scores, region-level warnings (e.g., secondary sanctions exposure or shared upstream chokepoint), and Scope 3 emission totals.

## Enforcement Layers
1. **Network Layer:** ArcadeDB has zero public ports in production and runs with unused protocol plugins disabled.
2. **Repository Layer:** `WorkspaceRepository` requires an authenticated `orgId` on every query and filters `ownerOrgId = :orgId`.
3. **Contract Layer:** `AnalyticsSummarySchema` and `AnonymizedRiskAlertSchema` in `@kulgo/shared` use `.strict()`, causing Zod to throw if any unexpected Tier-2+ field is ever attached.
4. **CI Gate:** `pnpm test:privacy` (`apps/api/tests/privacy-boundary.test.ts`) runs on every pull request and blocks merge on any privacy violation.

## Opt-In Alternative Supplier Directory
Suppliers joining Kulgo may explicitly opt in (`openToNewBuyers = true`) to appear in Kulgo's alternative-supplier directory. Directory profiles expose only self-declared public capability info (name, country, capabilities, ESG badges) and **never** reveal existing buyers or private supply links.
