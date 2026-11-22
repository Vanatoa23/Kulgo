# Environmental-First ESG Factor Matrix, Attribution Engine & Multi-Region Compliance Methodology (Phase 0)

> **Status:** Unified Phase 0 Specification for [Issue #25](https://github.com/Vanatoa23/Kulgo/issues/25) ([`SUBPROJECT_3_ESG_COMPLIANCE.md`](../specs/SUBPROJECT_3_ESG_COMPLIANCE.md))  
> **Research Cut-Off:** 22 November 2026  
> **Target Segment:** EU / Nordic-Baltic Mid-Market Manufacturers (50–500 employees) & Global Supply-Chain Participants  
> **Target Packages:** [`@kulgo/engine`](../../packages/engine/src/esg.ts) (pure, deterministic, zero-I/O TypeScript) & [`@kulgo/shared`](../../packages/shared/src/analytics.ts) (`.strict()` Zod DTOs)  
> **Architectural & Privacy Compliance:** [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [`docs/PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md), [`docs/DECISIONS.md`](../DECISIONS.md) (ADR-001 through ADR-008)  
> **Factor Matrix Version:** `FACTOR_MATRIX_VERSION = "2026.1"` (`esg-factors-2026-11-22.v1`)

---

## Executive Overview & Non-Negotiable Invariants

This specification defines the open-source emission factor architecture, licensing boundaries, mathematical attribution waterfall, dual Scope 2 and Category 4 freight models, privacy-preserving Tier-2+ partner intensity rules, worked numerical fixtures, and 2026-accurate multi-region compliance packs for Kulgo's Environmental-First ESG Engine.

1. **Zero I/O & Determinism (`@kulgo/engine`):** All ESG calculations run in pure, deterministic TypeScript with zero runtime network or database calls. Heavy MRIO matrix operations (EXIOBASE 3.8.2 `pxp`) execute offline via [`scripts/etl/compile-esg-factors.py`](../../scripts/etl/compile-esg-factors.py) and compile into versioned, cited static lookup modules.
2. **Physical-First Hybrid Strategy (Solving the Price-Quality Paradox):** Spend-only EEIO models falsely penalize manufacturers who switch from cheap, carbon-intensive imports (e.g., coal-smelted steel at €750/t) to premium low-carbon European suppliers (€1,200/t). Kulgo therefore prioritizes **Verified Partner Primary Data (Score 1–2)** → **Open Physical Product/CBAM Factors (Score 3)** whenever mass-convertible volume exists → **Multi-Country Spend EEIO (Score 4)** → **Scaled Country × Sector Baseline (Score 5)**.
3. **Commercial SaaS License Hygiene & ShareAlike Isolation:**
   - **EXIOBASE v3.8.2 (`pxp`, Zenodo `5589597`)** is licensed under **CC-BY-SA 4.0** and is approved for commercial B2B SaaS use **strictly when isolated in its own standalone data file** (`packages/engine/src/data/exiobase382-factors.ts`) with explicit attribution and CC-BY-SA 4.0 data notice, never infecting proprietary engine logic.
   - **EXIOBASE v3.9+ / v3.10+ / v3.11+**, **IEA Emissions Factors**, **GLORIA / Eora**, **ecoinvent**, **Circular Ecology ICE v4+**, **JRC EF background nodes**, and **non-EU Eurostat FIGARO rows (IEA `CC-BY-NC-ND` contaminated)** are **strictly prohibited** in the free commercial SaaS bundle.
   - **Smart Freight Centre GLEC v3.2** is used strictly as an independent **calculation methodology reference** (aligned with ISO 14083:2023); numeric freight factors are sourced exclusively from **UK DESNZ 2026 (OGL v3.0)** and **ADEME Base Carbone (Etalab Open Licence 2.0)** to respect GLEC's commercial redistribution clause.
4. **Zero 100%-Entity Over-Attribution (ADR-006):** Kulgo **never** attributes 100% of a Tier-1 supplier's total corporate Scope 1/2/3 footprint to a buyer purchasing only a fraction of output. Every allocation ratio requires `0 ≤ ratio ≤ 1` with a strictly positive matched denominator; Level 0 proxy estimates scale facility baselines by a conservative buyer-share prior (`8%` default unless declared) and deduplicate unpriced lanes per supplier facility.
5. **Hard Multi-Tenant Privacy Boundary (`PRIVACY_CONTRACT.md`):** Verified Tier-1 partner (`Org B`) economic intensity (`supplierEmissionIntensityTco2ePerEur`) is computed strictly server-side inside [`apps/api/src/analytics/partner-resolver.ts`](../../apps/api/src/analytics/partner-resolver.ts) with consistent denominator scoping (`E_org / R_org` unless facility-level revenue is explicitly provided). Partner `annualRevenueEur`, internal margins, hidden Tier-2+ identities, and upstream coordinates are **never** returned in any DTO or ledger formula trace.
6. **Transparent Data-Quality Naming & Provenance:** The `pcafScore` (`1–5`) field follows Issue #25 and is documented transparently in reports as **Kulgo's PCAF-aligned procurement data quality score** (noting that PCAF Part A itself governs financed emissions). Every static factor explicitly carries `provenanceStatus` (`OFFICIAL_PUBLISHED` for pinned government values vs. `CALIBRATED_BASELINE_V1` for curated EXIOBASE product-region entries pending full Zenodo offline ETL refresh).

---

## Part 1 — Dataset Audit, Commercial Rights & Top 3 Ranking

### 1.1 Top 3 Ranked Scope 3 Category 1 Choices

| Rank | Factor Source / Pack | Role in `@kulgo/engine` | Target Score | Unit Basis | Commercial SaaS License Verdict |
| :---: | :--- | :--- | :---: | :--- | :--- |
| **#1** | **Open Physical Product & CBAM Core** *(ADEME Base Carbone + UK DESNZ 2026 Material Use + EU JRC CBAM Country Default Values)* | **Primary Physical Activity Layer (`PHYSICAL_FACTOR`):** Triggered automatically whenever a lane's derived `activeVolume` is mass-convertible (`KG`/`TONNES` or explicit `unitMassKg`). Solves the Price-Quality Paradox and powers EU CBAM checks out of the box. *(Swiss **FOEN BAFU:2026 v1** approved as secondary physical expansion library.)* | **Score 3** (Physical Activity) | `tCO2e / tonne` (`kgCO2e / kg`) | **Etalab 2.0 + UK OGL v3.0 + EU CC-BY 4.0.** 100% commercial SaaS safe, attribution-only, zero ShareAlike. |
| **#2** | **EXIOBASE v3.8.2 `pxp`** *(Zenodo `5589597` — 200 Products × 49 Regions, PPI-deflated to 2026 EUR)* | **Universal Multi-Country Spend Backbone (`SPEND_EEIO` & `SECTOR_BASELINE`):** Covers 100% of global product categories across 44 countries + 5 RoW regions whenever physical mass or partner primary data is unavailable. | **Score 4** (Spend) & **Score 5** (Proxy) | `kgCO2e / EUR_2026` (Basic prices) | **CC-BY-SA 4.0 (Approved when isolated).** Shipped strictly in standalone `packages/engine/src/data/exiobase382-factors.ts`. **Never ingest v3.9+ (NC).** |
| **#3** | **US EPA Supply Chain GHG Factors v1.3 / USEEIO** | **North American & Granular Tech/Chemicals Supplement:** Preferred spend-based EEIO for `US`/`CA`/`MX` origins and granular 6-digit NAICS electronics/semiconductor/chemical categories that EXIOBASE groups into coarse buckets. | **Score 4** (Spend) | `kgCO2e / USD_2022` → `kgCO2e / EUR_2026` | **CC0 1.0 Public Domain (US EPA).** Zero commercial restrictions. |

### 1.2 Full Dataset Comparison & Commercial Rights Matrix

#### Domain A: Purchased Goods & Services (Scope 3 Category 1)

| Dataset | License & Commercial SaaS Decision | Granularity & Units | Base Year & Normalization | Kulgo Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **ADEME Base Carbone / Base Empreinte** | **Etalab Open Licence v2.0.** Commercial reuse & adaptation with attribution permitted. Exclude rows flagged "consultation only" / third-party restricted. | ~6,000+ physical product, material, electronics, chemical, packaging, and transport rows (`kgCO2e/kg`, `kgCO2e/unit`). FR/EU focus. | 2024–2026 continuous updates (AR6 GWP100 aligned). Pin exact CSV & SHA-256. No inflation adjustment for physical rows. | **PRIMARY (#1 Physical Core)** |
| **UK DESNZ 2026 Conversion Factors** | **UK Open Government Licence (OGL) v3.0.** Commercial SaaS reuse permitted worldwide with crown attribution. | Physical materials (metals, plastics, paper/board, glass, electrical/WEEE), waste, fuels, and freight (`kgCO2e/t`, `kgCO2e/tkm`). | June/July 2026 official release. Physical rows require unit conversion only. | **PRIMARY (#1 Physical Core & Freight Core)** |
| **EU JRC CBAM Default Values** *(`JRC134682` & IR `(EU) 2025/2621`)* | **European Commission Reuse Notice (CC-BY 4.0).** Commercial reuse permitted with citation. | 600+ 8-digit CN codes × exporting country (`CN`, `IN`, `TR`, `DE`, `US`, `GB`, etc.) across Iron & Steel, Aluminum, Cement, Fertilizers, Hydrogen, split into Direct + Indirect (`tCO2e/t`). | 2024–2026 official EU regulatory defaults for definitive CBAM period. | **PRIMARY (#1 Physical Core & CBAM Engine)** |
| **Swiss FOEN BAFU:2026 v1 Public LCIA** | **Swiss OGD Open Use with Attribution.** Explicitly permits commercial use on the FOEN public LCIA extract (verify any external Nexus bundle separately). | Precomputed IPCC 2021 GWP100 LCIA by process UUID, geography (`CH`/`RER`/`GLO`), and reference unit. | 2026 release. No monetary deflation for physical rows. | **APPROVED EXPANSION (Phase 2+ Physical Library)** |
| **EXIOBASE v3.8.2 (`pxp` / `ixi`)** *(Zenodo `5589597`)* | **CC-BY-SA 4.0.** Commercial SaaS use permitted with attribution + ShareAlike on adapted data table itself (isolate in dedicated data module). | **200 products (`pxp`)** or 163 industries (`ixi`) × 44 countries + 5 RoW regions (`kgCO2e/EUR` basic prices). | Oct 2021 release (2019 pre-pandemic benchmark + annual nowcasts through 2022). Requires Eurostat PPI/HICP deflation to 2026 EUR + basic/purchaser bridge. | **PRIMARY (#2 Global Spend Backbone — Isolated Module)** |
| **EXIOBASE v3.9+ – v3.11+** | **Custom Non-Commercial License** (commercial rights via XIO Sustainability Analytics). | 200 products × 49 regions. | 2021–2024 nowcasts. | **REJECT (Prohibited in Free SaaS Bundle)** |
| **US EPA Supply Chain GHG Factors v1.3 / USEEIO** | **CC0 1.0 Public Domain** (EPA v1.3 distribution). *(Check Cornerstone v1.4 RC rights separately before upgrade.)* | 1,016 US commodities (6-digit NAICS 2017); separate `SEF` (producer) and `MEF` (margin) factors (`kgCO2e/USD`). | 2022 USD / 2022 GHG (AR5; by-gas CSV permits AR6 recharacterization). Convert via 2022 ECB FX + US BLS PPI. | **SECONDARY (#3 US & Granular Tech/Chem Supplement)** |
| **JRC FIGARO-E3 / Eurostat FIGARO** | **FIGARO-E3 (2015):** EU CC-BY 4.0. **Eurostat FIGARO (`env_ac_ghgfp`):** EU-27 is CC-BY 4.0, **but non-EU countries inherit IEA `CC-BY-NC-ND 4.0`** (Metadata §8.3). | 64 NACE/CPA sectors (FIGARO) or 213 products (FIGARO-E3) across 46 economies. | 2015 (FIGARO-E3) / 2022–2024 (Eurostat FIGARO). | **SUPPLEMENT (EU-27 Validation Only; Reject Non-EU Rows)** |
| **GLORIA / Eora / ecoinvent / ICE v4+ / JRC EF Nodes** | Paid commercial licenses or PEF/OEF-only restrictions. | Broad LCI / MRIO coverage. | Various. | **REJECT (License Prohibits Free SaaS Bundling)** |
| **Climatiq Data Explorer** | Wrapper terms + inherits underlying source licenses; free API is non-commercial. | Mixed registry. | Continuous. | **DISCOVERY ONLY (Ingest Primary Rightsholder Files Directly)** |

#### Domain B: Freight & Logistics (Scope 3 Category 4)

| Dataset | License & Commercial SaaS Decision | Coverage & Units | Vintage | Kulgo Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **UK DESNZ 2026 Freight** | **OGL v3.0.** Commercial SaaS safe with attribution. | Road (HGV rigid/articulated), Rail, Sea (Container, Bulk, **RoRo Ferry**), Air (Short/Long-haul, w/ & w/o RF). Separate **TTW** & **WTT** (`kgCO2e/tkm`). | 2026 edition (July revised flat file). | **PRIMARY Quantitative Freight Table** |
| **ADEME Base Carbone Freight** | **Etalab Open Licence v2.0.** Commercial SaaS safe. | Continental EU road, **electrified European rail**, and inland waterway (`kgCO2e/tkm`). | 2025–2026. | **SECONDARY (EU Electrified Rail & Intra-EU Overland)** |
| **Smart Freight Centre GLEC v3.2 / ISO 14083** | Public PDF carries a **prior written permission clause for commercial use of its tables**. | Global TOC/HOC taxonomy, WTW accounting, Great-Circle Distance (GCD) circuity uplifts, hub throughput rules. | Oct 2025 (v3.2). | **METHODOLOGY REFERENCE ONLY (Do Not Copy Tables Verbatim)** |

#### Domain C: Electricity & Grid Intensity (Scope 2 Dual Reporting & Physical Grid Parameterization)

| Dataset | License & Commercial SaaS Decision | Basis, Coverage & Units | Vintage | Kulgo Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **EEA Electricity Generation Intensity** | **CC-BY 4.0** (EU Reuse Notice). | **Operational direct generation** (`gCO2e/kWh` → `tCO2e/MWh`) for EU-27 + EEA (`EE`, `FI`, `SE`, `DE`, `PL`, etc.). | 2024–2025 (with provisional flags). | **PRIMARY EU-27 Location-Based Scope 2** |
| **UK DESNZ 2026 Electricity** & **US EPA eGRID** | **OGL v3.0** (UK) / **CC0 1.0** (US). | **Operational grid output rates** for `GB` and `US` national/subregion (`tCO2e/MWh`). | 2026 (UK) / eGRID 2023 rev2 (US). | **PRIMARY UK & US Location-Based Scope 2** |
| **Ember Yearly Electricity Data (2026)** | **CC-BY 4.0.** Commercial SaaS safe with citation. | **Lifecycle generation intensity** (`gCO2e/kWh`) + % renewable share across 215 geographies. Explicitly tagged `LIFECYCLE_SCREENING`. | Nov 2026 snapshot (2025 estimates for 91+ countries). | **PRIMARY Global Fallback & Country Grid Scaling Parameter** |
| **AIB European Residual Mix** | Public regulatory reference for European disclosure (confirm headline terms; exclude restricted source-fuel sub-tables). | **Market-Based Residual Mix** (`tCO2e/MWh`) across 31–34 European countries (`EE`, `LV`, `LT`, `FI`, `SE`, `NO`, `DE`, `PL`, `FR`, etc.). | May 2026 release (2025 residual mixes). | **PRIMARY European Market-Based Scope 2 Residual Mix** |
| **IEA Emissions Factors** | **Strictly Proprietary / Non-Commercial.** | Global grid factors. | Annual. | **REJECT (Commercial Licensing Prohibition)** |

---

## Part 2 — Open-Source Calculation Models & Offline ETL Architecture

| Model / Tool | License / Stack | How Kulgo Uses It |
| :--- | :--- | :--- |
| **`pymrio` + `scipy`** | LGPLv3 / BSD, Python (**offline build-time ETL only**) | Parses pinned Zenodo `5589597` (`IOT_2019_pxp.zip` / `IOT_2022_pxp.zip`), solves $(I - A)^{\top} m = d^{\top}$ using IPCC AR6 GWP100 weights ($w_{\text{AR6}}$), flags zero-output sectors (`NULL_DOMESTIC_PRODUCTION`), and emits a compact `< 150 KB` static JSON/TS table (`packages/engine/src/data/exiobase382-factors.ts`). Never linked at runtime. |
| **USEEIO / `useeior`** | MIT / CC0, R/Python | Supplies producer (`SEF`) vs. margin (`MEF`) valuation conventions and basic-to-purchaser margin bridge ratios $(1 - \tau_{\text{margin}, s})$ tied to `Contract.incoterms`. |
| **WBCSD PACT Methodology V3** | Public spec / MIT schemas | Shapes optional verified Tier-1 partner PCF metadata (`productEmissionFactorTco2ePerUnit`, `pcfVerified`, declared unit, boundary, GWP basis) for future Catena-X / PACT interoperability. |
| **Brightway2 / OpenLCA** | BSD-3 / MPL-2.0 | Inspires electricity-share parameterization of physical material factors ($EF_{\text{direct}} + e_{\text{MWh/t}} \cdot EF_{\text{grid}, c}$) and pedigree uncertainty ranges. |
| **GHG Protocol & ISO 14083 / GLEC** | Open Standards | Independent TypeScript implementation of Category 1 priority hierarchy, Category 4 TTW/WTT/circuity rules, and dual Scope 2 accounting. |

### Reproducible Offline ETL Specification (`scripts/etl/compile-esg-factors.py`)

1. **Pin Exact Artifacts & Checksums:** Pin Zenodo Record `5589597` (`IOT_2019_pxp.zip` benchmark + `IOT_2022_pxp.zip` nowcast sensitivity), ADEME Base Carbone CSV (`data.gouv.fr`), UK DESNZ 2026 revised flat workbook, EPA USEEIO v1.3 CO₂e/by-gas CSVs, and Ember global yearly CSV, recording exact SHA-256 hashes and capture dates.
2. **EXIOBASE `pxp` Leontief Solve with AR6 GWP100:**
   - Extract direct intensity matrix $S = F \cdot \hat{x}^{-1}$ (`kg / MEUR` basic prices) and technical coefficients $A = Z \cdot \hat{x}^{-1}$ across all $49 \times 200 = 9,800$ `(region, product)` columns.
   - Characterize fossil GHG rows with **IPCC AR6 GWP100** ($\text{CO}_2 = 1.0$, fossil $\text{CH}_4 = 29.8$, biogenic $\text{CH}_4 = 27.0$, $\text{N}_2\text{O} = 273.0$, $\text{SF}_6 = 25,200$, $\text{NF}_3 = 17,400$; biogenic $\text{CO}_2$ excluded from fossil total and stored separately if needed):
     $$d = w_{\text{AR6}}^{\top} S_{\text{air}}, \qquad (I - A)^{\top} m = d^{\top}, \qquad EF_{r,p}^{\text{EUR, base}} = \frac{m_{r,p}}{10^6} \;\left[\frac{\text{kgCO}_2\text{e}}{\text{EUR}_{\text{basic}}}\right]$$
   - **Zero-Output Singularity Guard:** Any `(r, p)` where gross output $x_{r,p} \le 0$ or $m_{r,p} \le 0$ is marked `NULL_DOMESTIC_PRODUCTION` so `@kulgo/engine` falls back cleanly through the geographic hierarchy (`Exact Country → EU27_AVG / EXIOBASE RoW → GLOBAL_AVG`), never silently returning `0 tCO2e`.
3. **Monetary Deflation & Basic-to-Purchaser Price Bridge:**
   - Convert reporting-year EUR spend `B_EUR(t)` to base-year basic-price EUR using pinned Eurostat industrial PPI (`sts_inpp_a` for goods) or HICP (`prc_hicp_aind` for services) plus `Contract.incoterms` margin strip:
     $$EF_{r, p}^{\text{EUR}, 2026, \text{eff}} = EF_{r, p}^{\text{EUR}, b, \text{basic}} \times \underbrace{\left(\frac{I_{s, b}}{I_{s, 2026}}\right)}_{\delta_{\text{deflator}, s}} \times \underbrace{\left(1 - \tau_{\text{margin}, s}(\text{incoterms})\right)}_{\text{Basic/Purchaser Bridge}}$$
   - **Incoterms Bridge Rule (Zero Cat 1 / Cat 4 Double-Counting):**
     - `EXW` / `FCA` / `FOB` / `FAS` or unspecified factory-gate B2B lanes → $\tau_{\text{margin}} = 0.00$.
     - `CIF` / `CFR` / `CPT` / `CIP` / `DAP` / `DPU` / `DDP` (delivered spend where freight is bundled into invoice price while Cat 4 is computed separately on the lane) → $\tau_{\text{margin}} = 0.08$ (Metals/Chemicals/Packaging) or $0.14$ (Electronics/Manufacturing), recorded explicitly in `formulaTrace`.
   - For **US EPA USEEIO v1.3 (`USD_2022`)**, convert at pinned 2022 ECB annual FX (`1.0530 USD/EUR`) × US BLS PPI ratio $\frac{\text{PPI}_{\text{US}, k, 2022}}{\text{PPI}_{\text{US}, k, 2026}}$.

---

## Part 3 — Unified Calculation Methodology & Edge-Case Resolutions

### 3.1 Contract-Derived Commercial Inputs & Lane-Level Evaluation (Closing Gaps #1 & #2)

- **Commercial Inputs:** `OrgScopedAnalyticsRepository` computes SP2 `laneCommercials` (`computeFinancialRiskSummary` / `deriveLaneCommercialSummaries`) **before** calling `evaluateNetworkAnalytics`, passing per-lane `activeVolume`, `activeSpendEur`, `baseUnit`, and primary `incoterms` into the ESG engine. When no contract lines exist for a lane, the engine falls back cleanly to legacy `lane.annualVolume` / `lane.annualSpendEur`.
- **Lane-Level Category 1 Granularity:** Unlike the legacy supplier-blob rollup in `analytics.ts`, Scope 3 Category 1 evaluates **each active lane independently** so a single Tier-1 supplier supplying both CBAM-covered Steel (`TONNES`) and non-CBAM Packaging (`UNITS`) receives distinct physical/spend factors, distinct CBAM flags, and distinct ledger rows.
- **Two Facility-Level Guardrails:**
  1. **Cumulative Partner Cap:** For a verified Tier-1 partner `Org B`, the sum of `ECONOMIC_INTENSITY` / `ALLOCATION_RATIO` emissions attributed across all lanes originating from `Org B` is capped at `100%` of `Org B`'s total emissions (`partnerCapTco2e`).
  2. **Level-0 Deduplication:** When a supplier has multiple active lanes that all lack both volume and spend (`SECTOR_BASELINE`, Score 5), the supplier's scaled baseline is emitted **once per supplier facility** (allocated proportionally across its unpriced lanes or emitted as a single facility ledger row), preventing multi-lane triple-counting.

### 3.2 Six-Step Deterministic Scope 3 Category 1 Attribution Waterfall

For each active lane $\ell$ (with derived `activeVolume` $Q_\ell$, `activeSpendEur` $S_\ell$, `baseUnit`, `materialArchetype`, `cnCode`, supplier `countryCode`, and optional verified partner aggregate):

| Priority | `attributionMethod` | Exact Eligibility & Formula | `pcafScore` |
| :---: | :--- | :--- | :---: |
| **1** | `PCF_VOLUME` | $Q_\ell > 0$ AND `productEmissionFactorTco2ePerUnit > 0` (compatible unit): $E_\ell = Q_\ell \times EF_{\text{PCF}, \ell}$ | **1** if `pcfVerified === true` (third-party assured), else **2** |
| **2** | `ECONOMIC_INTENSITY` | $S_\ell > 0$ AND verified partner server-side `supplierEmissionIntensityTco2ePerEur > 0`: $E_\ell = \min\!\left(E_{\text{cap}, B}^{\text{remaining}},\; S_\ell \times I_{\text{supplier}, B}\right)$ | **2** (or **1** if partner inventory & revenue are audited) |
| **3** | `ALLOCATION_RATIO` | Positive `reportedEmissions` AND explicit validated ratio $\alpha_\ell \in (0, 1]$: $E_\ell = E_{\text{reported}} \times \alpha_\ell$ *(reject ratios $> 1$ or $\le 0$)* | **2** |
| **4** | `PHYSICAL_FACTOR` | $Q_\ell$ deterministically convertible to tonnes $M_\ell > 0$ (`TONNES`, `KG`, or explicit `unitMassKg > 0`) AND matching Rank #1 physical factor $EF_{\text{phys}, m, c}$: $E_\ell = M_\ell \times EF_{\text{phys}, m, c}(r_{\text{ren}})$ | **3** |
| **5** | `SPEND_EEIO` | $S_\ell > 0$: $E_\ell = \frac{S_\ell \times EF_{\text{spend}, r, p}^{\text{EUR}, 2026} \times (1 - \tau_{\text{margin}})}{1000} \times \phi_{\text{ren}}$ *(EXIOBASE 3.8.2 `pxp`, or USEEIO v1.3 for `US`/`CA`/`MX`)* | **4** (exact/regional match) or **5** (coarse global/sector fallback) |
| **6** | `SECTOR_BASELINE` | Neither volume nor spend available (Level 0 topology only, deduplicated per supplier facility): $E_v = E_{\text{facility\_baseline}, s} \times \gamma_{\text{country}}(c) \times \beta_{\text{buyerShare}}$ where $\beta_{\text{default}} = 0.08$ (`8%` SME buyer share prior) and $\gamma_{\text{country}}(c) = \text{clamp}\!\left(\frac{EF_{\text{grid}, c}}{EF_{\text{grid, EU27}}},\; 0.35,\; 2.20\right)$ | **5** |

Missing primary attribution inputs never authorize use of an entire supplier inventory. A user-entered facility Scope 1+2 estimate also requires an explicit allocation ratio; without one, continue through physical, spend, and finally the public country-sector proxy above. The proxy does not scale or serialize private partner totals, remains PCAF 5, and is emitted once per buyer supplier facility. Missing partner revenue disables economic intensity; missing buyer spend disables both economic intensity and spend factors. Facility reconciliation preserves these rules and the existing matching revenue/emissions denominator scopes.

The exported compatibility helper `computeSupplierScope3Attribution` has no country or material activity inputs. Its missing-input fallback uses the same provisional 8% share of the public sector baseline (without country adjustment); empty inventories remain zero for cycle-safe rollups. Current API summaries, reports, and ledgers all use `evaluateEsgAndCompliance`.

#### Physical Factor Country-Grid Parameterization & Renewable Adjustment
For non-CBAM physical factors (ADEME / UK DESNZ) where the base factor reflects EU/UK average grid electricity, each archetype stores its direct thermal/process baseline $EF_{\text{direct}, m}$ and electricity intensity $e_{\text{MWh/t}, m}$:
$$EF_{\text{phys}, m, c}(r_{\text{ren}}) = EF_{\text{direct}, m} + e_{\text{MWh/t}, m} \times EF_{\text{grid}, c} \times \left(1 - \frac{r_{\text{ren, verified}}}{100}\right)$$
*(Where EU JRC CBAM country-specific defaults already split `directTco2ePerTonne` + `indirectTco2ePerTonne` by exporting country, `@kulgo/engine` uses those exact JRC splits directly.)*

#### Taxonomy & Material Archetype Resolver (Closing Gap #4)
`resolveMaterialArchetype` resolves each lane deterministically in 4 steps and tags `matchConfidence` on every ledger entry:
1. `EXACT_CODE`: 4–8 digit `cnCode` prefix (triggers exact EU CBAM & EUDR commodity detection).
2. `ARCHETYPE`: Explicit `materialArchetype` enum (12 core industrial archetypes covering >95% of mid-market BOMs).
3. `KEYWORD_INFERRED`: Deterministic synonym/keyword classifier over legacy free-text `SupplyInput.category` / `SupplyLane.materialCategory` / `SupplyInput.name` (e.g., `"steel"`, `"coil"`, `"rebar"` → `STEEL_PRIMARY_FLAT_BAR`; `"pcb"`, `"semiconductor"`, `"sensor"` → `PCB_SEMICONDUCTOR_ELECTRONICS`).
4. `SECTOR_FALLBACK`: Broad `Facility.sector` (`Metals`, `Electronics`, `Chemicals`, `Packaging`, `Logistics`, `Manufacturing`).

### 3.3 Privacy-Safe Partner Emission Intensity Scoping (Closing Edge Case #3)

Inside [`apps/api/src/analytics/partner-resolver.ts`](../../apps/api/src/analytics/partner-resolver.ts):
- Let $R_{\text{org}, B}$ be `partnerOrg.annualRevenueEur` (falling back to the sum of `partnerNetwork.products[*].annualRevenueEur` if org-level revenue is unset).
- **Denominator Scope Hygiene:**
  - If `fulfilledByFacilityId` is bound (`isFacilityScoped === true`) **and** that fulfilling facility has an explicit `Facility.annualRevenueEur` $R_{\text{fac}, B} > 0$, compute $I_B = E_{\text{fac}, B} / R_{\text{fac}, B}$.
  - Otherwise, **never** divide single-facility emissions by whole-company revenue. Compute org-wide intensity consistently ($I_B = E_{\text{org}, B} / R_{\text{org}, B}$) when $R_{\text{org}, B} > 0$ and $E_{\text{org}, B} > 0$, attaching `intensityScope: "ORG_WIDE_FALLBACK"`.
  - If $R_{\text{org}, B} \le 0$ or missing, omit `supplierEmissionIntensityTco2ePerEur` (`null`) so `@kulgo/engine` falls cleanly through to `PHYSICAL_FACTOR` or `SPEND_EEIO`.
- **Zero Revenue Leakage:** Round $I_B$ to 6 decimal places (`tCO2e / EUR`), never serialize `partnerAnnualRevenueEur` or `partnerTotalTco2e` in any public DTO, and format `formulaTrace` strictly as `€{activeSpendEur} × {intensity} tCO2e/EUR (verified partner intensity)`.

### 3.4 Scope 3 Category 4 — Upstream Freight (UK DESNZ 2026 + ADEME, ISO 14083 Methodology)

| `TransportMode` / Sub-Mode | TTW (`kg/tkm`) | WTT (`kg/tkm`) | **WTW (`kg/tkm`)** | Haversine Circuity Uplift | Optional Hub (`kg/t`) | Citation |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `SEA` (Container avg) | `0.0128` | `0.0033` | **`0.0161`** (`0.016` compat) | `× 1.15` | `+2.40` | UK DESNZ 2026 (`OGL v3.0`) |
| `SEA_RORO_BALTIC_FERRY` | `0.0485` | `0.0125` | **`0.0610`** | `× 1.10` | `+1.20` | UK DESNZ 2026 (`OGL v3.0`) |
| `RAIL` (Default mixed) | `0.0182` | `0.0068` | **`0.0250`** | `× 1.25` | `+1.80` | UK DESNZ 2026 / ADEME (`Etalab 2.0`) |
| `RAIL_ELECTRIC_EU` | `0.0000` | `0.0115` | **`0.0115`** | `× 1.25` | `+1.80` | ADEME Base Carbone (`Etalab 2.0`) |
| `ROAD` (HGV avg laden) | `0.0772` | `0.0188` | **`0.0960`** | `× 1.20` | `+0.70` | UK DESNZ 2026 (`OGL v3.0`) |
| `AIR` (Long-haul intl) | `0.4950` | `0.1070` | **`0.6020`** | `+95 km` | `+4.20` | UK DESNZ 2026 (`OGL v3.0`) |
| `MULTIMODAL` (Composite) | `0.0515` | `0.0135` | **`0.0650`** | `× 1.20` | `+3.10` | DESNZ/ADEME weighted composite |

**Backwards-Compatibility Guard (Edge Case #8):** Circuity uplift is applied **only** when `lane.distanceKm` is `null` (auto-derived via Haversine great-circle coordinates). Explicit carrier distances (`lane.distanceKm > 0`) use `circuity = 1.0`. Hub emissions default to opt-in (`includeHubEmissions: false`) so existing carrier distance unit tests remain exact.

### 3.5 Dual Scope 2 Accounting (Closing Gap #5)

- **Location-Based Scope 2:**
  - When own facilities report `annualElectricityMwh > 0`: $E_{\text{S2, loc}} = \sum_f \text{MWh}_f \times EF_{\text{grid, loc}, c}$ using **EEA** (EU-27), **DESNZ 2026** (UK), **EPA eGRID** (US) operational factors, or **Ember 2026** (`LIFECYCLE_SCREENING`) globally.
  - Otherwise falls back to explicit `organization.scope2Tco2e` (or sum of own facility reported Scope 1+2 split).
- **Market-Based Scope 2:**
  - When own facilities report `annualElectricityMwh > 0`:
    - If `renewableInstrumentsVerified === true`: $E_{\text{S2, mkt}} = \sum_f \text{MWh}_f \times \left(1 - \frac{r_{\text{ren}, f}}{100}\right) \times EF_{\text{residual}, c}$ (using AIB Residual Mix in Europe, grid fallback elsewhere).
    - If `renewableElectricityPct > 0` **without** `renewableInstrumentsVerified === true`, all MWh are evaluated at residual mix for the official reportable Market-Based total, and an `UNSUBSTANTIATED_RENEWABLE_CLAIM` advisory is emitted showing the potential reduction once GOs/RECs/PPAs are verified.
  - When only legacy `organization.scope2Tco2e` is populated (no `annualElectricityMwh` and no `organization.scope2MarketTco2e`), `scope2MarketTco2e` is returned as `null` (never fabricated), prompting the EU/ISSB checklist to request dual Scope 2 inputs.
- **Invariant:** `renewableElectricityPct` **never** modifies Location-Based Scope 2.

### 3.6 Curated `FACTOR_MATRIX_VERSION = "2026.1"` Baseline Tables

#### Core Industrial Archetypes (`PHYSICAL_FACTOR` + `SPEND_EEIO`)

| Archetype (`MaterialArchetype`) | EXIOBASE `pxp` / CN Prefix | Spend `kgCO2e/EUR_2026` (`EE`/`FI`/`SE` · `DE`/`EU27` · `PL` · `CN` · `IN` · `US`) | Physical `tCO2e/t` (`EU` · `DE` · `CN` · `IN` · `SE/NO`) | CBAM / EUDR |
| :--- | :--- | :---: | :---: | :---: |
| `STEEL_PRIMARY_FLAT_BAR` | `p24.a` (`CN 7208–7228`) | `0.82` · `1.18` · `1.54` · `2.45` · `2.72` · `1.09` | `2.21` · `1.95` · `2.73` · `3.15` · `0.62` | CBAM (`IRON_STEEL`) |
| `STEEL_RECYCLED_EAF` | `p24.a` (`CN 7207/7214`) | `0.38` · `0.58` · `0.79` · `1.12` · `1.28` · `0.52` | `0.47` · `0.55` · `0.98` · `1.15` · `0.31` | CBAM (`IRON_STEEL`) |
| `ALUMINUM_PRIMARY_INGOT_SHEET` | `p24.d` (`CN 7601–7608`) | `0.74` · `1.35` · `1.88` · `2.95` · `3.40` · `1.29` | `6.75` · `6.83` · `14.80` · `16.40` · `1.85` | CBAM (`ALUMINUM`) |
| `ALUMINUM_RECYCLED_SECONDARY` | `p24.d` (`CN 7601 20`) | `0.29` · `0.45` · `0.61` · `0.88` · `0.95` · `0.42` | `0.52` · `0.58` · `0.85` · `0.92` · `0.38` | CBAM (`ALUMINUM`) |
| `COPPER_BRASS_SEMI` | `p24.e` (`CN 7407–7413`) | `0.48` · `0.72` · `0.84` · `1.42` · `1.58` · `0.68` | `3.81` · `2.85` · `4.95` · `5.20` · `1.90` | — |
| `FABRICATED_CNC_METAL_PARTS` | `p25` (`CN 7318/7326`) | `0.41` · `0.56` · `0.74` · `1.38` · `1.55` · `0.54` | `2.65` · `2.40` · `3.35` · `3.70` · `1.15` | CBAM (`IRON_STEEL` if CN 73xx) |
| `PCB_SEMICONDUCTOR_ELECTRONICS` | `p32` (`CN 8534/8542`) | `0.22` · `0.31` · `0.42` · `0.78` · `0.84` · `0.28` | `24.50` · `19.80` · `28.40` · `30.20` · `16.40` | — |
| `ELECTRICAL_DRIVES_MOTORS_BATTERIES` | `p31` (`CN 8501/8504`) | `0.29` · `0.41` · `0.55` · `0.96` · `1.08` · `0.38` | `4.85` · `4.20` · `6.40` · `6.90` · `3.25` | — |
| `CHEMICALS_SOLVENTS_INORGANIC` | `p24.g` (`CN 28/29`) | `0.64` · `0.94` · `1.28` · `2.12` · `2.35` · `0.98` | `1.85` · `1.72` · `2.68` · `2.85` · `1.20` | Conditional CBAM (`HYDROGEN`/`FERTILIZERS`) |
| `PLASTICS_POLYMERS_RESINS` | `p25.a` (`CN 3901–3926`) | `0.46` · `0.68` · `0.89` · `1.54` · `1.71` · `0.72` | `2.42` · `2.30` · `3.15` · `3.35` · `1.95` | — |
| `PACKAGING_CARDBOARD_PAPER` | `p21.2` (`CN 4819`) | `0.28` · `0.46` · `0.62` · `1.15` · `1.28` · `0.49` | `0.82` · `0.78` · `1.25` · `1.38` · `0.64` | — |
| `PACKAGING_WOOD_PALLETS` | `p20` (`CN 4415`) | `0.21` · `0.32` · `0.41` · `0.74` · `0.82` · `0.34` | `0.31` · `0.31` · `0.48` · `0.52` · `0.24` | EUDR (`WOOD_TIMBER`) |

#### Country Electricity Grid Intensities (`tCO2e / MWh`)

| Country | Location-Based (`tCO2e/MWh`) | Basis | Market Residual Mix (`tCO2e/MWh`) | Baseline Renewable % |
| :---: | :---: | :--- | :---: | :---: |
| `EE` | `0.312` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.518` (AIB) | `51.4%` |
| `LV` | `0.145` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.412` (AIB) | `72.8%` |
| `LT` | `0.158` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.445` (AIB) | `76.2%` |
| `FI` | `0.042` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.315` (AIB) | `56.5%` |
| `SE` | `0.018` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.072` (AIB) | `69.8%` |
| `NO` | `0.016` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.468` (AIB) | `98.4%` |
| `DK` | `0.105` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.452` (AIB) | `86.4%` |
| `DE` | `0.338` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.562` (AIB) | `59.2%` |
| `PL` | `0.595` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.748` (AIB) | `29.6%` |
| `FR` | `0.044` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.088` (AIB) | `28.4%` |
| `NL` | `0.248` | `OPERATIONAL_GENERATION` (EEA/Ember) | `0.468` (AIB) | `54.1%` |
| `EU27` | `0.215` | `OPERATIONAL_GENERATION` (EEA) | `0.435` (AIB) | `49.5%` |
| `GB` | `0.131` | `OPERATIONAL_GENERATION` (DESNZ 2026) | `0.310` | `51.8%` |
| `US` | `0.354` | `OPERATIONAL_GENERATION` (EPA eGRID) | `0.382` | `24.2%` |
| `CN` | `0.536` | `LIFECYCLE_SCREENING` (Ember 2026) | `0.555` | `35.8%` |
| `TW` | `0.528` | `LIFECYCLE_SCREENING` (Ember 2026) | `0.542` | `11.6%` |
| `IN` | `0.708` | `LIFECYCLE_SCREENING` (Ember 2026) | `0.725` | `22.4%` |
| `ZA` | `0.795` | `LIFECYCLE_SCREENING` (Ember 2026) | `0.815` | `13.2%` |
| `ROW` | `0.432` | `LIFECYCLE_SCREENING` (Ember 2026) | `0.465` | `32.5%` |

---

## Part 4 — Worked Numerical Fixture (Estonia Manufacturer — *Tallinn Precision Drives OÜ*)

- **Organization:** `countryCode: "EE"`, `annualRevenueEur: 8_000_000`, `targetMarkets: ["EU", "UK"]`, own facility electricity `1,000 MWh/yr` (`30%` verified GOs → Location Scope 2 = `312.00 tCO2e`, Market Scope 2 = `700 × 0.518 = 362.60 tCO2e`).
- **Active Lanes:**
  1. **Lane 1A (`DE` Steel, `CN 7225`, `400 t`, `€480,000`, `1,450 km` ROAD):**
     - Spend EEIO (`PCAF 4`): `480,000 × 1.18 / 1000` = **`566.40 tCO2e`**
     - Physical JRC CBAM (`PCAF 3`): `400 × 1.95` = **`780.00 tCO2e`**
     - Verified Partner Assured EPD (`PCAF 1`): `400 × 1.12` = **`448.00 tCO2e`**
     - Cat 4 Freight (`PCAF 3`): `400 × 1,450 × 0.096 / 1000` = **`55.68 tCO2e`**
  2. **Lane 1B (`CN` Steel, `CN 7225`, `200 t`, `€150,000`, `19,500 km` SEA):**
     - Spend EEIO (`PCAF 4`): `150,000 × 2.45 / 1000` = **`367.50 tCO2e`** *(understates true carbon due to low €750/t unit price!)*
     - Physical JRC CBAM (`PCAF 3`): `200 × 2.73` = **`546.00 tCO2e`** *(flags EU CBAM: `200 t >= 50 t` cumulative non-EU threshold!)*
     - Cat 4 Freight (`PCAF 3`): `200 × 19,500 × 0.016 / 1000` = **`62.40 tCO2e`**
  3. **Lane 2A (`CN` PCBs, `CN 8534`, `100,000 UNITS`, `€1,200,000`):**
     - Spend EEIO (`PCAF 4`): `1,200,000 × 0.78 / 1000` = **`936.00 tCO2e`**
     - Verified Partner Server-Side Intensity (`PCAF 2`, partner `18,500 tCO2e / €37,000,000 = 0.00050 tCO2e/EUR`, revenue hidden): `1,200,000 × 0.00050` = **`600.00 tCO2e`**
- **Weighted PCAF Progression (Cat 1):**
  - Spend-only baseline: `1,869.90 tCO2e` · **Weighted PCAF = `4.00`**
  - Physical-first (mass on steel, spend on PCBs): `2,262.00 tCO2e` · **Weighted PCAF = `3.41`**
  - With verified partners on Lane 1A + 2A: `1,594.00 tCO2e` · **Weighted PCAF = `2.06`** $\left(\frac{448(1) + 546(3) + 600(2)}{1594}\right)$

---

## Part 5 — Pluggable Multi-Region Compliance Packs (2026 Regulatory Alignment)

Every compliance pack carries `id`, `version`, `legalStatus` (`IN_FORCE` | `FUTURE` | `LITIGATED`), `effectiveFrom`, and deterministic checklist rules returning `PASSED` | `ACTION_NEEDED` | `NOT_APPLICABLE`.

| Pack ID | Auto-Activation | Legal Status (Nov 2026) | Frameworks & Launch Rules |
| :--- | :--- | :---: | :--- |
| **`GLOBAL_GHG_ISSB`** | Always active | `IN_FORCE` | **GHG Protocol + ISSB IFRS S1/S2:** Scope 1+2 completeness (`ISSB_S2_SCOPE12_REPORTED`), zero 100%-entity over-attribution (`GHG_SCOPE3_ZERO_OVERATTRIBUTION`), Weighted PCAF $\le 3.5$ (`PCAF_DATA_QUALITY_THRESHOLD`), carbon intensity denominator (`ISSB_S2_CARBON_INTENSITY`). |
| **`EU`** | `hq ∈ EU27/EEA` or `"EU" ∈ targetMarkets` | `IN_FORCE` | **CSRD/ESRS E1 + Voluntary SME (VSME / Reg. 2026/1560) + EU CBAM + EUDR:**<br/>• Note Directive 2026/470 raised mandatory CSRD to `>1,000 FTE & >€450M`; 50–500 SMEs are guided via VSME value-chain readiness.<br/>• `ESRS_E1_6_DUAL_SCOPE2`: Both Location-Based & Market-Based Scope 2 reported.<br/>• `ESRS_E1_6_PRIMARY_DATA_SHARE`: Reports `% of Scope 3 Cat 1` from PCAF 1–2 primary partner data.<br/>• `EU_CBAM_EMBEDDED_EMISSIONS`: Scans non-EU/EEA imports in CBAM categories; applies **50 t/yr cumulative mass threshold** (Reg. 2025/2083, excluding Electricity & Hydrogen which have no threshold); returns `NOT_APPLICABLE` if below threshold, `ACTION_NEEDED` if default values are used instead of verified actuals.<br/>• `EU_EUDR_GEOLOCATION_TRACEABILITY`: Checks site-verified coordinates for EUDR commodities (wood pallets, rubber, etc.; effective 30 Dec 2026 / 30 Jun 2027). |
| **`UK`** | `hq === "GB"` or `"UK" ∈ targetMarkets` | `IN_FORCE` | **UK SRS S1/S2 + SECR + UK CBAM (2027):** SECR intensity ratio (`UK_SECR_INTENSITY_RATIO`), UK SRS Scope 3 traceability (`UK_SRS_SCOPE3_DISCLOSURE`), UK CBAM 2027 readiness (`UK_CBAM_2027_READINESS`, `FUTURE`). |
| **`US`** | `hq === "US"` or `"US" ∈ targetMarkets` | `LITIGATED` *(Scope 3)* | **California SB 253** (Scope 1/2 in force; Scope 3 marked `LITIGATED` per 9 Nov 2026 Ninth Circuit remand) + **UFLPA** origin screening (`US_CA_SB253_SCOPE3_AUDIT_TRAIL`, `US_UFLPA_ORIGIN_SCREENING`). |
| **`APAC`** | `hq ∈ APAC` or `"APAC" ∈ targetMarkets` | `IN_FORCE` | **Australia AASB S2 / Singapore ACRA-SGX / Japan SSBJ:** ISSB-aligned Scope 1/2/3 hotspot & data-quality disclosure (`APAC_ISSB_SCOPE3_HOTSPOTS`). |
| **`AFRICA`** | `hq ∈ AFRICA` or `"AFRICA" ∈ targetMarkets` | `IN_FORCE` | **Nigeria FRC / Kenya ICPAK / South Africa JSE ISSB + EU CBAM Exporter Readiness:** Core ISSB inventory (`AFRICA_ISSB_CORE`) + high-grid-intensity CBAM exporter alert (`AFRICA_CBAM_EXPORTER_READINESS`). |

---

## Part 6 — Primary Sources, Direct Downloads & License URLs

1. **ADEME Base Carbone / Base Empreinte:** https://www.data.gouv.fr/datasets/base-carbone-r-2 · https://data.ademe.fr/datasets/base-carboner · License: https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf (*Etalab Open Licence v2.0*).
2. **UK DESNZ 2026 GHG Conversion Factors:** https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026 · License: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/ (*OGL v3.0*).
3. **EU JRC CBAM Default Emission Intensities (`JRC134682` & Definitive Regime):** https://publications.jrc.ec.europa.eu/repository/handle/JRC134682 · https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-definitive-regime_en · Reg. `(EU) 2025/2083`: https://eur-lex.europa.eu/eli/reg/2025/2083/oj/eng · License: EU CC-BY 4.0.
4. **EXIOBASE v3.8.2 (`pxp` & `ixi` — Pinned Commercial-Safe Release):** https://zenodo.org/records/5589597 (`IOT_2019_pxp.zip`, `IOT_2022_pxp.zip`) · License: https://creativecommons.org/licenses/by-sa/4.0/legalcode.en (*CC-BY-SA 4.0*; v3.9+ prohibited).
5. **US EPA Supply Chain GHG Emission Factors v1.3 (USEEIO):** https://catalog.data.gov/dataset/supply-chain-greenhouse-gas-emission-factors-v1-3-by-naics-6 · https://github.com/USEPA/supply-chain-factors · License: https://creativecommons.org/publicdomain/zero/1.0/ (*CC0 1.0*).
6. **Swiss FOEN BAFU:2026 v1 (Approved Expansion):** https://api.data-platform.cloud.bafu.admin.ch/en/dataproduct-economy-consumption-lca · License: https://api.data-platform.cloud.bafu.admin.ch/en/lizenz-und-quelle.
7. **EEA Electricity Generation Intensity:** https://www.eea.europa.eu/en/analysis/indicators/greenhouse-gas-emission-intensity-of-1 · License: CC-BY 4.0.
8. **Ember Yearly Electricity Data (2026):** https://ember-energy.org/data/yearly-electricity-data/ · License: https://creativecommons.org/licenses/by/4.0/ (*CC-BY 4.0*).
9. **AIB European Residual Mix (2025/2026):** https://www.aib-net.org/facts/european-residual-mix/2025.
10. **US EPA eGRID:** https://www.epa.gov/egrid/detailed-data (*CC0 / US Federal Reuse*).
11. **Regulatory & Standards References:** GHG Protocol (https://ghgprotocol.org/), ISSB IFRS S1/S2 (https://www.ifrs.org/issued-standards/), EU Directive 2026/470 & VSME 2026/1560 (https://eur-lex.europa.eu/eli/dir/2026/470/oj/eng), EUDR (https://eur-lex.europa.eu/eli/reg/2025/2650/oj/eng), WBCSD PACT V3 (https://github.com/wbcsd/data-exchange-protocol), PCAF Global Standard (https://carbonaccountingfinancials.com/en/standard), `pymrio` (https://github.com/IndEcol/pymrio).
