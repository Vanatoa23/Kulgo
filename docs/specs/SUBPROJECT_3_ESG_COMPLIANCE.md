# Sub-Project 3 Spec: Environmental-First ESG Engine (PCAF-Scored) & Multi-Region Compliance

**Status:** Draft Spec (Ready for Research Phase)  
**Target Customer:** EU / Nordic-Baltic mid-market manufacturers (50–500 employees) and global supply-chain participants needing auditable Scope 1/2/3 emissions and region-aware compliance readiness.  
**Architectural Constraints:** Must adhere strictly to [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) (`@kulgo/engine` remains pure & zero-I/O; `@kulgo/shared` enforces `.strict()` DTOs) and [`docs/PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md) (zero Tier-2+ partner identity, cost, or coordinate leakage in ESG ledgers or compliance reports).

---

## 1. Core Design Philosophy

1. **Environmental-First ("E" Core, Lightweight "S" & "G" Fast-Follow):**
   - Prioritize a clear, auditable, open-source **Environmental (E)** methodology centered on **GHG Protocol Scope 1/2/3** and **PCAF Data Quality Scoring (1–5)**.
   - Start with **estimated emissions** at Level 0/1 (zero-friction onboarding) and progressively improve PCAF data quality as users add activity data or onboard verified Tier-1 partners.
   - Keep **Social (S)** and **Governance (G)** metrics lightweight and secondary priority (implemented where low-effort, especially Level 0 jurisdiction-based flags).
2. **Global Backbone + Pluggable Regional Compliance Packs:**
   - **Universal Backbone:** **GHG Protocol (Scope 1/2/3) + ISSB (IFRS S1 / S2)** — the global common denominator.
   - **Auto-Activation + Overrides:** Active compliance packs are auto-detected from **Organization HQ `countryCode`** + user-selected **Target Sales / Export Markets** (e.g., `EU`, `US`, `UK`, `APAC`, `AFRICA`), with manual framework toggles in Org Settings.
   - Regional packs (EU CSRD/ESRS/CBAM/EUDR, US CA SB 253/UFLPA, UK SRS/SECR, APAC/Africa ISSB-aligned packs) plug cleanly into a single Compliance Registry without hardcoding any single jurisdiction.

---

## 2. Environmental (E) Capabilities & PCAF Methodology

### 2.1 PCAF Data Quality Scoring (1 = Highest → 5 = Lowest)
Every emission line item and the organization's weighted total carries a transparent PCAF score:
- **Score 1:** Audited / verified primary supplier emissions (via Kulgo `VERIFIED_PARTNER_LINK` with reported Scope 1/2/3 attributed via Product Carbon Footprint or verified allocation).
- **Score 2:** Unaudited primary supplier-reported emissions (attributed proportionally to the buyer's purchased volume or spend).
- **Score 3:** Physical activity-based calculation (e.g., exact tonnes × distance × transport mode factor, or derived `activeVolume` × open-source material factor).
- **Score 4:** Economic / spend-based calculation (derived `activeSpendEur` × sector/product EEIO factor).
- **Score 5:** Proxy / minimal-data estimate (node country + sector baseline when volume/spend are omitted).

### 2.2 GHG Protocol Scope 3 Category 1 Attribution (Zero 100%-Entity Over-Attribution)
**Non-Negotiable Rule:** Kulgo **never** attributes 100% of a Tier-1 supplier's total corporate Scope 1/2/3 emissions to a buyer who only purchases a fraction of that supplier's output.

For every active supplier node/lane, `@kulgo/engine` computes attributed Category 1 upstream emissions using a strict priority hierarchy:
1. **Priority 1 — Product / Volume-Based PCF (PCAF Score 1–2):**
   - When a product/material carbon intensity (`productEmissionFactorTco2ePerUnit` in `tCO2e / baseUnit`) and buyer `purchasedVolume` (derived `activeVolume` in `baseUnit`) are available:
     $$\text{Attributed Scope 3}_{\text{PCF}} = \text{purchasedVolume} \times \text{productEmissionFactorTco2ePerUnit}$$
2. **Priority 2 — Economic Attribution Factor via Server-Side Emission Intensity (PCAF Score 2):**
   - When a verified partner (`Org B`) reports corporate/facility total emissions (`supplierTotalTco2e`) and annual revenue (`supplierAnnualRevenueEur`), `Org A`'s share is:
     $$\text{Attributed Scope 3}_{\text{Economic}} = \text{supplierTotalTco2e} \times \frac{\text{buyerActiveSpendEur}}{\text{supplierAnnualRevenueEur}} = \text{buyerActiveSpendEur} \times \text{supplierEmissionIntensity}_{\text{tCO2e/EUR}}$$
   - **Privacy Enforcement:** `supplierEmissionIntensity` (`tCO2e / EUR`, capped so attribution ratio $\le 1.0$) is computed strictly server-side inside `partner-resolver.ts` and passed to `@kulgo/engine` so `Org B`'s total revenue is **never** exposed to `Org A` or serialized in any DTO.
3. **Priority 3 — Explicit Allocation Share or Open-Source Factor / Baseline Fallback (PCAF Score 3–5):**
   - If primary PCF and economic intensity are unavailable, `@kulgo/engine` uses an explicit `allocationShareRatio` ($\in [0, 1]$), physical/spend factor calculation (PCAF 3–4), or sector baseline fallback (PCAF 5).

### 2.3 Open-Source Emission Factor Baseline Matrix
- Versioned, cited factor matrix stored in `@kulgo/engine` (e.g. `FACTOR_MATRIX_VERSION = "2026.1"`), evaluated during **Phase 0 Research** across open-source datasets:
  - **Product / Spend-Based:** EXIOBASE (strong product granularity; evaluate freshness/inflation adjustment), US EPA USEEIO, ADEME Base Empreinte.
  - **Freight & Logistics:** UK DEFRA / DESNZ, GLEC Framework open baselines.
  - **Electricity / Grid Intensity:** Ember / IEA / EEA open country grid factors (for Scope 2 & renewable % modeling).
- Every calculation stores `factorId`, `factorVersion`, `sourceCitation`, `unit`, `attributionMethod` (`PCF_VOLUME` | `ECONOMIC_INTENSITY` | `ALLOCATION_RATIO` | `SECTOR_BASELINE`), and `pcafScore` for full auditor traceability.

### 2.4 ESG Dashboard & Analytics Views
1. **Scope 1 / 2 / 3 Breakdown & PCAF Weighted Score** (with actionable prompts to improve PCAF score from 5 → 3 → 1).
2. **Carbon Intensity & Hotspot Breakdown:** `tCO2e / €M revenue`, `tCO2e / tonne`, per-product footprint, and top-5 emitting lanes/materials.
3. **CBAM / Embedded Emissions Flagging (EU Market Pack):** Automatically flag imported lanes/materials in CBAM-covered categories (steel, aluminum, cement, fertilizers, electricity, hydrogen) when EU market compliance is active.
4. **Facility Water Stress & Renewable Energy % (Roadmap Layer):** Optional facility-level renewable electricity share (`renewableElectricityPct`) and regional water-stress overlay.

---

## 3. Lightweight Social (S) & Governance (G) Metrics (Secondary Priority)

Implemented as low-friction, optional signals once the Environmental (E) & PCAF core is solid:
- **S1 — Forced-Labor & Human-Rights Jurisdiction Screening:** Level 0 country/region risk flags aligned with UFLPA, EU CSDDD, and ILO indicators.
- **S2 — Supplier Labor & Safety Certifications:** Badges (`SA8000`, `ISO 45001`, `SMETA/Sedex`, `FairTrade`) + `% of Tier-1 spend` covered by certified suppliers.
- **G1 — Sanctions, Export-Control & Anti-Corruption Screening:** Level 0 country governance risk (EU/OFAC/UN sanctions + Transparency International CPI).
- **G2 — Supply Chain Governance Coverage:** `% of Tier-1 suppliers` with signed Supplier Code of Conduct, verified partner status, and active Kulgo compliance audit trail.

---

## 4. Reporting & Auditor Deliverables

1. **Auditor-Ready JSON + CSV Ledger:**
   - Line-by-line Scope 1/2/3 ledger containing entity reference (strictly Tier-1 / own org only — never Tier-2+ identities), derived `activeVolume` / `activeSpendEur` input, `attributionMethod`, `factorId`, `sourceCitation`, `pcafScore`, calculation formula, and `tCO2e`.
2. **Board / Bank-Ready PDF Executive Summary:**
   - Brandable 2–3 page downloadable PDF summarizing Scope 1/2/3 totals, weighted PCAF score, top hotspots, and active regional compliance readiness.
3. **In-App Regional Compliance Readiness Checklist:**
   - Dynamic checklist driven by active regional packs showing `PASSED` / `ACTION_NEEDED` / `NOT_APPLICABLE` items with direct links to resolve gaps (e.g., *"Add Scope 2 emissions"*, *"Verify 2 CBAM-covered steel lanes"*).

---

## 5. Privacy & Tier-2+ Rules (`PRIVACY_CONTRACT.md`)

- Verified Tier-1 partners (`Org B`) contribute **PCAF Score 1–2 primary attributed emissions** to `Org A`'s Scope 3 rollup server-side via Product Carbon Footprint intensity (`tCO2e / baseUnit`) or server-side emission intensity (`tCO2e / EUR`), **without** revealing `Org B`'s total revenue, hidden Tier-2+ suppliers, internal margins, or upstream coordinates.
- When `VERIFIED_PARTNER_LINK` specifies a two-sided `fulfilledByFacilityId`, only `Org B`'s fulfilling facility and its upstream feeding lanes are included in `Org B`'s emission intensity; otherwise, a conservative org-wide rollup is used until facility reconciliation is completed.
- All ESG ledger and compliance checklist DTOs in `@kulgo/shared` must use `.strict()`.

---

## 6. Phased Execution Plan (Sub-Tasks)

### Phase 0 — Research & Open-Source Factor Matrix Design (Required Before Coding)
- [ ] Audit open-source emission factor datasets (EXIOBASE, US EPA USEEIO, UK DEFRA/DESNZ, ADEME Base Empreinte, Ember grid intensity, GLEC freight baselines) comparing licensing, product granularity, regional coverage, and data freshness.
- [ ] Design **one unified, versioned E Baseline Matrix** + PCAF 1–5 scoring rubric + GHG Protocol Category 1 attribution rules (PCF volume vs. privacy-safe economic intensity vs. baseline fallback).
- [ ] Map the **Global Backbone (GHG Protocol + ISSB IFRS S1/S2)** and define the pluggable schema for Regional Compliance Packs (`EU`, `US`, `UK`, `APAC`, `AFRICA`).
- [ ] Produce `docs/research/ESG_FACTOR_MATRIX_AND_COMPLIANCE.md` citing all open-source licenses, factor tables, attribution formulas, and worked examples (including Estonia Product X demo).

### Phase 1 — Shared Contracts, Factor Matrix & Pure Engine (`@kulgo/shared` + `@kulgo/engine`)
- [ ] Add `targetMarkets` (`EU`, `US`, `UK`, `APAC`, `AFRICA`, etc.), `enabledCompliancePacks`, and optional privacy-safe `annualRevenueEur` (server-side only, never exposed cross-org) to `OrganizationSchema`; add optional `productEmissionFactorTco2ePerUnit` / `renewableElectricityPct` / certification fields to `FacilitySchema` / `SupplyInputSchema`.
- [ ] Implement the versioned open-source Factor Matrix, GHG Protocol Category 1 attribution calculator (PCF + economic intensity), PCAF 1–5 scorer, carbon intensity/hotspot calculator, and pluggable Regional Compliance Checklist evaluator in `@kulgo/engine` with comprehensive unit tests.
- [ ] Define `.strict()` ledger and compliance checklist DTOs in `packages/shared/src/analytics.ts`.

### Phase 2 — API, Auditor Ledger Export & Privacy Verification (`@kulgo/api`)
- [ ] Update ArcadeDB schema (`apps/api/src/db/schema.ts`), `partner-resolver.ts` (server-side emission intensity attribution + two-sided facility reconciliation), and `AuthRepository` / `OrgSettings` endpoints.
- [ ] Add `GET /api/v1/analytics/esg-ledger?format=json|csv` and extend `GET /api/v1/analytics/report` with PCAF breakdown & regional compliance checklist (recording `CSRD_REPORT_EXPORTED` / `ESG_LEDGER_EXPORTED` audit events).
- [ ] Extend `apps/api/tests/privacy-boundary.test.ts` (verifying zero leakage of partner `annualRevenueEur` or Tier-2+ identities) and `apps/api/tests/integration/arcadedb.integration.test.ts`.

### Phase 3 — ESG Dashboard, Compliance Checklist, PDF Export & E2E (`@kulgo/web`)
- [ ] Add **Target Sales / Export Markets** & Compliance Pack selector to `OrgSettingsModal` / Settings page.
- [ ] Build the **ESG & Compliance** view (Scope 1/2/3 breakdown, attribution method badges, PCAF 1–5 data quality meter, hotspot table, and Regional Compliance Readiness Checklist).
- [ ] Add downloadable **CSV Ledger** and **Board/Bank-Ready PDF Executive Summary** export.
- [ ] Add Playwright E2E coverage verifying market-based compliance pack switching, PCAF score display, and ledger/report export.

### Phase 4 — Fast-Follow Lightweight S & G Signals (Optional / Low-Priority)
- [ ] Add S1/G1 Level 0 country risk overlays (forced-labor & CPI/sanctions screening) and S2/G2 Tier-1 certification & Code-of-Conduct coverage metrics.
