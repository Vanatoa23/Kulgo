# Kulgo AI & Engineering Decision Ledger

> **Purpose:** Permanent, **append-only** institutional memory for Kulgo's founders, engineers, and AI coding agents. Records high-level milestones completed, key product/architecture/tooling decisions, **why** they were made, and what alternatives were rejected — so future sessions never re-research settled questions or accidentally reverse deliberate trade-offs.

---

## Ledger Rules (Strict)

1. **Append-Only:** Never delete, overwrite, or rewrite previous entries.
2. **Superseding Decisions:** If a past decision is later reversed or refined, append a new entry with `Supersedes: LEDGER-XXXX` explaining what changed and why.
3. **Keep Entries High-Signal:** Record *what* was decided/shipped, *why* (rationale & rejected alternatives), and *references* (PRs, Issues, Specs, Research docs). Avoid low-level code diffs.
4. **Read Before Researching:** Any agent or contributor starting a new sub-project or research task should scan this ledger first.

### Entry Template
```markdown
## LEDGER-XXXX — YYYY-MM-DD — <Short Title>
- **Category:** `Architecture` | `Product` | `Tooling` | `Data/Research` | `Security/Privacy` | `Milestone`
- **Status:** `Active` | `Superseded by LEDGER-YYYY`
- **Decision / Summary:** <What was decided or shipped>
- **Why (Rationale):** <Key reasons, constraints, and trade-offs>
- **Alternatives Considered & Rejected:** <What we chose NOT to do and why>
- **References:** <File paths, PRs, GitHub Issues>
```

---

## Entries

## LEDGER-0001 — 2026-11-20 — Phase 1 Core Platform Architecture (M1–M6)
- **Category:** `Architecture` / `Milestone`
- **Status:** `Active`
- **Decision / Summary:** Built and merged Kulgo Phase 1 (Milestones 1–6) as a `pnpm` TypeScript monorepo (`apps/web` React 19 + Vite + Tailwind v4 + MapLibre/Deck.gl + React Flow; `apps/api` Hono on Node 24; `packages/shared` strict Zod contracts; `packages/engine` pure zero-I/O analytics engine; ArcadeDB graph + geospatial database).
- **Why (Rationale):** Keeps business/risk/ESG math 100% deterministic and unit-testable in `@kulgo/engine`, enforces API/UI contract safety via `@kulgo/shared`, and models multi-tier supply networks + WKT geospatial queries natively in ArcadeDB without exposing the DB outside `kulgo-internal`.
- **Alternatives Considered & Rejected:** Putting DB calls inside the engine (breaks determinism/testing); exposing ArcadeDB ports or using unused wire protocols (violates `PRIVACY_CONTRACT.md`); maintaining duplicate Dockerfiles in `infra/` (removed in M6 so `apps/*/Dockerfile` is the single source of truth).
- **References:** `docs/ARCHITECTURE.md`, `docs/PRIVACY_CONTRACT.md`, `docs/DEPLOYMENT.md`, PR #7.

## LEDGER-0002 — 2026-11-20 — Non-Negotiable Multi-Tenant & Tier-2+ Privacy Contract
- **Category:** `Security/Privacy`
- **Status:** `Active`
- **Decision / Summary:** Every org sees **only** the suppliers, facilities, products, materials, and lanes it entered. Hidden Tier-2+ partner networks (`VERIFIED_PARTNER_LINK`) are traversed strictly server-side to return anonymized aggregate scores, regional warnings, and Scope 3 totals. All privacy-sensitive DTOs use Zod `.strict()`, enforced by CI gate `pnpm test:privacy`.
- **Why (Rationale):** Suppliers will never join a supply-chain network if their own upstream suppliers, margins, or customer lists can be exposed to buyers.
- **Alternatives Considered & Rejected:** Sharing raw Tier-2+ facility names/coordinates with Tier-1 buyers (destroys supplier trust and breaks B2B confidentiality).
- **References:** `docs/PRIVACY_CONTRACT.md`, `apps/api/tests/privacy-boundary.test.ts`.

