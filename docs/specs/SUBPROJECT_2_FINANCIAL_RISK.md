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
- **`SUPPLIES_LANE` (Physical/Operational Edge Only):** Represents the physical/logistical flow (`fromFacilityId → toFacilityId` for one `SupplyInput`). Works at Level 0 with zero financial data. Stores physical and operational route attributes (`inputId`, `materialCategory`, `transportMode`, `leadTimeDays`, `incoterms`, `safetyStockDays`, `defectRatePct`, `distanceKm`, `estimatedLaneCo2e`, `riskStatus`, `riskReason`, and optional multi-warehouse `allocationSplitPct`). Everything commercial shown on the lane (`activeVolume`, `activeSpendEur`, `weightedAvgUnitPrice`, `volumeSharePct`, `nextExpirationDate`, `atRiskVolumePct`, `renewalCliff`) is **derived on the fly on read**—never manually typed or stored as hardcoded commercial totals.
- **`SupplyInput` (Canonical Material & Unit of Measure Authority):**
  - Owns **one canonical `baseUnit`** (e.g., `KG`, `TONNES`, `UNITS`, `LITERS`, `M2`) and its `unitFamily` (`MASS` | `COUNT` | `VOLUME` | `AREA` | `CURRENCY`).
  - **Same-Dimension & Custom Cross-Dimension Unit Conversions:** Standard SI units within the same `unitFamily` (`TONNES ↔ KG`, `ML ↔ LITERS`) convert automatically via built-in multipliers. For cross-dimension manufacturing units (e.g., buying sheet metal in `COILS`/`PIECES` vs. `KG`, or `1 pallet = 400 pcs`), `SupplyInput` stores one-time material conversion rules (`unitConversionFactors: Record<string, number>`, e.g. `"1 piece = [X] kg for this material"`). Mixed units without an explicit conversion rule are **never** silently added together.
  - **Uncontracted / Spot Exposure ("The Ghost Lane"):** `SupplyInput` optionally holds `totalAnnualDemand`. If active contracts across all lanes for that material only sum to `70%` of `totalAnnualDemand`, Kulgo displays both the **Known Share %** (share of the 70% mapped volume) and an explicit **`30% Uncontracted / Spot Exposure`** warning badge on the material node so risk scores never falsely assume 100% single-sourcing on a partially mapped supplier and EAL/VaR accounts for uncontracted spot exposure.
- **`Contract` + `ContractLine` (Commercial Building Block):**
  - **Multi-Line Header Under the Hood, Zero-Friction in the UI:** Splits `Contract` (agreement header: `startDate`, `endDate` nullable for evergreen, `autoRenews`, `noticePeriodDays`, PDF attachment reference) from `ContractLine` (allocation to a specific `SUPPLIES_LANE` / material) so a single master Nordic/EU framework agreement can cover multiple materials with one expiry date and notice period, while clicking **`+ Add Spot / Top-up`** on a single lane auto-creates a 1-line contract in 3 clicks (`qty`, `spend`, `endDate`).
  - `contractType`: `FRAMEWORK` (ongoing/base supply agreement), `SPOT_PO` (one-off spot top-up / purchase order), or `ESTIMATE` (implicit lightweight contract auto-created at Level 1 when a user types quick lane volume/spend without formal contract dates—ensuring `@kulgo/engine` runs **one unified formula** across all levels with zero special cases).
  - `cadence` (`PER_YEAR` | `TOTAL_OVER_TERM`): Every contract line explicitly declares whether its committed quantity and spend represent an annualized rate (`PER_YEAR`, e.g., `10 units/yr`) or a fixed total over the contract's duration (`TOTAL_OVER_TERM`, e.g., `2 units total over a 6-month spot PO`), eliminating pro-rating ambiguity.
  - `pricingType`: `FIXED` | `INDEXED` (with optional index reference / pass-through lag).
  - `confidence`: `CONTRACTED` > `IMPORTED` > `ESTIMATED`.
  - `currency` & **Pure FX Guardrail:** Contract lines store their native `currency` (`EUR`, `USD`, `SEK`, `NOK`, `GBP`, etc.) and `unitPrice` / `committedVolume` / `committedSpend`. Multi-currency FX conversion rates (`fxRatesToEur: Readonly<Record<string, number>>`) are passed **explicitly** into `@kulgo/engine` so the engine remains 100% pure and zero-I/O.
  - **Double-Counting Guardrail (`FRAMEWORK` replaces `ESTIMATE`):** Adding the first formal `FRAMEWORK` contract on a lane/material defaults to archiving/replacing any quick Level-1 `ESTIMATE` contract on that lane so volume and spend are never double-counted.

