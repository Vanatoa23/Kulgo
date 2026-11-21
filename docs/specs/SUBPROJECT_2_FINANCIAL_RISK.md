# Sub-Project 2 Spec: Financial Impact, Disruption Loss Modeling & Advanced Risk Scoring

**Status:** Draft Spec (Ready for Research Phase)  
**Target Customer:** EU / Nordic-Baltic mid-market manufacturers (50–500 employees) needing both disruption resilience and CSRD Scope 3 compliance.  
**Architectural Constraints:** Must adhere strictly to [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) (`@kulgo/engine` remains pure & zero-I/O; `@kulgo/shared` enforces `.strict()` DTOs) and [`docs/PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md) (zero Tier-2+ partner identity, cost, or coordinate leakage).

---

## 1. Core Product Principle: Progressive Disclosure ("Zero-Friction → High Precision")

Kulgo must work seamlessly regardless of how much financial or operational data a customer chooses to enter:

| Data Tier | What the User Provides | What Kulgo Delivers | Confidence Badge |
| :--- | :--- | :--- | :--- |
| **Level 0 (Minimal)** | Node name + location / company name only | Live map, structural SPOF/HHI, qualitative risk exposure, regional/corridor risk alerts | `ESTIMATED` (wide range) |
| **Level 1 (Quick Commercial Estimate)** | + Quick `ESTIMATE` contract (`activeSpendEur`, `activeVolume`, `leadTimeDays`, `transportMode`) | Disruption Value-at-Risk (VaR), Expected Annual Loss (EAL) range, expediting cost estimates | `ESTIMATED` / `HYBRID` |
| **Level 2 (Contracts & Operational)** | + Formal `FRAMEWORK` / `SPOT` `Contract` + `ContractLine` commitments, optional Product `annualRevenueEur` / `grossMarginPct`, `safetyStockDays`, `defectRatePct`, `carryingCostPct` | Narrowed EAL for financial provisions, pro-rated Period Window `T` exposure, renewal cliff -> TTS vs. TTR outage gap, faulty-unit order buffer, carrying cost vs. stockout trade-off | `HYBRID` / `NETWORK_VERIFIED` |

**Uncertainty & Trust UX:**
- Always display **explicit confidence badges** alongside **Low / Base / High euro ranges** (e.g., `€18k–€42k/yr`).
- When key inputs are missing, show an actionable prompt (e.g., *"Add safety stock days & product gross margin to narrow this range"*).

---

## 2. Contracts as the Commercial Layer & HHI Concentration Alignment

### 2.1 Decoupling Physical Topology from Commercial Commitments
- **`SUPPLIES_LANE` (Physical/Operational Only):** Stores physical and operational route attributes (`fromFacilityId`, `toFacilityId`, `inputId`, `materialCategory`, `transportMode`, `leadTimeDays`, `distanceKm`, `estimatedLaneCo2e`, `riskStatus`, `riskReason`, and optional multi-warehouse `allocationSplitPct`).
- **`SupplyInput` (Canonical Material & Unit Anchor):** Owns the material's canonical `baseUnit` (e.g., `TONNES`, `KG`, `UNITS`, `LITERS`), `unitFamily` (`MASS` | `COUNT` | `VOLUME` | `CURRENCY`), optional `unitConversionFactors` (to convert compatible units into `baseUnit`), and optional `totalAnnualDemand`.
- **`Contract` + `ContractLine` (Commercial Layer):**
  - `contractType`: `FRAMEWORK` (ongoing/base supply agreement), `SPOT` (one-off top-up/purchase order), or `ESTIMATE` (auto-created at Level 1 when a user enters quick lane spend/volume).
  - `pricingType`: `FIXED` | `INDEXED` (with optional index reference / pass-through lag).
  - `currency` & **Pure FX Guardrail:** Contract lines store their native `currency` (`EUR`, `USD`, `SEK`, `NOK`, `GBP`, etc.) and `unitPrice` / `committedVolume` / `committedSpend`. Multi-currency FX conversion rates (`fxRatesToEur: Readonly<Record<string, number>>`) are passed **explicitly** into `@kulgo/engine` so the engine remains 100% pure and zero-I/O.
  - **Double-Counting Guardrail (`FRAMEWORK` replaces `ESTIMATE`):** Adding the first formal `FRAMEWORK` contract on a lane/material defaults to archiving/replacing any quick Level-1 `ESTIMATE` contract on that lane so volume and spend are never double-counted.

### 2.2 Derived-on-Read Commercial Totals & Two Explicit Time Views
Commercial totals on a `SUPPLIES_LANE` (`activeVolume`, `activeSpendEur`, `weightedAvgUnitPrice`, derived `volumeSharePct`, and `renewalCliff`) are **derived on read** from active `ContractLine` records for the selected time view:
1. **Current Run-Rate View (Default Map & Hub Label):** Evaluates contracts active at `asOfDate` (including `HOLDOVER` contracts) normalized to an annualized run-rate.
2. **Selected Period Window `T` (`[windowStart, windowEnd]`, Used for EAL / VaR & Provisions):** Pro-rates each contract line strictly by its day overlap with window `T` (`overlapDays / contractDurationDays`), accurately capturing mid-year price steps, staggered frameworks, and spot top-ups.

### 2.3 Denominator Hygiene
- **Weighted Average Unit Price:** Sums strictly over active lines that have **both** valid EUR-converted spend and compatible volume converted to the `SupplyInput.baseUnit`:
  $$\text{weightedAvgUnitPrice} = \frac{\sum_{i \in \text{paired}} \text{activeSpendEur}_i}{\sum_{i \in \text{paired}} \text{activeVolumeBaseUnit}_i}$$
  Lines missing either volume or spend are excluded from the unit-price ratio so unit prices are never artificially skewed.
- **No Silent Unit Mixing or Volume Fabrication:** Never silently add incompatible `unitFamily` values (e.g., `TONNES` + `UNITS`) and never fabricate physical volume from spend without an explicit unit price. When physical volumes are missing or units conflict across a material's lanes, fall back to a clearly badged **`~Spend Share %`** (`weightingBasis: "SPEND_EUR"`).

### 2.4 Expiry Behavior & Renewal Cliffs
- **Expiry Defaults:**
  - Base / ongoing `FRAMEWORK` contracts default to `HOLDOVER` (continuing at the last active run-rate while flagged as holdover) or `AUTO_RENEW` (with `noticePeriodDays` deadline alerts).
  - One-off `SPOT` top-ups default to `AUTO_ARCHIVE` upon `endDate`.
- **Renewal Cliff (`>30%` Volume Expiring in 90 Days):** When `>30%` of a material's active volume is under `AUTO_ARCHIVE` or non-renewing contracts expiring within `90` days (or past their `noticePeriodDays` window), `@kulgo/engine` flags a `renewalCliff` alert and feeds the cliff directly into the **TTS vs. TTR** model as an upcoming capacity drop.

### 2.5 HHI Concentration Alignment (`@kulgo/engine`)
- **Per-Material HHI (`dimension: "MATERIAL"`):** Uses derived `activeVolume` normalized to `SupplyInput.baseUnit` (falling back to `activeSpendEur` with `weightingBasis: "SPEND_EUR"`, or declared `VOLUME_SHARE_PCT` at Level 0, if volume is missing or units conflict).
- **Org-Wide Supplier & Country HHI (`dimension: "SUPPLIER" | "COUNTRY"`):** Uses derived `activeSpendEur` (`EUR` as the universal common denominator across heterogeneous materials), falling back to normalized mass or share % only when zero lanes have spend data.
- **Partial-Coverage Calculation + Explicit `Coverage %` Indicator:** Replaces all-or-nothing fallback across active lanes. If 9 of 10 active lanes have `activeSpendEur`, Org-Wide Supplier and Country HHI are computed across those 9 priced lanes and annotated with `coveredLanesCount: 9`, `totalActiveLanesCount: 10`, `coveragePct: 90`, and `weightingBasis: "SPEND_EUR"` (rendered in UI as *"Based on 9 of 10 active lanes · 90% coverage"*).

---

## 3. Quantitative Financial Risk Models in Scope

All five models are computed purely and deterministically inside `@kulgo/engine`:

1. **Expected Annual Loss (EAL) & Disruption Value-at-Risk (VaR)**
   - Quantifies expected financial loss from supplier/corridor disruptions over **Selected Period Window `T`** (or annualized Run-Rate) so finance/ops teams can size **financial provisions** and justify dual-sourcing ROI.
   - Outputs `lowEur`, `baseEur`, `highEur` per product, per material input, and org-wide.
2. **Time-to-Survive (TTS) vs. Time-to-Recover (TTR)**
   - Compares how many days production can continue on existing buffer/safety stock (`TTS`) against expected supplier/corridor recovery duration (`TTR`), incorporating **Renewal Cliffs (`>30%` volume expiring within 90 days)** into the effective replacement lead time.
   - Flags `unprotectedGapDays = max(0, TTR - TTS)` as the direct driver of lost-margin days.
3. **Defect / Faulty-Unit Overhead Model**
   - Uses user-supplied or sector-baseline defect/scrap rates (`defectRatePct`) to compute expected faulty units per order cycle and **recommended over-order / safety buffer** (`recommendedOrderBufferPct` and `recommendedBufferUnits`).
4. **Expediting & Switching Cost Estimator**
   - Estimates emergency mode-shift surge cost (e.g., Sea/Rail → Air/Road) and supplier switching lead-time penalty during an active disruption.
5. **Working Capital & Inventory Carrying Cost Trade-Off**
   - Compares annual capital cost of holding extra safety stock (`carryingCostEur`) against the reduction in Expected Annual Loss (`ealReductionEur`) to surface optimal buffer targets.

---

## 4. Probability & Benchmark Sourcing

- **Versioned Static Baseline Tables in `@kulgo/engine`:** Research-backed baseline tables keyed by country/region, transport mode, and industry sector (disruption frequency, median/p90 TTR days, sector defect rates, air/road expediting multipliers, default inventory carrying cost %).
- **Per-Entity Overrides:** Users can override any baseline parameter on a specific `Product`, `Facility`, or `SupplyLane`.
- **Future Live Risk Enrichment:** Baseline disruption probabilities are designed to accept an optional `liveRiskMultiplier` input from Sub-Project 1 (Live Risk Intelligence feeds) without changing the engine's pure function signatures.

---

## 5. Privacy & Tier-2+ Interaction (`PRIVACY_CONTRACT.md`)

- When a verified Tier-1 partner (`Org B`) has hidden Tier-2+ risks (secondary sanctions, regional chokepoints, upstream SPOF) resolved via cycle-safe traversal (with conservative org-level fallback or two-sided `fulfilledByFacilityId` reconciliation), Kulgo's server-side `AnalyticsRepository` computes an **anonymized hidden risk multiplier** (increasing disruption probability and TTR on Org A's Tier-1 link, tagged `NETWORK_VERIFIED`).
- **Hard Guarantee:** Org A's financial loss DTOs (`FinancialRiskSummarySchema`, `.strict()`) **never** expose Org B's or Tier-2+'s identities, total revenues, unit costs, margins, or coordinates.

---

## 6. UI & Reporting Integration

1. **`AnalyticsPanel` / Dashboard Financial Tab:** New **Financial Risk & Provisions** view with **Current Run-Rate vs. Period Window `T`** toggle, EAL range (`Low / Base / High`), HHI partial-coverage badges (*"Based on X of Y active lanes"*), renewal cliff & TTS vs. TTR gap alerts, recommended defect buffer, confidence badge, and a quick-link to fill missing inputs.
2. **`WhatIfSimulatorDrawer`:** Extend stateless simulation deltas to include **EAL Delta (€/yr)**, **Carrying Cost Delta (€/yr)**, and **Net ROI / Payback** (e.g., simulating dual-sourcing 40% to a Nordic supplier or adding +14 days of safety stock).
3. **Executive / CSRD Report (`GET /api/v1/analytics/report`):** Add an anonymized `financialExposure` section summarizing EAL range, top unprotected TTR–TTS gaps, active renewal cliffs, and recommended provision bands.

---

## 7. Phased Execution Plan (Sub-Tasks)

### Phase 0 — Research & Calibration (Required Before Coding)
- [ ] Research and document empirical benchmarks for EU/Nordic-Baltic manufacturing:
  - Disruption frequencies & TTR distributions by region/corridor and transport mode (Sea, Rail, Road, Air).
  - Sector-level defect/scrap rates (Electronics, Metals, Chemicals, Packaging, General Manufacturing).
  - Standard freight expediting cost multipliers (Sea → Air, Rail → Road) and typical SME inventory carrying cost % (WACC + warehousing + obsolescence).
- [ ] Validate mathematical formulas for Contract Run-Rate vs. Period Window `T` pro-ration, denominator-hygienic weighted average unit price, renewal cliffs (`>30%` volume expiring in 90 days), partial-coverage HHI, EAL, VaR (p90/p95), TTS–TTR gap, defect overhead buffer, and carrying-cost trade-off with worked numerical examples (including Estonia Product X demo).
- [ ] Produce `docs/research/FINANCIAL_RISK_METHODOLOGY.md` citing all sources and documenting formula edge cases (zero volume, conflicting units, missing revenue, `HOLDOVER` vs. `AUTO_ARCHIVE`, 100% single-source).

### Phase 1 — Shared Contracts & Pure Engine (`@kulgo/shared` + `@kulgo/engine`)
- [ ] Add `ContractSchema`, `ContractLineSchema` (`FRAMEWORK` | `SPOT` | `ESTIMATE`, `FIXED` | `INDEXED`, `HOLDOVER` | `AUTO_RENEW` | `AUTO_ARCHIVE`), canonical `baseUnit` / `unitFamily` / `totalAnnualDemand` on `SupplyInputSchema`, and optional financial/operational fields on `Product`, `Facility`, and `SupplyLane` in `packages/shared/src/network.ts`.
- [ ] Add partial-coverage HHI metadata (`coveredLanesCount`, `totalActiveLanesCount`, `coveragePct`, `weightingBasis`) and strict `.strict()` financial risk DTOs (`FinancialRiskSummarySchema`, `MaterialFinancialRiskSchema`, `DerivedLaneCommercialSummarySchema`, `DefectBufferRecommendationSchema`, `FinancialSimulationDeltaSchema`) in `packages/shared/src/analytics.ts`.
- [ ] Implement pure contract derivation (Current Run-Rate + Period Window `T` with explicit pure FX map), partial-coverage HHI, versioned baseline tables, and pure financial risk calculation functions in `packages/engine/` with comprehensive Vitest unit tests.

### Phase 2 — ArcadeDB Schema, API & Privacy Enforcement (`@kulgo/api`)
- [ ] Add `Contract` and `ContractLine` vertices/edges plus new optional properties idempotently to `apps/api/src/db/schema.ts`, update `WorkspaceRepository` (including automatic `ESTIMATE` -> `FRAMEWORK` archival to prevent double-counting), and update bulk CSV/JSON import-export.
- [ ] Wire server-side Tier-2+ anonymized risk multiplier into `OrgScopedAnalyticsRepository` for `/summary`, `/simulate`, and `/report`.
- [ ] Extend `apps/api/tests/privacy-boundary.test.ts` and `apps/api/tests/integration/arcadedb.integration.test.ts`.

### Phase 3 — Frontend UI & E2E (`@kulgo/web`)
- [ ] Add progressive-disclosure Contract & Commercial Commitments drawer (supporting quick `ESTIMATE` entry and formal `FRAMEWORK`/`SPOT` contracts) plus optional operational buffer fields.
- [ ] Add **Current Run-Rate vs. Period Window `T`** toggle, HHI partial-coverage badges, Financial Risk & Provisions card, and EAL/ROI deltas to `AnalyticsPanel` / Dashboard and `WhatIfSimulatorDrawer`.
- [ ] Add Playwright E2E coverage verifying Level 0 → Level 2 range narrowing, `ESTIMATE` replacement by `FRAMEWORK`, and What-If EAL delta calculation.

