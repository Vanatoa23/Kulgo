# Architecture Decision Records (ADRs)

## ADR-001: TypeScript Monorepo (`React + Vite` + `Hono` + `Zod`)
* **Decision:** Use a `pnpm` TypeScript monorepo separating `apps/web`, `apps/api`, `packages/shared`, and `packages/engine`.
* **Rationale:** Enforces a physical security boundary between browser code and database code, eliminates SSR hydration friction with WebGL maps (MapLibre/Deck.gl), and maximizes compile-time consistency for agentic development.

## ADR-002: ArcadeDB (Apache 2.0) as Primary Graph & Geospatial Engine
* **Decision:** Use self-hosted ArcadeDB (pinned `26.11.1+`) over HTTP/JSON with parameterized queries.
* **Rationale:** Native OpenCypher multi-hop traversal, geospatial WKT indexing, and future native time-series/vector capabilities in a single Apache 2.0 container—avoiding Neo4j licensing lock-in and SQL recursive-CTE limits.
* **Mitigation:** Because ArcadeDB lacks PostgreSQL-style Row-Level Security, tenant isolation is enforced strictly in `WorkspaceRepository`, strict Zod DTOs, private-network-only deployment, disabled unused plugins, and mandatory CI privacy tests.

## ADR-003: EU / Estonia-First Deployment Readiness
* **Decision:** Keep all services 100% Dockerized with zero US-cloud vendor lock-in, targeting EU-owned providers (e.g., Hetzner Cloud Helsinki + Coolify, or UpCloud Helsinki) for GDPR compliance and <10ms Nordic latency.

## ADR-004: Decouple Physical Supply Topology (`SUPPLIES_LANE`) from Commercial Commitments (`Contract` + `ContractLine`)
* **Decision:** Model `SUPPLIES_LANE` strictly as the physical/operational corridor (`fromFacilityId`, `toFacilityId`, `inputId`, `transportMode`, `leadTimeDays`, `distanceKm`, `riskStatus`), while commercial commitments live in `Contract` + `ContractLine` vertices/edges (`FRAMEWORK`, `SPOT`, or Level-1 `ESTIMATE`). `SupplyInput` owns the canonical `baseUnit`, `unitFamily`, optional unit conversion factors, and optional `totalAnnualDemand`.
* **Rationale:** Real-world procurement involves staggered contracts, spot top-ups, holdover periods, and indexed/fixed pricing across the same physical route. Deriving commercial totals (`activeVolume`, `activeSpendEur`, `weightedAvgUnitPrice`, `volumeSharePct`, `renewalCliff`) on read for either **Current Run-Rate** (default map view) or **Selected Period Window T** (pro-rated by day overlap for EAL/VaR) prevents stale percentage splits, eliminates double-counting when formal `FRAMEWORK` contracts archive initial `ESTIMATE` entries, and enforces denominator hygiene (weighted average unit price sums strictly over active lines with both spend and compatible volume; multi-currency FX rates are passed explicitly into `@kulgo/engine`).

## ADR-005: Partial-Coverage HHI Concentration with Explicit Dimension Denominators
* **Decision:** Compute per-material HHI using derived `activeVolume` in the material's canonical `baseUnit` (falling back to `activeSpendEur` or badged share if volume is missing or units conflict), and compute org-wide Supplier & Country HHI using `activeSpendEur` (EUR as the common denominator across heterogeneous materials). Replace all-or-nothing fallback across active lanes with partial-coverage calculation plus an explicit coverage indicator (`coveredLanesCount`, `totalActiveLanesCount`, `coveragePct`, `weightingBasis`).
* **Rationale:** A single unpriced or zero-volume lane in a 10-lane network must not degrade the other 9 priced lanes to unweighted percentages, nor should heterogeneous physical units (e.g., `UNITS` of PCBs + `TONNES` of steel) ever be summed across different materials for org-wide HHI.