### 2.2 Derived-on-Read Commercial Totals & Two Explicit Time Views
For any selected time window $T$, commercial totals on a `SUPPLIES_LANE` are derived purely on read from active `ContractLine` records:
$$\text{ActiveVolume}(T) = \sum_{c \in \text{ActiveLines}} \text{DailyVolumeRate}_c \times \text{OverlapDays}(c, T)$$
$$\text{ActiveSpendEur}(T) = \sum_{c \in \text{ActiveLines}} \text{DailySpendEurRate}_c \times \text{OverlapDays}(c, T)$$
$$\text{VolumeSharePct}(T) = \frac{\text{Lane.ActiveVolume}(T)}{\sum_{\text{all lanes for material}} \text{ActiveVolume}(T)}$$

Kulgo supports **two explicit time views**:
1. **Current Run-Rate View (Point-in-Time Active Capacity — Default Map & Hub Label):** Evaluates all contracts active at `asOfDate` (including `HOLDOVER` contracts) normalized to an annualized run-rate (e.g., a base contract of `10 units/yr @ €10` + a spot top-up signed July 1 of `2 units/yr @ €3` immediately displays **`12 units/yr | €13/yr | €1.083/unit`** on the map today).
2. **Selected Period Window `T` (Rolling Next 12 Months / Calendar Year `[windowStart, windowEnd]` — Default EAL / VaR & Provisions View):** Pro-rates each contract line strictly by its day overlap with window `T` (`OverlapDays(c, T)`), respecting `cadence` (`PER_YEAR` daily rate $= \text{qty} / 365$; `TOTAL_OVER_TERM` daily rate $= \text{qty} / \text{contractDurationDays}`). For example, a `2-unit/yr` top-up active from July 1 to Dec 31 contributes `1 unit / €1.50` to the calendar year (`11 units | €11.50 | €1.045/unit`), whereas a `2-unit TOTAL_OVER_TERM` 6-month spot PO overlapping 100% with the window contributes all `2 units`.

### 2.3 Denominator Hygiene (Why `~Spend Share %` Wins Over Imputed Volume)
- **Weighted Average Unit Price:** Never compute an unweighted average of unit prices, and never divide total spend (including volume-less contracts) by partial volume. If Contract #1 has `(10 units, €10)` and Contract #2 has `(spend €5, volume unknown)`, naively dividing `€15 / 10 units = €1.50/unit` corrupts the unit price. Instead, `weightedAvgUnitPrice` sums strictly over the subset of active contract lines $C_{\text{both}}$ that have **both** valid EUR-converted spend and compatible volume normalized to `SupplyInput.baseUnit`:
  $$\text{weightedAvgUnitPrice}(T) = \frac{\sum_{c \in C_{\text{both}}} \text{ActiveSpendEur}_c(T)}{\sum_{c \in C_{\text{both}}} \text{ActiveVolumeBaseUnit}_c(T)}$$
  while still counting Contract #2's `€5` in total `ActiveSpendEur(T)`.
- **No Circular Volume Fabrication:** Never divide a volume-less lane's spend by another supplier's average unit price to fabricate physical volume (which introduces circular bias: a 50% more expensive spot supplier would appear 50% larger in physical volume!). When physical volume is missing or units conflict across a material's lanes, keep physical volume unknown and fall back cleanly to a badged **`~Spend Share %`** (`weightingBasis: "SPEND_EUR"`).

### 2.4 Expiry Lifecycle, Never-Delete History & Renewal Cliffs
- **Never Delete Expired Contracts & Lapsed Lane State:**
  - Expired contracts are **never deleted**; they remain archived for historical price/volume audit trails.
  - If all contracts on a lane expire/archive (`ActiveVolume = 0`), the physical `SUPPLIES_LANE` **never silently disappears** from the map or risk calculations—it stays visible in an amber **`Lapsed / Uncontracted`** state so procurement teams never lose sight of a critical supplier.
- **Explicit Expiry Behavior (`HOLDOVER` vs. `AUTO_RENEW` vs. `AUTO_ARCHIVE`):**
  - **Base / Ongoing `FRAMEWORK` Contracts → `HOLDOVER` (or `AUTO_RENEW`):** In mid-market manufacturing, base contracts frequently pass `endDate` on paper while shipments continue at the previous price. Dropping them to `0` overnight would break downstream EAL/VaR models. Ongoing contracts therefore transition to **`Expired – Assumed Holdover`** (rendered amber/dashed on the map, keeping volume active until the user clicks `Renew` or `Archive`) or **`AUTO_RENEW`** (shifting alerts from *"contract expired"* to **"Cancellation Notice Deadline"** at `endDate - noticePeriodDays`, matching European B2B procurement practice).
  - **One-Off `SPOT_PO` Top-Ups → `AUTO_ARCHIVE`:** Automatically transitions to archived on `endDate` so temporary surge capacity drops off active totals without manual cleanup.
- **Renewal Cliff (`>30%` Volume Expiring in 90 Days) → TTS vs. TTR:**
  - Every lane computes `nextExpirationDate` and `atRiskVolumePct` (e.g., *"17% of lane volume (2/12 units) expires in < 60 days @ €1.50/unit"*).
  - When `>30%` of a material's active volume is under `AUTO_ARCHIVE` or non-renewing contracts expiring within `90` days (or approaching a `noticePeriodDays` cancellation cliff), `@kulgo/engine` flags a `renewalCliff` alert and feeds the scheduled volume drop directly into the **Time-to-Survive (TTS) vs. Time-to-Recover (TTR)** model.
- **Anti-Staleness Guardrail (Monthly 1-Click Digest):**
  - To prevent administrative decay ("stale contract drift"), Kulgo surfaces a monthly in-app / email renewal digest for contracts expiring or entering notice windows: **`[Extend 1 yr]`**, **`[Convert to Ongoing]`**, or **`[Let Expire / Archive]`**—keeping contract hygiene under 15 seconds per month.

### 2.5 Low-Friction Data Entry UX ("Flat Form → Live Aggregated Summary Banner" & ERP PO Auto-Clustering)
1. **Level 0 (Zero Commercial Data — Day 1):** User draws `Supplier B → Factory A` for `Aluminum Extrusions`. No contract records are required; topology and geographic risk render immediately.
2. **Level 1A ("Quick Estimate" — The 10-Second Flat Form):** Clicking a lane opens the side drawer showing two simple fields at the top: **`Total Annual Volume`** and **`Annual Spend (€)`**. Typing `10 units` and `€10` silently creates a single background `ESTIMATE` contract (`PER_YEAR`, evergreen). The user never has to know a `Contract` table exists.
3. **Level 1B ("Flat Form → Live Aggregated Summary Banner" Progressive Upgrade):**
   - Clicking **`+ Add Contract / Spot Top-Up`** inside that same lane drawer reveals the initial entry as **Contract #1 (`Base Estimate`)** and adds **Contract #2 (`Spot Top-Up`: `2 units`, `€3`, expires in 12 months)**.
   - Immediately, the top fields lock and transform into a read-only **Live Aggregated Summary Banner** (**`12 units | €13 | €1.083/unit | 67% share of material`**) with the 2 editable contract cards stacked cleanly underneath.
4. **Scale Onboarding (40+ Contracts from ERP PO History or PDFs):**
   - **ERP 12-Month "PO History" CSV Auto-Clustering:** Because most 50–500 employee manufacturers (using Business Central, Monitor ERP, Uniconta, or Odoo) have Purchase Order history rather than a clean ERP contract table, Kulgo accepts a 12-month PO CSV export and auto-clusters recurring POs at stable prices into a draft `FRAMEWORK` Base Contract (`IMPORTED` confidence) and price/quantity outliers into `SPOT_PO` Top-Ups for 1-click confirmation.
   - **AI PDF / Word Contract Dropzone:** Drag-and-drop a signed framework agreement or PO PDF onto a supplier or lane; a structured LLM extractor pre-fills the contract card (`startDate`, `endDate`, `noticePeriodDays`, `committedVolume`, `unitPrice`, `incoterms`) for 1-click confirmation.

### 2.6 HHI Concentration Alignment (`@kulgo/engine`)
- **Per-Material HHI (`dimension: "MATERIAL"`):** Uses derived `activeVolume` normalized to `SupplyInput.baseUnit` (falling back to `activeSpendEur` with `weightingBasis: "SPEND_EUR"`, or declared `VOLUME_SHARE_PCT` at Level 0, if volume is missing or units conflict).
- **Org-Wide Supplier & Country HHI (`dimension: "SUPPLIER" | "COUNTRY"`):** Uses derived `activeSpendEur` (`EUR` as the universal common denominator across heterogeneous materials), falling back to normalized mass or share % only when zero lanes have spend data.
- **Partial-Coverage Calculation + Explicit `Coverage %` Indicator:** Replaces all-or-nothing fallback across active lanes. If 9 of 10 active lanes have `activeSpendEur`, Org-Wide Supplier and Country HHI are computed across those 9 priced lanes and annotated with `coveredLanesCount: 9`, `totalActiveLanesCount: 10`, `coveragePct: 90`, and `weightingBasis: "SPEND_EUR"` (rendered in UI as *"Based on 9 of 10 active lanes · 90% coverage"*).

---

## 3. Quantitative Financial Risk Models in Scope

All five models are computed purely and deterministically inside `@kulgo/engine`:

1. **Expected Annual Loss (EAL) & Disruption Value-at-Risk (VaR)**
   - Quantifies expected financial loss from supplier/corridor disruptions over **Selected Period Window `T` (default: Next 12 Months pro-rated by day overlap)** (or annualized Run-Rate) so finance/ops teams can size **financial provisions** and justify dual-sourcing ROI.
   - Incorporates **Uncontracted / Spot Exposure** when mapped contracts sum to less than `SupplyInput.totalAnnualDemand`.
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

1. **Lane Inspector Drawer ("Flat Form → Live Aggregated Summary Banner"):** Starts as a 2-field quick form (`Annual Volume`, `Annual Spend €` backed by an implicit `ESTIMATE` contract) and seamlessly upgrades into a read-only **Live Aggregated Summary Banner** (`12 units | €13 | €1.083/unit | 67% share`) with stacked editable contract cards (`FRAMEWORK`, `SPOT_PO`) the moment **`+ Add Contract / Spot Top-Up`** is clicked.
2. **`AnalyticsPanel` / Dashboard Financial Tab:** New **Financial Risk & Provisions** view with **Current Run-Rate vs. Next 12 Months (`T`)** toggle, EAL range (`Low / Base / High`), HHI partial-coverage badges (*"Based on X of Y active lanes"*), Uncontracted / Spot Exposure warnings, cancellation notice deadline & renewal cliff (`>30%` in 90d) -> TTS vs. TTR gap alerts, recommended defect buffer, confidence badge (`CONTRACTED` / `IMPORTED` / `ESTIMATED`), and a quick-link to fill missing inputs.
3. **`WhatIfSimulatorDrawer`:** Extend stateless simulation deltas to include **EAL Delta (€/yr)**, **Carrying Cost Delta (€/yr)**, and **Net ROI / Payback** (e.g., simulating dual-sourcing 40% to a Nordic supplier or adding +14 days of safety stock).
4. **Executive / CSRD Report (`GET /api/v1/analytics/report`):** Add an anonymized `financialExposure` section summarizing EAL range, top unprotected TTR–TTS gaps, active renewal cliffs, and recommended provision bands.

---

## 7. Phased Execution Plan (Sub-Tasks)

### Phase 0 — Research & Calibration (Required Before Coding)
- [ ] Research and document empirical benchmarks for EU/Nordic-Baltic manufacturing:
  - Disruption frequencies & TTR distributions by region/corridor and transport mode (Sea, Rail, Road, Air).
  - Sector-level defect/scrap rates (Electronics, Metals, Chemicals, Packaging, General Manufacturing).
  - Standard freight expediting cost multipliers (Sea → Air, Rail → Road) and typical SME inventory carrying cost % (WACC + warehousing + obsolescence).
- [ ] Validate mathematical formulas for Contract Run-Rate vs. Period Window `T` pro-ration (`PER_YEAR` vs. `TOTAL_OVER_TERM`), denominator-hygienic weighted average unit price ($C_{\text{both}}$), uncontracted demand gap (`totalAnnualDemand`), renewal cliffs (`>30%` volume expiring in 90 days), partial-coverage HHI, EAL, VaR (p90/p95), TTS–TTR gap, defect overhead buffer, and carrying-cost trade-off with worked numerical examples (including the `10 units @ €10 + 2-unit @ €3 July 1 top-up` example and Estonia Product X demo).
- [ ] Produce `docs/research/FINANCIAL_RISK_METHODOLOGY.md` citing all sources and documenting formula edge cases (zero volume, conflicting units, custom cross-dimension conversions, missing revenue, `HOLDOVER` vs. `AUTO_ARCHIVE` vs. `Lapsed / Uncontracted` lanes, 100% single-source).

### Phase 1 — Shared Contracts & Pure Engine (`@kulgo/shared` + `@kulgo/engine`)
- [ ] Add `ContractSchema`, `ContractLineSchema` (`FRAMEWORK` | `SPOT_PO` | `ESTIMATE`, `cadence: "PER_YEAR" | "TOTAL_OVER_TERM"`, `FIXED` | `INDEXED`, `HOLDOVER` | `AUTO_RENEW` | `AUTO_ARCHIVE`, `confidence: "CONTRACTED" | "IMPORTED" | "ESTIMATED"`), canonical `baseUnit` / `unitFamily` / `unitConversionFactors` / `totalAnnualDemand` on `SupplyInputSchema`, and optional financial/operational fields on `Product`, `Facility`, and `SupplyLane` in `packages/shared/src/network.ts`.
- [ ] Add partial-coverage HHI metadata (`coveredLanesCount`, `totalActiveLanesCount`, `coveragePct`, `weightingBasis`) and strict `.strict()` financial risk DTOs (`FinancialRiskSummarySchema`, `MaterialFinancialRiskSchema`, `DerivedLaneCommercialSummarySchema`, `DefectBufferRecommendationSchema`, `FinancialSimulationDeltaSchema`) in `packages/shared/src/analytics.ts`.
- [ ] Implement pure contract derivation (Current Run-Rate + Period Window `T` with explicit pure FX map and denominator hygiene), ERP PO-history auto-clustering helper, partial-coverage HHI, versioned baseline tables, and pure financial risk calculation functions in `packages/engine/` with comprehensive Vitest unit tests.

### Phase 2 — ArcadeDB Schema, API & Privacy Enforcement (`@kulgo/api`)
- [ ] Add `Contract` and `ContractLine` vertices/edges plus new optional properties idempotently to `apps/api/src/db/schema.ts`, update `WorkspaceRepository` (including automatic `ESTIMATE` -> `FRAMEWORK` archival to prevent double-counting, non-deletion of expired contracts, and 1-click renewal check-in actions), and update bulk CSV/JSON import-export (including 12-month ERP PO CSV auto-clustering & PDF contract extraction endpoint).
- [ ] Wire server-side Tier-2+ anonymized risk multiplier into `OrgScopedAnalyticsRepository` for `/summary`, `/simulate`, and `/report`.
- [ ] Extend `apps/api/tests/privacy-boundary.test.ts` and `apps/api/tests/integration/arcadedb.integration.test.ts`.

### Phase 3 — Frontend UI & E2E (`@kulgo/web`)
- [ ] Build the **"Flat 2-Field Form → Live Aggregated Summary Banner"** progressive Contract drawer (supporting 10-second `ESTIMATE` entry, 3-click `+ Add Spot / Top-Up`, custom unit conversion prompt, ERP PO CSV import, and PDF contract dropzone) plus optional operational buffer fields.
- [ ] Add **Current Run-Rate vs. Next 12 Months (`T`)** toggle, HHI partial-coverage badges, `Lapsed / Uncontracted` & `Holdover` amber/dashed lane states, `Uncontracted Demand %` warnings, Financial Risk & Provisions card, and EAL/ROI deltas to `AnalyticsPanel` / Dashboard and `WhatIfSimulatorDrawer`.
- [ ] Add Playwright E2E coverage verifying Level 0 → Level 1A (`ESTIMATE`) → Level 1B (`Live Aggregated Summary Banner` with `10 + 2 = 12 units` Run-Rate vs. `11 units` Calendar Window `T`) and What-If EAL delta calculation.


