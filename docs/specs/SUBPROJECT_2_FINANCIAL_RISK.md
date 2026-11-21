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
| **Level 1 (Commercial)** | + Lane `annualSpendEur`, `annualVolume`, `leadTimeDays`, `transportMode` | Disruption Value-at-Risk (VaR), Expected Annual Loss (EAL) range, expediting cost estimates | `ESTIMATED` / `HYBRID` |
| **Level 2 (Operational)** | + Optional Product `annualRevenueEur` / `grossMarginPct`, `safetyStockDays`, `defectRatePct`, `carryingCostPct` | Narrowed EAL for financial provisions, TTS vs. TTR outage gap, faulty-unit order buffer, carrying cost vs. stockout trade-off | `HYBRID` / `NETWORK_VERIFIED` |

**Uncertainty & Trust UX:**
- Always display **explicit confidence badges** alongside **Low / Base / High euro ranges** (e.g., `€18k–€42k/yr`).
- When key inputs are missing, show an actionable prompt (e.g., *"Add safety stock days & product gross margin to narrow this range"*).

---

## 2. Models in Scope

All five models are computed purely and deterministically inside `@kulgo/engine`:

1. **Expected Annual Loss (EAL) & Disruption Value-at-Risk (VaR)**
   - Quantifies expected annual financial loss from supplier/corridor disruptions so finance/ops teams can size **financial provisions** and justify dual-sourcing ROI.
   - Outputs `lowEur`, `baseEur`, `highEur` per product, per material input, and org-wide.
2. **Time-to-Survive (TTS) vs. Time-to-Recover (TTR)**
   - Compares how many days production can continue on existing buffer/safety stock (`TTS`) against expected supplier/corridor recovery duration (`TTR`).
   - Flags `unprotectedGapDays = max(0, TTR - TTS)` as the direct driver of lost-margin days.
3. **Defect / Faulty-Unit Overhead Model**
   - Uses user-supplied or sector-baseline defect/scrap rates (`defectRatePct`) to compute expected faulty units per order cycle and **recommended over-order / safety buffer** (`recommendedOrderBufferPct` and `recommendedBufferUnits`).
4. **Expediting & Switching Cost Estimator**
   - Estimates emergency mode-shift surge cost (e.g., Sea/Rail → Air/Road) and supplier switching lead-time penalty during an active disruption.
5. **Working Capital & Inventory Carrying Cost Trade-Off**
   - Compares annual capital cost of holding extra safety stock (`carryingCostEur`) against the reduction in Expected Annual Loss (`ealReductionEur`) to surface optimal buffer targets.

---

## 3. Probability & Benchmark Sourcing

- **Versioned Static Baseline Tables in `@kulgo/engine`:** Research-backed baseline tables keyed by country/region, transport mode, and industry sector (disruption frequency, median/p90 TTR days, sector defect rates, air/road expediting multipliers, default inventory carrying cost %).
- **Per-Entity Overrides:** Users can override any baseline parameter on a specific `Product`, `Facility`, or `SupplyLane`.
- **Future Live Risk Enrichment:** Baseline disruption probabilities are designed to accept an optional `liveRiskMultiplier` input from Sub-Project 1 (Live Risk Intelligence feeds) without changing the engine's pure function signatures.

---

## 4. Privacy & Tier-2+ Interaction (`PRIVACY_CONTRACT.md`)

- When a verified Tier-1 partner (`Org B`) has hidden Tier-2+ risks (secondary sanctions, regional chokepoints, upstream SPOF), Kulgo's server-side `AnalyticsRepository` computes an **anonymized hidden risk multiplier** (increasing disruption probability and TTR on Org A's Tier-1 link, tagged `NETWORK_VERIFIED`).
- **Hard Guarantee:** Org A's financial loss DTOs (`FinancialRiskSummarySchema`, `.strict()`) **never** expose Org B's or Tier-2+'s identities, unit costs, margins, or coordinates.

---

## 5. UI & Reporting Integration

1. **`AnalyticsPanel` (Sidebar):** New **Financial Risk & Provisions** card showing EAL range (`Low / Base / High`), TTS vs. TTR gap alerts, recommended defect buffer, confidence badge, and a quick-link to fill missing inputs.
2. **`WhatIfSimulatorDrawer`:** Extend stateless simulation deltas to include **EAL Delta (€/yr)**, **Carrying Cost Delta (€/yr)**, and **Net ROI / Payback** (e.g., simulating dual-sourcing 40% to a Nordic supplier or adding +14 days of safety stock).
3. **Executive / CSRD Report (`GET /api/v1/analytics/report`):** Add an anonymized `financialExposure` section summarizing EAL range, top unprotected TTR–TTS gaps, and recommended provision bands.

---

## 6. Phased Execution Plan (Sub-Tasks)

### Phase 0 — Research & Calibration (Required Before Coding)
- [ ] Research and document empirical benchmarks for EU/Nordic-Baltic manufacturing:
  - Disruption frequencies & TTR distributions by region/corridor and transport mode (Sea, Rail, Road, Air).
  - Sector-level defect/scrap rates (Electronics, Metals, Chemicals, Packaging, General Manufacturing).
  - Standard freight expediting cost multipliers (Sea → Air, Rail → Road) and typical SME inventory carrying cost % (WACC + warehousing + obsolescence).
- [ ] Validate mathematical formulas for EAL, VaR (p90/p95), TTS–TTR gap, defect overhead buffer, and carrying-cost trade-off with worked numerical examples (including Estonia Product X demo).
- [ ] Produce `docs/research/FINANCIAL_RISK_METHODOLOGY.md` citing all sources and documenting formula edge cases (zero volume, missing revenue, 100% single-source).

### Phase 1 — Shared Contracts & Pure Engine (`@kulgo/shared` + `@kulgo/engine`)
- [ ] Add optional financial/operational fields to `Product`, `Facility`, and `SupplyLane` schemas in `packages/shared/src/network.ts` (all optional/nullable for Level 0 compatibility).
- [ ] Add strict `.strict()` financial risk DTOs (`FinancialRiskSummarySchema`, `MaterialFinancialRiskSchema`, `DefectBufferRecommendationSchema`, `FinancialSimulationDeltaSchema`) in `packages/shared/src/analytics.ts`.
- [ ] Implement versioned baseline tables and pure calculation functions in `packages/engine/src/financial-risk.ts` with comprehensive Vitest unit tests covering Level 0 / 1 / 2 inputs and edge cases.

### Phase 2 — ArcadeDB Schema, API & Privacy Enforcement (`@kulgo/api`)
- [ ] Add new optional properties idempotently to `apps/api/src/db/schema.ts` and update `WorkspaceRepository` (ArcadeDB + InMemory) and bulk CSV/JSON import-export.
- [ ] Wire server-side Tier-2+ anonymized risk multiplier into `OrgScopedAnalyticsRepository` for `/summary`, `/simulate`, and `/report`.
- [ ] Extend `apps/api/tests/privacy-boundary.test.ts` and `apps/api/tests/integration/arcadedb.integration.test.ts`.

### Phase 3 — Frontend UI & E2E (`@kulgo/web`)
- [ ] Add optional progressive-disclosure financial/operational fields to `WorkspaceSidebar` forms (collapsed/optional "Financial & Buffer Details" section so Level 0 creation stays fast).
- [ ] Add Financial Risk & Provisions card to `AnalyticsPanel`, EAL/ROI deltas to `WhatIfSimulatorDrawer`, and financial exposure preview to `ImportExportModal`.
- [ ] Add Playwright E2E coverage verifying Level 0 → Level 2 range narrowing and What-If EAL delta calculation.