## ADR-006: GHG Protocol Scope 3 Category 1 Attribution (Zero 100%-Entity Over-Attribution)
* **Decision:** Never attribute 100% of a Tier-1 supplier's corporate Scope 1/2/3 emissions to a buyer purchasing only a fraction of their output. Enforce a 3-tier attribution hierarchy in `@kulgo/engine`: (1) **Product/Volume-based PCF** (`purchasedVolume * productEmissionFactorTco2ePerUnit`), (2) **Economic Attribution Factor** (`supplierTotalTco2e * (buyerActiveSpendEur / supplierAnnualRevenueEur)`), computed server-side via emission intensity (`tCO2e / EUR`) so supplier revenue is never exposed, and (3) explicit allocation ratio or spend/volume-scaled sector baseline fallback.
* **Rationale:** Prevents order-of-magnitude Scope 3 inflation when onboarding large verified Tier-1 suppliers while preserving strict multi-tenant financial confidentiality.

## ADR-007: Cycle-Safe Partner Graph Traversal & Two-Sided Facility Reconciliation
* **Decision:** Enforce per-path `visitedOrgIds` cycle detection and `MAX_TRAVERSAL_DEPTH` on all server-side `VERIFIED_PARTNER_LINK` traversals. When a partner link specifies `fulfilledByFacilityId`, scope upstream evaluation to the subgraph feeding that facility; when unspecified, apply a conservative org-wide upstream fallback until two-sided facility reconciliation is completed.
* **Rationale:** Prevents infinite loops or double-counting in circular supply chains (`A -> B -> C -> A`), preserves shared-chokepoint detection in diamond topologies, and avoids false confidence before a partner binds which exact plant fulfills a buyer's material.

## ADR-008: Physical-First Hybrid ESG Engine, License-Isolated EXIOBASE 3.8.2 Spend Layer & Pluggable Multi-Region Compliance
* **Decision:** Implement Kulgo's Environmental-First ESG engine (`FACTOR_MATRIX_VERSION = "2026.1"`) as a pure, zero-I/O **Physical-First Hybrid** in `@kulgo/engine` evaluating Scope 3 Category 1 per active lane across a 6-step deterministic waterfall: (1) Verified Partner PCF (`PCF_VOLUME`, Score 1–2), (2) Server-side Partner Economic Intensity (`ECONOMIC_INTENSITY`, Score 2, partner revenue hidden and denominator-scoped), (3) Explicit Allocation (`ALLOCATION_RATIO`, Score 2), (4) Attribution-only Open Physical & CBAM Factors (`PHYSICAL_FACTOR`, Score 3 — ADEME Base Carbone + UK DESNZ 2026 + EU JRC CBAM Defaults), (5) License-isolated Spend EEIO (`SPEND_EEIO`, Score 4 — EXIOBASE v3.8.2 `pxp` isolated under CC-BY-SA 4.0 + US EPA USEEIO v1.3 under CC0), and (6) Scaled Country × Sector Proxy (`SECTOR_BASELINE`, Score 5, never 100% unscaled entity). Pair this with UK DESNZ/ADEME Category 4 freight (ISO 14083 methodology without copying GLEC tables), dual Location/Market Scope 2 (EEA/DESNZ/eGRID/Ember + AIB Residual Mix), and pluggable compliance packs (`GLOBAL_GHG_ISSB`, `EU`, `UK`, `US`, `APAC`, `AFRICA`).
* **Rationale:** Prioritizing physical factors over spend-based EEIO eliminates the Price-Quality Paradox for decarbonizing manufacturers, pinning EXIOBASE v3.8.2 in an isolated data file preserves strict commercial SaaS licensing (avoiding v3.9+ NC, IEA NC, and GLORIA/ecoinvent restrictions), and keeping compliance packs data-driven and versioned ensures 2026 accuracy (EU Omnibus VSME threshold, 50 t/yr CBAM de minimis, CA SB 253 litigation status).