## LEDGER-0003 — 2026-11-20 — Target Pilot Customer & Progressive Disclosure Philosophy
- **Category:** `Product`
- **Status:** `Active`
- **Decision / Summary:** Optimize Phase 2 specs for **EU / Nordic-Baltic mid-market manufacturers (50–500 employees)** needing both disruption resilience and CSRD Scope 3 compliance. Adopt strict **Progressive Disclosure** ("Zero-friction baseline → High precision"): Kulgo must work at **Level 0** (just node name + location/company) with wide confidence ranges, and automatically narrow ranges / improve scores as users add spend, volumes, safety stock, or unit margins.
- **Why (Rationale):** Mid-market manufacturers rarely have clean ERP cost-accounting ready on day 1; requiring volumes/costs upfront causes immediate onboarding drop-off.
- **Alternatives Considered & Rejected:** Requiring full ERP-style financial inputs before showing maps, alerts, or estimates.
- **References:** `docs/specs/SUBPROJECT_2_FINANCIAL_RISK.md` (Issue #8).

## LEDGER-0004 — 2026-11-20 — Financial Risk & Disruption Loss Modeling (Sub-Project 2)
- **Category:** `Product` / `Data/Research`
- **Status:** `Active`
- **Decision / Summary:** Model all 5 core financial/operational metrics purely in `@kulgo/engine`: (1) Expected Annual Loss (EAL) & VaR for provisions, (2) Time-to-Survive vs. Time-to-Recover (TTS/TTR) outage gap, (3) Defect/faulty-unit order buffer, (4) Expediting & switching costs, and (5) Working capital / carrying cost vs. EAL trade-off. Present results as **Low/Base/High euro ranges** with explicit confidence badges, backed by versioned static baseline tables in `@kulgo/engine` (overridable per entity, and later enriched by Live Risk Signals). Hidden Tier-2+ risks act only as an anonymized server-side risk multiplier.
- **Why (Rationale):** Gives CFOs and procurement leads actionable euro ranges for provisions and dual-sourcing ROI without fabricating false precision when inputs are incomplete.
- **Alternatives Considered & Rejected:** Showing single point estimates without uncertainty ranges; running live external actuarial API calls on every request.
- **References:** `docs/specs/SUBPROJECT_2_FINANCIAL_RISK.md`, GitHub Issue #8.

## LEDGER-0005 — 2026-11-21 — Environmental-First ESG (PCAF 1–5) & Multi-Region Compliance (Sub-Project 3)
- **Category:** `Product` / `Data/Research`
- **Status:** `Active`
- **Decision / Summary:** Focus primarily on **Environmental (E)** with **PCAF Data Quality Scoring (1–5)** and one unified, versioned open-source Emission Factor Baseline Matrix (Phase 0 to evaluate EXIOBASE, USEEIO, DEFRA/DESNZ, ADEME, GLEC, Ember — balancing EXIOBASE's product granularity against data freshness). Use **GHG Protocol + ISSB (IFRS S1/S2)** as the universal global backbone, with pluggable regional compliance packs (`EU`, `US`, `UK`, `APAC`, `AFRICA`) auto-activated by **Org HQ country + Target Sales/Export Markets** + manual toggles. Keep lightweight S & G metrics (S1/S2/G1/G2) as secondary fast-follow priority. Deliver auditor-ready JSON/CSV ledgers, Board/Bank-ready PDF summaries, and an in-app Regional Compliance Readiness Checklist.
- **Why (Rationale):** Avoids hardcoding EU-only CSRD rules while keeping global compliance scalable through one common ISSB/GHG backbone; PCAF 1–5 aligns naturally with Progressive Disclosure (start with estimated emissions, upgrade to primary verified data).
- **Alternatives Considered & Rejected:** Hardcoding CSRD-only compliance; making S & G metrics a blocking v1 priority; locking into proprietary paid emission factor APIs before validating an open-source baseline.
- **References:** `docs/specs/SUBPROJECT_3_ESG_COMPLIANCE.md`, GitHub Issue #25.

## LEDGER-0006 — 2026-11-21 — Event-Centric "Pull Once, Match Many" Live Disruption Monitoring (Sub-Project 1)
- **Category:** `Architecture` / `Product`
- **Status:** `Active`
- **Decision / Summary:** Invert live disruption monitoring from per-node polling to an event-centric **Hybrid 2-Tier Sweep** running **3x daily** (06:00, 12:00, 17:00 UTC): (1) Global/regional structured feeds (sanctions, weather, ports/chokepoints, strikes, cyber/distress) ingested **once** into canonical `RiskSignal` vertices, plus (2) deduplicated news sweeps only for the unique union of active countries/ports/sectors across tenants, normalized via deterministic parsers + a lightweight semantic/LLM classifier. Match signals to networks via **3-Layer Graph Matching** (Facility WKT/country, Lane corridor/chokepoint tagging like Suez/Red Sea, and anonymized Tier-2+ partner intersection). Deliver instant email/webhook **only for new `RED`** alerts + daily morning digest for `AMBER`/`INFO`.
- **Why (Rationale):** Scales cleanly (`O(events)` instead of `O(tenants × nodes)`), directly leverages ArcadeDB's graph + `GEOSPATIAL` WKT index, and prevents customer alert fatigue.
- **Alternatives Considered & Rejected:** Polling news APIs individually per customer facility (unscalable cost & duplicate data); sending instant emails for every `AMBER`/`INFO` signal (alert fatigue).
- **References:** `docs/specs/SUBPROJECT_1_LIVE_DISRUPTION_MONITORING.md`, GitHub Issue #26.

## LEDGER-0007 — 2026-11-21 — 4-Page UX Shell, Strategy-Game Map & Supplier Catalogue Flywheel (Sub-Projects 4 & 5)
- **Category:** `Product` / `Architecture`
- **Status:** `Active`
- **Decision / Summary:**
  - **UX Shell (Sub-Project 4):** Redesign into a **Dark Tactical Command-Center** 4-page app with slim left icon-rail (`Hub`, `Map`, `Dashboard`, `Settings`). Page 1 **Network Hub** uses a 3-column flow (`Upstream Suppliers → My Facilities/Warehouses → Downstream Clients`) with an Inspector Drawer supporting **30/70 multi-warehouse allocation splits**. Page 2 **Strategy-Game Map** adds animated directional flow pulses, volume-scaled line thickness, `[Suppliers | Both | Clients]` HUD toggle, Focus/Isolation mode, and click-on-line volume/risk HUD cards. Page 3 **Dashboard** organizes Financial, ESG, and Compliance under sub-tabs with a prominent `Export Reports` dropdown.
  - **Supplier Flywheel (Sub-Project 5):** Support 2-path onboarding ("Add New" with `Supplier Name` required + `.xlsx`/CSV upload), background public **Business Registry enrichment** (starting with Estonia *Äriregister* + Nordic/EU registries) with **automatic boilerplate invite emails** (guarded by deduplication, rate limits, and 1-click unsubscribe), a **Hybrid Standardized + Free-Text Product Catalogue** for opted-in suppliers, and a **`See alternatives (x)`** button inside the Node Inspector with ranked comparison, **1-Click Test in What-If Simulator**, and **1-Click Request Intro / Quote**.
- **Why (Rationale):** Makes the app immediately intuitive for non-technical mid-market teams, adds downstream client visibility, and creates a real B2B viral loop where suppliers join for free monitoring + new buyer discovery.
- **Alternatives Considered & Rejected:** Keeping a single crowded map screen with nested modals; exact-string-only catalogue matching (too brittle); exposing buyer's private supply graph during alternative intro requests.
- **References:** `docs/specs/SUBPROJECT_4_UX_REDESIGN_AND_STRATEGY_MAP.md` (Issue #28), `docs/specs/SUBPROJECT_5_SUPPLIER_ONBOARDING_CATALOGUE_REGISTRY.md` (Issue #29), `docs/ROADMAP.md`, PR #30.

## LEDGER-0008 — 2026-11-21 — €0/mo TypeScript-Native Feed Stack, Epistemic Safeguards & AI API Centre (Sub-Project 1 Phase 0–2)
- **Category:** `Architecture` / `Data/Research` / `Tooling`
- **Status:** `Active`
- **Decision / Summary:** Standardize Sub-Project 1 v1 on a **€0/month, 100% TypeScript-native** ingestion pipeline inside `apps/api/src/intelligence/` (zero extra Docker containers): Stage 1 deterministic parsers (GDACS GeoJSON, USGS GeoJSON, IMF PortWatch ArcGIS GeoJSON, MeteoAlarm CAP/Atom XML, EU/OFAC sanctions, EE/LV/LT insolvency, ENTSO-E), Stage 2 pre-filtered unstructured feeds routed through a provider-agnostic **AI API Centre (`LlmRouter`)** with circuit-breaker fallback (`Gemini 2.5 Flash-Lite` → `Groq Llama 3.3 70B` → `OpenAI gpt-4o-mini` / `OpenRouter`), and Stage 2b bounded single-event deep-dives (Tavily/Exa free tier only). Added `verificationStatus` (`CONFIRMED` | `CORROBORATED` | `ALLEGED`) and `lifecycle` (`PLANNED` | `ACTIVE` | `RESOLVED`) so single-source rumours never trigger instant `RED` emails until corroborated by 2+ independent domains. Wired Resend/Brevo + HMAC-SHA256 webhooks with strict `(orgId, signalId, channel)` deduplication.
- **Why (Rationale):** Preserves €0/month MVP operating cost, avoids Python/browser sidecar operational overhead, prevents vendor lock-in or single-provider AI outages, and eliminates rumour-driven alert fatigue while scaling to 1,000+ orgs under €110/mo.
- **Alternatives Considered & Rejected:** Running Python Scrapy/Crawl4AI/LiteLLM/RSSHub sidecar containers for v1 (unnecessary RAM and maintenance burden); polling paid news/search APIs (NewsAPI/Perigon/Exa) on broad cron schedules (prohibitive cost at scale); firing instant `RED` alerts on unverified single-source reports.
- **References:** `docs/research/LIVE_DISRUPTION_FEEDS_AND_ARCHITECTURE.md`, `packages/engine/src/chokepoints.ts`, `apps/api/src/intelligence/`, GitHub Issue #26.

## LEDGER-0009 — 2026-11-21 — Contracts Commercial Layer, Partial-Coverage HHI, Scope 3 Attribution & Partner Bridge Alignment
- **Category:** `Architecture` / `Data/Research` / `Security/Privacy`
- **Status:** `Active`
- **Decision / Summary:**
  1. **Contracts as the Commercial Layer:** Decouple physical topology (`SUPPLIES_LANE`) from commercial commitments (`Contract` + `ContractLine`: `FRAMEWORK`, `SPOT_PO`, or Level-1 `ESTIMATE`; explicit `cadence`: `PER_YEAR` | `TOTAL_OVER_TERM`; contract confidence `CONTRACTED` > `IMPORTED` > `ESTIMATED`). `SupplyInput` owns canonical `baseUnit`, `unitFamily`, automatic SI + custom cross-dimension unit conversion rules (e.g., `1 pallet = 400 pcs`), and optional `totalAnnualDemand` (flagging unmapped demand as **Uncontracted / Spot Exposure**). Commercial totals (`activeVolume`, `activeSpendEur`, `weightedAvgUnitPrice`, derived `volumeSharePct`, `renewalCliff`) are derived on read for two time views: **Current Run-Rate** (default map label) and **Selected Period Window `T` / Next 12 Months** (pro-rated by day overlap for EAL/VaR). Enforce denominator hygiene (unit price sums strictly over active lines with both spend and compatible volume; fall back to badged `~Spend Share %` on unit conflict/missing volume, never dividing spend by another supplier's average price). Ongoing `FRAMEWORK` contracts default to `HOLDOVER` (amber/dashed on map, keeping volume active until renewed/archived) or `AUTO_RENEW` with `noticePeriodDays` cancellation deadline alerts, `SPOT_PO` top-ups default to `AUTO_ARCHIVE` (while never deleting expired contracts, and keeping 0-active-contract lanes visible as `Lapsed / Uncontracted`), renewal cliffs (`>30%` volume expiring in 90 days) feed TTS vs. TTR, FX rates are passed explicitly into `@kulgo/engine`, and adding the first `FRAMEWORK` contract defaults to archiving/replacing any quick `ESTIMATE`. Include low-friction UX ("Flat 2-field Form → Live Aggregated Summary Banner", 3-click `+ Add Spot / Top-up`, ERP 12-month PO CSV auto-clustering, PDF contract dropzone, and monthly 1-click renewal digest).
  2. **HHI Concentration Alignment:** Per-material HHI uses derived `activeVolume` in `baseUnit` (falling back to `activeSpendEur` or volume share if volume is missing or units conflict); org-wide Supplier & Country HHI uses derived `activeSpendEur` (EUR common denominator across materials). Replaced all-or-nothing fallback across active lanes with partial-coverage calculation plus explicit coverage metadata (`coveredLanesCount`, `totalActiveLanesCount`, `coveragePct`, `weightingBasis`).
  3. **ESG Scope 3 Attribution (GHG Protocol Category 1):** Never attribute 100% of a Tier-1 supplier's total Scope 1/2/3 emissions to a partial buyer. Prefer **Product/Volume-based PCF** (`purchasedVolume * productEmissionFactorTco2ePerUnit`), falling back to a **server-side Economic Attribution Factor** (`supplierTotalTco2e * (buyerActiveSpendEur / supplierAnnualRevenueEur)`) passed as emission intensity (`tCO2e / EUR`) so supplier total revenue is never exposed.
  4. **Cycle-Safe Traversal & Two-Sided Facility Reconciliation:** Enforce per-path `visitedOrgIds` and `MAX_TRAVERSAL_DEPTH` on `VERIFIED_PARTNER_LINK` traversals so loops (`A -> B -> C -> A`) never infinite-loop or double-count. Scope partner upstream evaluation to the fulfilling facility subgraph when two-sided `fulfilledByFacilityId` is bound, and apply a conservative org-wide fallback when unbound.
- **Why (Rationale):** Eliminates stale manually-maintained percentage splits, prevents 10-lane networks from degrading when 1 lane lacks spend, prevents 10x–100x Scope 3 over-attribution from large Tier-1 suppliers, and guarantees termination and accuracy across complex multi-tier partner graphs.
- **Alternatives Considered & Rejected:** Storing commercial contract fields only as flat properties on `SUPPLIES_LANE` (cannot represent staggered contracts, spot top-ups, or period pro-ration); dividing spend by another supplier's average price to fabricate volume (circular bias); dropping expired base contracts to 0 overnight; all-or-nothing HHI fallback; attributing 100% of a partner's corporate Scope 1/2/3 to every buyer; exposing partner `annualRevenueEur` to buyers.
- **References:** `docs/DECISIONS.md` (ADR-004 to ADR-007), `docs/PRIVACY_CONTRACT.md`, `docs/specs/SUBPROJECT_2_FINANCIAL_RISK.md`, `docs/specs/SUBPROJECT_3_ESG_COMPLIANCE.md`, `packages/engine/src/hhi.ts`, `packages/engine/src/esg.ts`, `packages/engine/src/analytics.ts`, `apps/api/src/analytics/partner-resolver.ts`.

## LEDGER-0010 — 2026-11-22 — Missing Scope 3 Attribution Inputs (#37)
- **Category:** `Security/Privacy` / `Data/Research`
- **Status:** `Active`
- **Decision / Summary:** Verified issue #37 against main `d30b84e`, including PR #34 review fixes `0d77e10` and `28b1da7`. The private partner aggregate fallback was already removed, but the current engine still attributed an entire user-entered supplier Scope 1+2 estimate when allocation inputs were missing, and the exported legacy helper still returned its raw inventory. Both now use the existing public sector proxy with the provisional 8% buyer share. Current evaluation retains country adjustment, facility deduplication, PCAF 5 ledger provenance, and prompts for proportional inputs; private inventories are never fallback activity.
- **Why (Rationale):** A supplier inventory alone does not identify a buyer's share. Preserve the newer PCF, economic intensity, allocation, physical/spend waterfall, shared caps, contract authority, cycle guards, and reconciled denominator scoping.
- **Verification:** Regression cases reproduced full 1,000 tCO2e attribution before the fix. Engine and API coverage checks missing revenue/spend/PCF/allocation, multiple lanes, reconciled facilities, summary/report/JSON/CSV consistency, and zero private total or identity leakage.
- **References:** GitHub issue #37; `docs/research/ESG_FACTOR_MATRIX_AND_COMPLIANCE.md`; `packages/engine/src/__tests__/esg.test.ts`; `packages/engine/src/__tests__/esg-compliance.test.ts`; `apps/api/tests/privacy-boundary.test.ts`.

## LEDGER-0011 — 2026-11-23 — AI Orchestration, Knowledge Factory, Frameworks & Training Data Synthesis (#61–#69)
- **Category:** `Architecture` / `Data/Research` / `Product`
- **Status:** `Active`
- **Decision / Summary:** Reviewed and synthesized Research Issues #61 (LangGraph & Agent Orchestration), #62 (Knowledge Factory & Self-Improving Intelligence), #63 (LangChain vs. AI SDK vs. TypeScript Frameworks), and #64 (Deep Agents, LangSmith & Evaluation Infrastructure) into `docs/research/AI_ORCHESTRATION_AND_KNOWLEDGE_SYNTHESIS.md`:
  1. **Keep Custom TypeScript Ingestion & `LlmRouter` Boundary:** Do not adopt heavyweight external orchestration/agent/memory frameworks (LangGraph, Temporal, Mastra, LangChain.js, Deep Agents, Mem0, Zep) or multi-container observability stacks (self-hosted Langfuse/LangSmith) at our current stage. Preserve strict separation between Public Evidence (`Pull Once`) and Authenticated Tenant Impact (`Match Many`).
  2. **Prioritize 4 Early, High-Payoff Intelligence & UTF-8 Improvements (#65–#68):**
     - **Full UTF-8 / Unicode Normalization & Multilingual Pre-Filter (#65):** Replace ASCII-only regexes (`[^a-z0-9]`, `\b`) in `dedupe.ts`, `stage2.ts`, and `auth/repository.ts` with Unicode property escapes (`\p{L}`, `\p{N}`, `/u`, NFKC/NFKD) so Estonian (`õ, ä, ö, ü, š, ž`) and European languages are first-class, and wire cross-sweep 72h URL/title deduplication in `runner.ts`.
     - **Stage 2 Provenance Binding & Strict Geography (#66):** Bind Stage 2 `.strict()` extractions to input `articleId` + verbatim `evidenceQuote`, eliminate the giant EU/Baltic fallback polygon for country-only news, enforce syndication-aware corroboration, and separate event validity dates from DB staleness TTL.
     - **Router & Alert Hardening (#67):** Move Gemini API key to `x-goog-api-key` header, add 60s provider cooldown + token usage accounting, add an atomic alert outbox claim, persisted sweep lease, and align Layer-3 partner alert matching with depth-4 `partner-resolver.ts`.
     - **Structured Feedback & Shared Public Entity Aliases (#68):** Add structured dismissal reason codes to `OrgAlertAck` (`HANDLED`, `WRONG_ENTITY_OR_SITE`, `FALSE_OR_OUTDATED_EVENT`, `NOT_RELEVANT_TO_LANE`) and unify public entity aliases across Sub-Project 5 (#29) and Sub-Project 1.
  3. **Save All Data for Future Internal Model Training (#69):** Establish a two-plane (`GLOBAL_PUBLIC` corpus vs. `ANONYMIZED_OUTCOMES`) append-only compressed JSONL/Parquet **Training Data Vault** in low-cost EU Object Storage so all raw feeds, pre-filter decisions, LLM extractions, event lifecycles, entity-resolution pairs, and de-identified user feedback can be used to train Kulgo's own internal models as we scale.
- **Why (Rationale):** Avoids 100+ MB framework bloat, Zod v3/v4 incompatibilities, and extra server containers while fixing concrete false-alert, European-language, and duplicate-email risks early in development and building a proprietary training dataset moat from day one.
- **Alternatives Considered & Rejected:** Adopting LangGraph/Temporal/LangChain/Deep Agents/Mem0/LangSmith Engine today (premature operational complexity with zero inference tariff reduction); discarding raw feeds, dropped pre-filter items, or dismissal reasons instead of archiving them for future internal model training.
- **References:** `docs/research/AI_ORCHESTRATION_AND_KNOWLEDGE_SYNTHESIS.md`, GitHub Issues #61, #62, #63, #64 (closed), and actionable follow-up Issues #65, #66, #67, #68, #69.

## LEDGER-0012 — 2026-11-23 — Post-Backlog Demo Deferral & Institutional Enterprise UI / Map Clarity Redesign Plan
- **Category:** `Product` / `UX/Frontend`
- **Status:** `Active`
- **Decision / Summary:**
  1. **Defer Live Product Demo Until Open Issues Are Closed:** Postpone the full product walkthrough until the remaining open Phase 2 & Intelligence hardening issues (#65, #66, #67, #68, #69, and Sub-Project 5 / #29) are completed and merged. Never use simplified SVG/HTML mockups or emoji-laden placeholders to represent the product.
  2. **Dedicated Institutional B2B UI & Geospatial Map Redesign Pass:** Before the next demo, execute a dedicated design-engineering pass across `apps/web` (`SupplyMap.tsx`, `LogicalGraphView.tsx`, `NetworkHubPage.tsx`, `ExecutiveDashboardPage.tsx`, `AppShellNav.tsx`, `TopContextBar.tsx`) to enforce an authoritative, serious enterprise/institutional B2B aesthetic:
     - **Strict Corporate Iconography & Typography:** Zero emojis anywhere in UI, docs, or previews; use clean corporate vector iconography (`lucide-react` / custom monochrome SVG glyphs), crisp tabular financial numerals, and high-trust institutional color hierarchy.
     - **Geospatial Map De-Cluttering & Readability (`SupplyMap.tsx`):** Eliminate messy overlapping arcs and rainbow visual noise on the MapLibre + Deck.gl canvas. Bundle or offset parallel/nearby regional corridors (e.g., Tallinn–Tartu–Helsinki–Riga), keep healthy baseline lanes visually muted (low-opacity neutral slate/steel) so only selected, hovered, or at-risk (`AMBER`/`RED`) corridors draw visual focus, remove noisy game-like pulsing clutter, and ensure clear geographic context and legible node/cluster labels at every zoom level.
     - **Information Density & Visual Hierarchy:** Replace any "strategy-game / vibecoded" styling cues with clean financial/risk terminal patterns (Bloomberg / Palantir Foundry / institutional risk-platform aesthetic) where every line, badge, and color encodes an unambiguous business metric.
- **Why (Rationale):** Kulgo is an enterprise supply-chain resilience, financial risk, and regulated ESG compliance platform for CFOs, COOs, and procurement executives. Overlapping map lines, excessive simultaneous colors, or toy/game-like visual cues undermine executive trust and make dense multi-tier networks harder to read.
- **Alternatives Considered & Rejected:** Running demos via simplified standalone HTML/SVG approximations without real MapLibre vector tiles; retaining game-inspired HUD aesthetics or high-saturation multi-color lane rendering across all healthy corridors simultaneously.
- **References:** `apps/web/src/components/SupplyMap.tsx`, `apps/web/src/components/LogicalGraphView.tsx`, `apps/web/src/components/ExecutiveDashboardPage.tsx`, `apps/web/src/components/NetworkHubPage.tsx`, GitHub Issues #29, #65, #66, #67, #68, #69.

## LEDGER-0013 — 2026-11-26 — Quantitative Risk Intelligence & News-Based Risk Indices Verdict (#82)
- **Category:** `Data/Research` / `Product` / `Architecture`
- **Status:** `Active`
- **Decision / Summary:** Completed feasibility research for Issue #82 (`docs/research/QUANTITATIVE_RISK_INTELLIGENCE.md`) evaluating Caldara & Iacoviello (2022) GPR-style news-frequency indices (`N_risk / N_total`) for Kulgo. **Verdict: Do NOT implement proprietary news-frequency risk indices, and explicitly REJECT supplier-level news-frequency risk scoring.** Close Issue #82 without implementation. Keep only an optional, low-priority future path to ingest €0/mo licensed public macro indicators (Eurostat BCS `CC BY 4.0`, GPR `CC BY`, NY Fed GSCPI) into `stage1.ts` strictly as read-only macro backdrop / What-If stress presets after core Phase 2 priorities.
- **Why (Rationale):**
  1. **Invalid denominator & broken unit economics:** Valid article-share indices require a fixed, consistently sampled full-news panel (`N_total`), whereas Kulgo's Stage 2 pipeline runs risk-targeted queries. Licensing a fixed press archive (Factiva / NewsAPI.ai backfill) breaks Kulgo's €0–€35/mo MVP cost target and collides with `EXCERPT_ONLY` copyright hygiene (`PRIVACY_CONTRACT.md`).
  2. **SME sparsity, defamation & network-flywheel risk:** >95% of EU/Nordic-Baltic mid-market suppliers (50–500 employees) have near-zero news volume, causing extreme `0/0` and Poisson false spikes. Publishing automated news-based risk scores about private SMEs creates commercial defamation/legal exposure and deters suppliers from accepting partner invites or joining the Opt-In Directory.
  3. **Existing architecture already outperforms raw counts:** Kulgo's Stage 1 structured feeds (IMF PortWatch, GDACS, MeteoAlarm, ENTSO-E, EU/OFAC sanctions, EE/LV/LT insolvency registers) and Stage 2 deduplicated/corroborated `RiskSignal`s (`#65`, `#66`) + pure `@kulgo/engine` `liveRiskMultiplier` (`financial-risk.ts`) deliver faster, explainable, syndication-immune alerts. Empirical literature (Soto 2023 FEDS Notes; GDELT audits) confirms pure keyword counts underperform structured physical/survey data and sentiment-aware models.
  4. **Regional gap:** Country-specific GPR omits Estonia, Latvia, and Lithuania and reflects a US newspaper lens.
- **Alternatives Considered & Rejected:** Building a proprietary news-frequency index over GDELT or paid news APIs; scoring individual SME suppliers from scraped news mentions; mutating `financial-risk.ts` EAL probabilities with uncalibrated macro news indices without out-of-sample backtesting.
- **References:** `docs/research/QUANTITATIVE_RISK_INTELLIGENCE.md`, GitHub Issue #82 (closed), `apps/api/src/intelligence/`, `packages/engine/src/financial-risk.ts`, `docs/PRIVACY_CONTRACT.md`.

