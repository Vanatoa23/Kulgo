# Quantitative Supply Chain Financial Risk Methodology & Benchmark Calibration (Phase 0)

> **Status:** Unified Phase 0 Specification for [Issue #8](https://github.com/Vanatoa23/Kulgo/issues/8) (`SUBPROJECT_2_FINANCIAL_RISK.md`)  
> **Target Segment:** EU / Nordic-Baltic Mid-Market Manufacturers (50–500 employees)  
> **Target Packages:** `@kulgo/engine` (pure, deterministic, zero-I/O TypeScript) & `@kulgo/shared` (`.strict()` Zod DTOs)  
> **Architectural & Privacy Compliance:** [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [`docs/PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md), [`docs/DECISIONS.md`](../DECISIONS.md) (ADR-004 through ADR-007)  
> **Benchmark Version:** `financial-risk-2026-11-21.v1`

---

## Executive Overview & Non-Negotiable Invariants

This specification defines the baseline parameter tables, mathematical equations, progressive data-tier degradation rules (**Level 0 → Level 1 → Level 2**), privacy-preserving Tier-2+ risk propagation, worked numerical fixtures, and edge-case guarantees for Kulgo's financial risk and contract-derivation engine.

1. **Zero I/O & Determinism (`@kulgo/engine`):** All functions take explicit inputs (`asOfDate`, period window $T$, `fxRatesToEur`, `benchmarkVersion`, and precomputed server-side hidden aggregates). Zero network calls, database queries, clock reads, or `Math.random()`.
2. **Provisional Priors Disclosure (`P`):** Public disruption surveys (Allianz, BCI, Resilinc, UNCTAD, IPC, ASQ, ASCM) publish organization- or industry-level findings—not EU/Nordic-Baltic lane-level distributions. All lane-level probabilities, sector defect rates, and freight multipliers in Part 1 are explicitly versioned **provisional v1 priors (`P`)** designed to be superseded by customer overrides or recalibrated from incident history.
3. **Decoupled Topology vs. Contracts (ADR-004):** Physical `SUPPLIES_LANE` edges store operational attributes; commercial values (`activeVolume`, `activeSpendEur`, `weightedAvgUnitPrice`, `nextExpirationDate`, `atRiskVolumePct`, `renewalCliff`) are derived on read from `Contract` and `ContractLine` records (`FRAMEWORK`, `SPOT_PO`, or Level-1 implicit `ESTIMATE`).
4. **Denominator Hygiene & Zero Circular Volume Fabrication (ADR-004 / ADR-005):** Weighted average unit prices use strictly the subset $C_{\text{both}}$ of active lines having *both* valid EUR spend and normalized base-unit volume. Never divide a volume-less lane's spend by another supplier's unit price to fabricate volume.
5. **Hard Multi-Tenant Privacy Boundary (`PRIVACY_CONTRACT.md`):** Upstream Tier-2+ risks on a verified Tier-1 partner (`Org B`) collapse server-side in `OrgScopedAnalyticsRepository` into anonymized scalar multipliers + opaque shared event-group keys. Zero Tier-2+ IDs, names, revenues, unit prices, margins, or coordinates ever enter `@kulgo/engine` public DTOs.

---

## Part 1 — Versioned Baseline Tables (Provisional Priors `P`)

### 1.1 Corridor Disruption Incidence ($p_{\text{annual}}$) & Time-to-Recover ($\text{TTR}$)

Annual incidence $p_{\text{annual}} \in [0, 1]$ represents the provisional prior probability of at least one production-impacting supply interruption ($\ge 5$ calendar days beyond contracted lead time) in a 365-day year. Recovery duration is parameterized by **$\text{TTR}_{p50}$ / $\text{TTR}_{p90}$ / $\text{TTR}_{p95}$** in calendar days, with a 4-point discrete severity support `[p50, p90, p95, 1.5 × p95]` and probability masses `[0.50, 0.40, 0.05, 0.05]` so the discrete CDF hits `.50`, `.90`, and `.95` exactly at the labeled quantiles (the 4th point is an explicit stress-tail cap, not an empirical p99).

| Corridor Key (`CorridorBaselineKey`) | Representative Geo / Chokepoints | $p_{\text{annual}}$ (Base `P`) | $\text{TTR}_{p50}$ / $\text{TTR}_{p90}$ / $\text{TTR}_{p95}$ (Days) | Anchor / Empirical Context |
| :--- | :--- | :---: | :---: | :--- |
| `EU_NORDIC_BALTIC_INTRA` | `EE`/`LV`/`LT`/`FI`/`SE`/`DK`/`NO`, `BALTIC_SEA`, `DANISH_STRAITS`, `VIA_BALTICA` | **0.07** | 6 / 16 / 22 | Short-haul reference `P`; BCI 2024 & Eurostat 2024 sense check |
| `WESTERN_CENTRAL_EU_OVERLAND` | `DE`/`PL`/`NL`/`BE`/`FR`/`IT`/`AT`/`CZ`, `RHINE_VALLEY`, Alpine corridors | **0.09** | 7 / 18 / 25 | `P`; BCI 2024 & ITF/Eurostat European overland studies |
| `TRANS_ATLANTIC` | `US`/`CA`/`MX` ↔ North Sea / Baltic hubs | **0.11** | 10 / 25 / 34 | `P`; Sea-Intelligence 2024 & McKinsey GVC context |
| `EASTERN_EUROPE_BALTIC_BORDER` | `EU_EASTERN_BORDER`, eastern PL/LT/LV crossings, sanctions queues | **0.22** | 15 / 38 / 52 | `P`; IRU 2024 border delay observations & Allianz Risk Barometer 2024–2025 |
| `CHINA_EAST_ASIA_SOURCING` | `CN`/`TW`/`KR`/`JP`/`VN` origin + export port/rail congestion | **0.26** | 18 / 45 / 60 | `P`; Resilinc EventWatch 2023–2024 & Allianz 2024 |
| `RED_SEA_SUEZ_ASIA_EU_MARITIME` | `SUEZ_CANAL`, `RED_SEA_BAB_EL_MANDEB`, Cape rerouting, `MALACCA_STRAIT` | **0.28** | 24 / 55 / 72 | `P`; UNCTAD 2024 (10–12d transit rerouting) & IMF/Oxford PortWatch 2024 |

### 1.2 Transport Mode Modifiers (`TransportMode`)

Aligned with Kulgo's existing 5-value `TransportMode` enum (`packages/engine/src/baselines.ts`):

| `TransportMode` | Prob. Multiplier ($\phi_{p, m}$) | TTR Multiplier ($\phi_{\text{TTR}, m}$) | Default Transit Lead-Time Prior | Provisional Freight Share of Landed Cost ($\alpha_{\text{freight}}$) |
| :--- | :---: | :---: | :---: | :---: |
| `SEA` | **1.15** | **1.25** | 35 d | 6.0% (`0.06`) |
| `RAIL` | **1.05** | **1.10** | 18 d | 5.0% (`0.05`) |
| `ROAD` | **0.95** | **0.85** | 3 d | 5.0% (`0.05`) |
| `AIR` | **0.75** | **0.50** | 3 d | 15.0% (`0.15`) |
| `MULTIMODAL` | **1.10** | **1.15** | 14 d | 5.5% (`0.055`) |

### 1.3 Live Risk (`RiskSignal`) & Tier-2+ Probability Scaling

1. **Deriving `liveRiskMultiplier` ($\mu_{\text{live}}$) from Sub-Project 1 `RiskSignal` matches** (when not overridden):
   - Confirmed `RED` signal: $\mu_s = 2.25$ (`2.50` for `SANCTIONS`)
   - Corroborated `YELLOW` signal: $\mu_s = 1.45$
   - Single-source `ALLEGED` signal: $\mu_s = 1.10$
   - Multiple concurrent signals on the same lane combine sub-additively (never multiplied repeatedly):
     $$\mu_{\text{live}} = \min\left(5.00,\; 1 + \sqrt{\sum_{s \in S_{\text{matched}}} (\mu_s - 1)^2}\right)$$
2. **Bounds & Validation:** Validate finite $\mu_{\text{live}} \in [0, 5]$ (default `1`) and anonymized Tier-2+ $\mu_{p, \text{hidden}} \in [1, 2]$ (default `1`). Reject out-of-range inputs at the `@kulgo/shared` boundary.
3. **Hazard / Survival Scaling & Horizon Pro-Ration:**
   For base prior $p_{\text{base}} \in [0, 0.95]$ (or user-confirmed `pAnnual = 1` marked `CERTAIN_EVENT`):
   $$\lambda_{\text{eff}} = -\ln(1 - p_{\text{base}}) \times \phi_{p, m} \times \mu_{\text{live}} \times \mu_{p, \text{hidden}}$$
   $$p' = \text{clamp}\left(1 - e^{-\lambda_{\text{eff}}},\; 0,\; 0.95\right), \qquad p(D) = 1 - (1 - p')^{D / 365}$$
   where $D = \text{days}(T) > 0$ (`D = 0` yields `0`; explicit `CERTAIN_EVENT` preserves `1`).

### 1.4 Sector Defect Rates, Emergency Freight, Switching & Carrying Cost (`P`)

- **Sector Defect / Scrap Rates (`defectRatePct`, irreparable unusable units / received units):**
  - `Electronics`: `0.5% / 2.0% / 5.0%` (IPC / ASQ anchor; rework ≠ scrap)
  - `Metals`: `0.5% / 1.5% / 4.0%`
  - `Chemicals`: `0.2% / 1.0% / 3.0%`
  - `Packaging`: `0.5% / 2.0% / 5.0%`
  - `General Manufacturing`: `0.5% / 2.0% / 5.0%`
- **Emergency Mode-Shift Freight Multipliers (`newFreight / ordinaryFreight`, Low / Base / High):**
  - `SEA → AIR`: `4.0x / 8.5x / 12.0x` | `SEA → RAIL`: `1.5x / 2.6x / 4.0x`
  - `RAIL → ROAD`: `1.2x / 1.9x / 3.0x` | `ROAD → AIR`: `3.0x / 4.8x / 10.0x`
  - `MULTIMODAL → AIR`: `4.0x / 6.5x / 10.5x`
- **Supplier Switching Priors (Lead-time penalty days / One-time qualification € / Spot premium %):**
  - `WARM_SECONDARY` (active dual-source lane): `2–4–7 d` / `€250–€750–€2,000` / `+3% / +6% / +12%`
  - `PREQUALIFIED` (vetted/directory): `7–14–30 d` / `€500–€2,000–€8,000` / `+8% / +14% / +25%`
  - `UNQUALIFIED` (cold custom/build-to-print): `30–60–120 d` / `€2,000–€9,500–€40,000` / `+12% / +20% / +35%`
- **SME Inventory Carrying Cost (`carryingCostPct`, % of landed inventory value / yr):**
  - **Low: `10%` | Base Default: `20%` | High: `35%`** (matches ASCM 2024 10–35% aggregate range; provisional 4-component split at Base: SME WACC `8%` + Warehousing/Handling `6%` + Insurance/Taxes `2%` + Obsolescence/Shrinkage `4%`).

---

## Part 2 — Deterministic Mathematical Specification

All dates are ISO `YYYY-MM-DD` interpreted as UTC civil days. Intervals are half-open **`[start, endExclusive)`**; inclusive UI `endDate` converts to `endExclusive = endDate + 1 calendar day`. Default window $T$ is `[asOfDate, asOfDate + 12 calendar months)`. Fixed `365`-day annualization is used for `PER_YEAR` daily rates. `null` means unavailable—never `0`. Never round internally; round only at API/UI presentation.

### 2.0 Progressive Data Tiers & Orthogonal Badging

Keep financial provenance **orthogonal** to network verification:
- `confidenceBadge ∈ { "CONTRACTED", "IMPORTED", "HYBRID", "ESTIMATED" }`
- `networkVerified: boolean` (true when a Tier-1 partner is linked via `VERIFIED_PARTNER_LINK`; a verified partner does **not** turn provisional financial priors into verified financial losses—both `networkVerified: true` and `confidenceBadge: "HYBRID"` may be emitted simultaneously).

| Data Tier | Available Inputs | Monetary EAL / VaR Output | Confidence Badge |
| :--- | :--- | :--- | :--- |
| **Level 0 (Minimal)** | Topology only (names, locations, modes, declared shares) | `lowEur / baseEur / highEur / varP90Eur / varP95Eur = null` (never invented from company name). Structural HHI, SPOF, corridor alerts & TTS–TTR prior gaps still render with an actionable prompt. | `ESTIMATED` (euro badge absent) |
| **Level 1 (Commercial)** | Quick 2-field `ESTIMATE` or contracts with `activeSpendEur` / `activeVolume`; product revenue/margin absent | Uses clearly labeled provisional spend-to-margin proxy (`ESTIMATED_PROXY_EUR`): `M = annualSpend × [1.0, 2.5, 4.0]` (Low/Base/High) and prior `TTS = 7d` (Low/High sensitivity `14d / 0d`). | `ESTIMATED` or `HYBRID` |
| **Level 2 (Operational)** | Signed `FRAMEWORK`/`SPOT_PO` contracts + `Product.annualRevenueEur` & `grossMarginPct` + `safetyStockDays` / `defectRatePct` / `carryingCostPct` | Full deterministic EAL, portfolio quantile VaR, exact gross-margin gap loss, defect gross-up buffer, and working-capital ROI/payback. | `HYBRID` (contracted commercials + prior p/TTR) or `CONTRACTED` on pure commercial summaries |

### 2.1 Contract Commercial Derivation, Lifecycle & Renewal Cliffs

1. **Unit & FX Conversion:**
   - Convert line quantity $q_c$ to `SupplyInput.baseUnit` via SI within `unitFamily` or explicit `unitConversionFactors[unit] > 0`. Missing conversion returns `null` + `UNIT_CONFLICT` (never silently add incompatible families).
   - Convert native spend $s_c$ via explicit `fxRatesToEur[currency] > 0` (`EUR = 1`). Missing FX returns `null` + `missingFxCurrencies` (never assume 1:1 EUR parity).
   - If both `committedSpend` and `unitPrice × committedVolume` are supplied and disagree by `> €0.01` after FX, reject with `AMOUNT_CONFLICT`.
2. **Double-Counting Guardrail:** Adding a non-archived `FRAMEWORK` or `SPOT_PO` line archives any implicit `ESTIMATE` line on the same lane (`ARCHIVED_BY_FRAMEWORK`) effective at the framework start date while preserving history.
3. **Daily Rates & Dual Views:**
   For line $c$ with finite term duration $D_c = \text{days}([\text{start}, \text{endExclusive})) > 0$ (`TOTAL_OVER_TERM` requires a finite positive term):
   $$r_q(c) = \begin{cases} q_c / 365 & \text{PER\_YEAR} \\ q_c / D_c & \text{TOTAL\_OVER\_TERM} \end{cases}, \qquad r_s(c) = \begin{cases} s_c / 365 & \text{PER\_YEAR} \\ s_c / D_c & \text{TOTAL\_OVER\_TERM} \end{cases}$$
   - **Current Run-Rate (`asOfDate`):** $365 \times \sum_{\text{active at } a} r_q(c)$ and $365 \times \sum_{\text{active at } a} r_s(c)$.
   - **Period Window $T$:** Split at contract boundaries and sum $r_q(c) \times O_c(T)$ and $r_s(c) \times O_c(T)$ where $O_c(T) = \text{days}([\text{start}, \text{endExclusive}) \cap T)$.
4. **Denominator-Hygienic Weighted Average Unit Price ($C_{\text{both}}$):**
   Let $C_{\text{both}}(T)$ be active lines with *both* $Q_c(T) > 0$ and known $S_c(T) \ge 0$:
   $$\bar{P}(T) = \frac{\sum_{c \in C_{\text{both}}(T)} S_c(T)}{\sum_{c \in C_{\text{both}}(T)} Q_c(T)}, \qquad \text{ActiveSpendEur}(T) = \sum_{c:\, S_c \text{ known}} S_c(T)$$
   Spend-only lines remain in `ActiveSpendEur(T)` (flagged in `spendOnlyExcludedEur`) without inflating $\bar{P}(T)$. Never infer physical volume from another supplier's $\bar{P}$.
5. **Expiry Lifecycles:**
   - `HOLDOVER` (default for `FRAMEWORK`): After `endDate`, continues at its prior daily rate as `EXPIRED_ASSUMED_HOLDOVER` (rendered amber/dashed) until explicitly renewed or archived.
   - `AUTO_RENEW`: Extends consecutively until cancelled; alert shifts to `cycleEndExclusive - noticePeriodDays`.
   - `AUTO_ARCHIVE` (default for `SPOT_PO`): Drops to `0` after `endDate`, never deleted from history.
   - **Lapsed Lane:** When all contracts on a physical lane expire (`ActiveVolume = 0`, `ActiveSpendEur = 0`), the lane stays visible as `LAPSED_UNCONTRACTED` (amber).
6. **Uncontracted / Spot Exposure ("Ghost Lane"):**
   When `SupplyInput.totalAnnualDemand > 0` and every active lane has compatible volume:
   $$\text{uncontractedDemand}(T) = \max\left(0,\; \text{totalAnnualDemand} \times \frac{\text{days}(T)}{365} - \sum_{\ell \in L_m} \text{ActiveVolume}_\ell(T)\right)$$
   If positive, introduce a virtual `SPOT_UNCONTRACTED` event with share $\frac{\text{uncontractedDemand}(T)}{\text{demand}(T)}$, spot probability multiplier $\mu_{p,\text{spot}} = 1.35$, and $+7\text{ d}$ cold-sourcing TTR penalty. If any active lane lacks compatible volume, return `uncontractedDemand: null` with `VOLUME_INCOMPLETE` and a separate lower bound.
7. **Renewal Cliff (`> 30%` Expiring in 90 Days):**
   At `asOfDate`, sum run-rate volume on lines terminating within `(asOfDate, asOfDate + 90d]` (`AUTO_ARCHIVE`, confirmed `AUTO_RENEW` cancellation, or `EXPIRED_ASSUMED_HOLDOVER`). If `atRiskVolumePct > 30.0` (strictly greater than 30%), set `renewalCliff = true` and apply:
   $$\text{effectiveTTR}_j = \max\left(\text{baseTTR}_j \times \phi_{\text{TTR}, m} \times \mu_{\text{TTR, hidden}},\; \Delta\text{TTR}_{\text{switch}} \times \frac{\text{atRiskVolumePct}}{100}\right)$$
   *(Uncommitted `AUTO_RENEW` notice deadlines within 90d emit a separate `NOTICE_AT_RISK` alert without inflating base TTR.)*

### 2.2 Partial-Coverage HHI (ADR-005)

- **Per-Material (`dimension: "MATERIAL"`):** `VOLUME_BASE_UNIT` (when $\ge 1$ lane has compatible normalized volume and zero unit conflicts) → `SPEND_EUR` → `VOLUME_SHARE_PCT`.
- **Org-Wide (`dimension: "SUPPLIER" | "COUNTRY"`):** `SPEND_EUR` → `MASS_KG` (only if all covered lanes share mass units) → `VOLUME_SHARE_PCT`.
- Compute conditional HHI over strictly positive covered weights aggregated by supplier/country key, and always emit `{ coveredLanesCount, totalActiveLanesCount, coveragePct, weightingBasis }`. When `totalActiveLanesCount === 0` or `coveredLanesCount === 0`, return `rawHhi: null` (or `0` with `coveragePct: 0` and `NO_USABLE_WEIGHTS` flag where backwards-compatible with [`hhi.ts`](file:///home/antigravity/Vanatoa23/Kulgo/packages/engine/src/hhi.ts)). When known positive ghost demand exists, include an `UNCONTRACTED` bucket and flag `ESTIMATED_UPPER_BOUND_FOR_GHOST`.

### 2.3 TTS vs. TTR, Competing-Event EAL & True Quantile VaR

1. **TTS & Unprotected Gap Days:**
   - `TTS` = measured `safetyStockDays` (or `inventoryUsableUnits / dailyDemand`), else Level-1 prior `7d`.
   - `gapDays_j = min(days(T), max(0, effectiveTTR_j - TTS))`.
2. **Warm-Backup Mitigation ($\gamma_{\text{unmitigated}}$):**
   When material $m$ has active non-corridor-correlated backup lanes holding share $1 - s_\ell$ with assumed surge slack $\theta_{\text{slack}} = 0.25$:
   $$\gamma_{\text{unmitigated}, \ell} = \text{clamp}\left(1 - \frac{0.25 \times (1 - s_\ell)}{\max(0.01, s_\ell)},\; 0.20,\; 1.00\right)$$
   *(100% single-source SPOF has $s_\ell = 1 \implies \gamma_{\text{unmitigated}} = 1.00$.)*
3. **Conditional Event Loss ($L_{e, j}$):**
   For event group $e$ (deduplicating lanes that share the same corridor chokepoint, country shock, or opaque Tier-2+ `eventGroupId` so product margin is never double-counted) and TTR support point $j \in \{0, 1, 2, 3\}$:
   $$L_{e, p, j} = \min\left(\text{HorizonMargin}_p,\; \frac{R_p \cdot (M_{p,\%}/100)}{365} \cdot \text{gapDays}_{e, j} \cdot s_{e, p} \cdot \gamma_{\text{unmitigated}, e}\right) + \text{MitigationCost}_{e, j}$$
   where $\text{MitigationCost}_{e, j}$ uses explicit freight quotes ($q \cdot f \cdot (m - 1) + q \Delta c + K$) when supplied, or falls back to the clearly labeled provisional $\alpha_{\text{freight}} \cdot (m - 1)$ / switching blend when freight quotes are absent.
4. **Competing-First-Event Portfolio Aggregation (EAL & Quantile VaR):**
   Convert each distinct event group's horizon probability $p_e(D)$ to hazard $\lambda_e = -\ln(1 - p_e(D))$, $\Lambda = \sum_e \lambda_e$, $P(\text{any}) = 1 - e^{-\Lambda}$, and event weights $\pi_e = P(\text{any}) \cdot \lambda_e / \Lambda$ ($\Lambda = 0 \implies \pi_e = 0$).
   The portfolio loss distribution $X$ has mass $1 - \sum_e \pi_e$ at `€0` and mass $\pi_e \cdot w_j$ ($w = [0.50, 0.40, 0.05, 0.05]$) at $L_{e, j}$:
   $$\text{EAL}_{\text{base}}(T) = \sum_e \pi_e \sum_{j=0}^{3} w_j L_{e, j}, \qquad \text{VaR}_\alpha(X) = \min\{x : \Pr(X \le x) \ge \alpha\}, \quad \alpha \in \{0.90, 0.95\}$$
   - **Additive EAL, Non-Additive VaR:** Portfolio VaR is always computed from the sorted portfolio distribution (never the sum of lane VaRs). If $1 - \sum \pi_e \ge 0.95$, `VaR_p95 = €0` is valid; also expose `conditionalTailLossP90Eur` (worst-case severity given an event occurs) so users see tail severity even when annual frequency is low.
   - **Sensitivity Range (`lowEur` / `baseEur` / `highEur`):**
     - `lowEur`: $p \times 0.75$, `TTS + 7d`, TTR $p50$ support (at Level 1, also proxy $\times 1.0/2.5$).
     - `highEur`: $\min(0.95, p \times 1.25)$, `max(0, TTS - 7d)`, stress-tail support $1.5 \times p95$ (at Level 1, proxy $\times 4.0/2.5$).
5. **Privacy-Safe Tier-2+ Inputs (`OrgScopedAnalyticsRepository`):**
   Server-side traversal (`MAX_TRAVERSAL_DEPTH = 4`, `visitedOrgIds`, two-sided `fulfilledByFacilityId` or conservative fallback per ADR-007) passes **only** `{ eventGroupId, hiddenProbabilityMultiplier ∈ [1, 2], hiddenTtrMultiplier ∈ [1, 2], verified: boolean }` per buyer-visible Tier-1 lane. The public `.strict()` DTO strips `eventGroupId` and raw hidden multipliers, exposing only aggregate losses and `networkVerified: boolean`.

### 2.4 Defect / Faulty-Unit Gross-Up Buffer

For usable target $n > 0$ and scrap fraction $d = \text{clamp}(\text{defectRatePct} / 100, 0, 0.95)$:
$$\text{recommendedOrderBufferPct} = \frac{d}{1 - d} \times 100, \qquad \text{recommendedBufferUnits} = \left\lceil \frac{n}{1 - d} \right\rceil - n$$
*(Exact gross-up $\frac{1}{1-d}$ ensures $Q_{\text{gross}}(1 - d) \ge n$, avoiding the $n \cdot d^2$ shortfall of naive $1 + d$.)*

### 2.5 Working Capital & Carrying Cost Trade-Off (What-If ROI)

For incremental safety stock $+\Delta B$ calendar days at landed daily spend $\dot{s}$ (or $b$ units at landed cost $c$) and carrying cost rate $h = \text{carryingCostPct} / 100$:
$$\Delta\text{WorkingCapitalEur} = \dot{s} \cdot \Delta B, \qquad \Delta\text{CarryingCostEur/yr} = \Delta\text{WorkingCapitalEur} \cdot h$$
$$\text{netAnnualBenefitEur} = \text{ealReductionEur} - \Delta\text{CarryingCostEur} - \text{otherRecurringCostEur}$$
$$\text{workingCapitalRoiPct} = \frac{\text{netAnnualBenefitEur}}{\text{incrementalInvestmentEur}} \times 100, \qquad \text{paybackYears} = \frac{\text{incrementalInvestmentEur}}{\text{netAnnualBenefitEur}}$$
where $\text{incrementalInvestmentEur} = \Delta\text{WorkingCapitalEur} + K_{\text{oneTime}}$. Return `null` (`NO_POSITIVE_PAYBACK`) if $\text{incrementalInvestmentEur} \le 0$ or $\text{netAnnualBenefitEur} \le 0$. Candidate buffers $\Delta B \in \{0, 7, 14, 21, 28\}$ days are compared against the baseline to recommend the `recommendedSafetyStockDays` maximizing `netAnnualBenefitEur`.

---

## Part 3 — Verified Numerical Acceptance Fixtures & Edge Cases

### 3.1 Fixture A — Contract Pro-Ration & Denominator Hygiene ($C_{\text{both}}$)

- **Setup:** `asOfDate = 2026-09-01`, Calendar Window $T = [\text{2026-01-01}, \text{2027-01-01})$ (`365` days).
  - **Contract #1:** `FRAMEWORK`, `PER_YEAR`, evergreen, `10 units/yr @ €10/yr`.
  - **Contract #2:** `SPOT_PO`, `TOTAL_OVER_TERM`, `[2026-07-01, 2027-07-01)` (`365` days), `2 units @ €3`. Exact H2 2026 overlap = **`184` days**.
  - **Contract #3 (variant):** `SPOT_PO`, `PER_YEAR`, `2026`, `volume: null`, `€5/yr`.

| Metric | Current Run-Rate (`2026-09-01`) | Calendar Year $T$ (Exact `184/365`) | With Contract #3 (`€5` spend-only) |
| :--- | :---: | :---: | :---: |
| **`ActiveVolume`** | `12.0000 units/yr` | `11.0082 units` *(display `11`)* | Unchanged (`12` / `11.0082`) |
| **`ActiveSpendEur`** | `€13.0000/yr` | `€11.5123` | `€18.0000/yr` / `€16.5123` |
| **`weightedAvgUnitPrice` ($C_{\text{both}}$)** | **`€1.0833/unit`** | **`€1.0458/unit`** | **Preserved** (`€1.0833` / `€1.0458`); `€5` in `spendOnlyExcludedEur` |

### 3.2 Fixture B — Estonia "Product X" (*Tallinn Precision Drives OÜ*)

- **Profile:** Annual revenue `€8,000,000`, gross margin `35%` (`€2,800,000/yr` = `€7,671.23/day`). Critical input: `100,000 UNITS/yr`, `€1,200,000/yr` (`€12/unit`, `€3,287.67/day`), single-sourced from Shenzhen (`CN`) via `SEA` (`RED_SEA_SUEZ_ASIA_EU_MARITIME`, `pBase = 0.28`, `phi_p = 1.15`, `phi_TTR = 1.25`, active live signal `mu_live = 1.35`).
- **Derived Probabilities & TTR Support:** $p_{\text{eff, base}} = 0.3995$ (Low `0.2996`, High `0.4994`); $\text{TTR}$ support = `[30.0, 68.75, 90.0, 135.0]` days.

| Stage / Scenario | Key Inputs | Base EAL (€/yr) | Low – High EAL Band | VaR p90 / p95 | Notes & Badge |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Level 0 (Minimal)** | Topology only (`100%` CN Sea) | `null` | `null` | `null` | `HHI = 10,000` (`SINGLE_SOURCE`), badge `ESTIMATED` |
| **Level 1 (Commercial)** | `€1.2M` spend, no product rev/margin, prior `TTS = 7d` | **`€177,096`** | `€22,471 – €968,581` *(43.1× spread)* | `€592,704` | `ESTIMATED_PROXY_EUR`, prompts for margin & stock |
| **Level 2 (Operational)** | Signed `FRAMEWORK` + `€8M`/35% GM + `TTS = 10d` | **`€156,240`** | `€35,519 – €585,897` *(16.5× spread)* | **`€524,027`** | Spread tightened 2.6×; badge `HYBRID` (prior p/TTR) |
| **What-If 1 (+14d Stock)** | `TTS: 10d → 24d`, `h = 20%`, capital `€46,027`, carry `+€9,205/yr` | **`€106,668`** *(-€49,572)* | — | — | Net benefit `+€40,367/yr` · **WC ROI `87.7%/yr`** · **Payback `13.7 mo`** |
| **What-If 2 (40% FI Road)** | 60% CN Sea + 40% FI Road (`@ €13.20/u`, `+€48k/yr` cost), warm backup | **`€78,686`** *(-€77,554 / -49.6%)* | — | — | `HHI: 10,000 → 5,200` (SPOF eliminated); net `+€29,554/yr` before setup |

### 3.3 Deterministic Edge-Case Matrix (Zero `NaN`, Zero `Infinity`, Zero Silent Drops)

| ID | Condition | Deterministic Engine Guarantee |
| :--- | :--- | :--- |
| **EC-01** | Zero active volume / all `AUTO_ARCHIVE` expired | `weightedAvgUnitPrice: null`, `EAL = 0`, physical lane retained as `LAPSED_UNCONTRACTED` (amber). |
| **EC-02** | Missing product revenue or margin | Level 1 uses labeled `ESTIMATED_PROXY_EUR` from spend; if spend also missing, return `null` (never invent euros). Zero margin = exactly `€0` lost margin (hard costs still possible). |
| **EC-03** | Spend-only line mixed with priced lines | Excluded from $C_{\text{both}}$ unit price; included in `ActiveSpendEur` and `spendOnlyExcludedEur`. |
| **EC-04** | Conflicting units without custom conversion | Flag `UNIT_CONFLICT`; never add incompatible units; fall back to `SPEND_EUR` HHI with coverage metadata. |
| **EC-05** | Custom cross-dimension conversion present | Apply `unitConversionFactors[unit]`; `hasUnitConflict: false`, `weightingBasis: "VOLUME_BASE_UNIT"`. |
| **EC-06** | 100% single-source SPOF | `rawHhi = 10000`, `isSinglePointOfFailure: true`, $\gamma_{\text{unmitigated}} = 1.00$. |
| **EC-07** | `HOLDOVER` / `AUTO_RENEW` / `AUTO_ARCHIVE` past `endDate` | `HOLDOVER` stays active (amber/dashed, counts toward cliff); `AUTO_RENEW` alerts at notice date; `AUTO_ARCHIVE` drops to `0` (history preserved). |
| **EC-08** | Uncontracted demand (`mapped < totalAnnualDemand`) | Virtual `SPOT_UNCONTRACTED` ghost event (`1.35×` prob, `+7d` TTR); if any lane volume missing, `uncontractedDemand: null` + `VOLUME_INCOMPLETE`. |
| **EC-09** | Partial or 0% HHI coverage | 9/10 priced → conditional HHI over 9 lanes (`coveragePct: 90`); 0/N → `coveragePct: 0` + `NO_USABLE_WEIGHTS`. |
| **EC-10** | Invalid defect rate (`>= 100%` or `< 0`) | Rejected by Zod `.strict()`; defensively clamped to `[0, 0.95]` in engine. |
| **EC-11** | Missing FX rate for non-EUR currency | `toEur` returns `null` (never 1:1 EUR parity); volume still counted; currency listed in `missingFxCurrencies`. |

---

## Part 4 — Phase 1 TypeScript Baseline Constants Reference

```ts
export const FINANCIAL_RISK_BENCHMARK_VERSION = "financial-risk-2026-11-21.v1" as const;

export type CorridorBaselineKey =
  | "EU_NORDIC_BALTIC_INTRA"
  | "WESTERN_CENTRAL_EU_OVERLAND"
  | "TRANS_ATLANTIC"
  | "EASTERN_EUROPE_BALTIC_BORDER"
  | "CHINA_EAST_ASIA_SOURCING"
  | "RED_SEA_SUEZ_ASIA_EU_MARITIME";

export const FINANCIAL_RISK_PARAMS_V1 = {
  benchmarkVersion: FINANCIAL_RISK_BENCHMARK_VERSION,
  dayCountBasis: 365,
  defaultWindowCalendarMonths: 12,
  probabilityCap: 0.95,
  liveRiskMultiplierBounds: [0, 5] as const,
  hiddenProbabilityMultiplierBounds: [1, 2] as const,
  hiddenTtrMultiplierBounds: [1, 2] as const,
  ttrSupportMass: [0.5, 0.4, 0.05, 0.05] as const,
  ttrTailCapFactor: 1.5,
  renewalCliff: { thresholdExclusivePct: 30, lookaheadDays: 90 },
  warmBackupSurgeSlack: 0.25,
  level1: { spendToMarginFactor: [1.0, 2.5, 4.0] as const, defaultTtsDays: 7 },
  sensitivity: { pLow: 0.75, pHigh: 1.25, ttsDeltaDays: 7 },
  carryingCostPct: { low: 10, base: 20, high: 35 },
  corridors: {
    EU_NORDIC_BALTIC_INTRA:       { pBase: 0.07, ttrP50: 6,  ttrP90: 16, ttrP95: 22 },
    WESTERN_CENTRAL_EU_OVERLAND:  { pBase: 0.09, ttrP50: 7,  ttrP90: 18, ttrP95: 25 },
    TRANS_ATLANTIC:               { pBase: 0.11, ttrP50: 10, ttrP90: 25, ttrP95: 34 },
    EASTERN_EUROPE_BALTIC_BORDER: { pBase: 0.22, ttrP50: 15, ttrP90: 38, ttrP95: 52 },
    CHINA_EAST_ASIA_SOURCING:     { pBase: 0.26, ttrP50: 18, ttrP90: 45, ttrP95: 60 },
    RED_SEA_SUEZ_ASIA_EU_MARITIME:{ pBase: 0.28, ttrP50: 24, ttrP90: 55, ttrP95: 72 },
  },
  transportModeModifiers: {
    SEA:        { probMultiplier: 1.15, ttrMultiplier: 1.25, defaultLeadTimeDays: 35, freightCostShare: 0.06 },
    RAIL:       { probMultiplier: 1.05, ttrMultiplier: 1.10, defaultLeadTimeDays: 18, freightCostShare: 0.05 },
    ROAD:       { probMultiplier: 0.95, ttrMultiplier: 0.85, defaultLeadTimeDays: 3,  freightCostShare: 0.05 },
    AIR:        { probMultiplier: 0.75, ttrMultiplier: 0.50, defaultLeadTimeDays: 3,  freightCostShare: 0.15 },
    MULTIMODAL: { probMultiplier: 1.10, ttrMultiplier: 1.15, defaultLeadTimeDays: 14, freightCostShare: 0.055 },
  },
  sectorDefectRatePct: {
    Electronics:             { low: 0.5, base: 2.0, high: 5.0 },
    Metals:                  { low: 0.5, base: 1.5, high: 4.0 },
    Chemicals:               { low: 0.2, base: 1.0, high: 3.0 },
    Packaging:               { low: 0.5, base: 2.0, high: 5.0 },
    "General Manufacturing": { low: 0.5, base: 2.0, high: 5.0 },
  },
  expeditingFreightMultipliers: {
    SEA_TO_AIR:        { low: 4.0, base: 8.5, high: 12.0 },
    SEA_TO_RAIL:       { low: 1.5, base: 2.6, high: 4.0 },
    RAIL_TO_ROAD:      { low: 1.2, base: 1.9, high: 3.0 },
    ROAD_TO_AIR:       { low: 3.0, base: 4.8, high: 10.0 },
    MULTIMODAL_TO_AIR: { low: 4.0, base: 6.5, high: 10.5 },
  },
  switching: {
    WARM_SECONDARY: { days: [2, 4, 7] as const,     eur: [250, 750, 2000] as const,     spotPremiumPct: [3, 6, 12] as const },
    PREQUALIFIED:   { days: [7, 14, 30] as const,   eur: [500, 2000, 8000] as const,    spotPremiumPct: [8, 14, 25] as const },
    UNQUALIFIED:    { days: [30, 60, 120] as const, eur: [2000, 9500, 40000] as const,  spotPremiumPct: [12, 20, 35] as const },
  },
} as const;
```
