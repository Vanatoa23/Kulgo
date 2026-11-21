# Sub-Project 1 Spec: Live Disruption Monitoring, Semantic Risk Intelligence & Proactive Alerts

**Status:** Draft Spec (Ready for Research Phase)  
**Target Customer:** EU / Nordic-Baltic mid-market manufacturers (50–500 employees) and global supply-chain teams needing timely disruption visibility without alert fatigue or per-node polling costs.  
**Architectural Constraints:** Must adhere strictly to [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) (`@kulgo/engine` remains pure & zero-I/O; `@kulgo/shared` enforces `.strict()` DTOs; ArcadeDB is the single graph + geospatial store) and [`docs/PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md) (zero Tier-2+ partner identity, name, or coordinate leakage).

---

## 1. Core Scaling Principle: Event-Centric Shared Graph ("Pull Once, Match Many")

Instead of polling external APIs or news feeds once per customer facility (which scales linearly with `O(tenants × nodes)` and creates massive duplicate traffic), Kulgo inverts the architecture:

1. **Pull Once (Canonical `RiskSignal` Vertices):**
   - Each real-world disruption (e.g., Suez Canal blockage, EU sanctions package, Baltic port strike, Central European flood polygon) is ingested **once**, deduplicated, and stored as a single canonical `RiskSignal` vertex in ArcadeDB.
2. **Hybrid 2-Tier Sweep:**
   - **Tier 1 — Global & Regional Structured Feeds:** Sanctions lists, disaster/weather polygons, maritime/chokepoint advisories, and major labor/port notices ingested once globally.
   - **Tier 2 — Deduplicated Entity/Region News Sweeps:** Focused semantic queries executed only for the **deduplicated union** of active countries, ports, chokepoints, and sectors across all Kulgo tenants (never per-tenant or per-duplicate-node).
3. **Match Many (3-Layer ArcadeDB Graph & Geospatial Matching):**
   - **Layer 1 (Facility Match):** Geospatial WKT polygon intersection (`Facility.locationWkt` vs. `RiskSignal.polygonWkt`) and `countryCode` / `regionCode` match.
   - **Layer 2 (Lane Corridor & Chokepoint Match):** Transport lanes are auto-tagged with canonical transit chokepoints (e.g., Asia → EU `SEA` lanes → `SUEZ_CANAL`, `RED_SEA`, `MALACCA_STRAIT`; Baltic `SEA` → `BALTIC_SEA`) so a single chokepoint `RiskSignal` immediately flags every affected lane.
   - **Layer 3 (Hidden Tier-2+ Partner Match):** Server-side cycle-safe traversal (per-path `visitedOrgIds` + `MAX_TRAVERSAL_DEPTH`) across `VERIFIED_PARTNER_LINK` edges intersects active `RiskSignal` vertices with hidden upstream facilities/lanes (scoped to the partner's fulfilling facility subgraph when two-sided `fulfilledByFacilityId` reconciliation is bound, or applying a conservative org-wide upstream fallback when unbound) and surfaces **strictly anonymized regional alerts** to Org A (zero Tier-2+ names, IDs, or coordinates).

---

## 2. Disruption Categories (Signal Taxonomy)

All 5 disruption categories are normalized into a unified `RiskSignal` schema:

1. **Geopolitical & Sanctions:** EU/OFAC/UN sanctions updates, export controls, tariffs, border closures, conflict zones.
2. **Maritime & Logistics Chokepoints:** Suez, Panama, Red Sea, Malacca, Bosporus, Baltic/North Sea port congestion, canal closures, customs bottlenecks.
3. **Extreme Weather & Natural Disasters:** Floods, storms, earthquakes, wildfires, droughts (stored as WKT polygons / point-radius geometries).
4. **Labor & Industrial Disruptions:** Port, rail, and road freight strikes, factory shutdowns, regional energy/grid outages.
5. **Cyber & Financial Distress:** Major ransomware/IT logistics outages, key supplier insolvency/bankruptcy filings.

---

## 3. 2-Stage Semantic Extraction & Deduplication Pipeline

To prevent noise and alert fatigue:
1. **Stage 1 — Deterministic Structured Parsers (Zero LLM cost):**
   - Direct parsers for structured feeds (e.g., GDACS GeoJSON/CAP, EU/OFAC sanctions XML/JSON, MeteoAlarm CAP alerts, port status feeds).
2. **Stage 2 — Lightweight Semantic / LLM Classifier (Unstructured News & RSS):**
   - Extracts a strict Zod-validated payload: `{ category, severity (RED|AMBER|INFO), title, summary, affectedCountryCodes, affectedChokepoints, affectedSectors, polygonWkt?, sourceUrl, publishedAt, confidence }`.
   - **Canonical Deduplication:** Fingerprints events by `(category, canonicalLocation/Chokepoint, timeWindow)` + semantic similarity so multiple articles about the same strike or canal blockage merge into **one** `RiskSignal` vertex with multiple `sourceUrls` and updated `lastSeenAt`.
   - **Lifecycle Management:** Signals have `active`, `expiresAt`, and `resolvedAt` timestamps so resolved disruptions automatically clear from active alerts.

---

## 4. Sweep Cadence & Anti-Fatigue Alert Delivery

- **3x Daily Scheduled Sweeps:** Runs at **06:00, 12:00, and 17:00 UTC** (before European workday, mid-day, and afternoon), plus an admin/dev manual trigger.
- **In-App Updates:** Map overlays (WKT polygons & pulsing chokepoints), lane risk badges, and `AnalyticsPanel` update automatically on the next fetch.
- **Email & Webhook Notifications (Anti-Fatigue):**
  - **Instant Email / Webhook:** Sent **only** for **NEW `RED`** critical disruptions intersecting an org's Tier-1 network or hidden Tier-2+ partner region (deduplicated per `(orgId, signalId)` so the same event never spams twice).
  - **Daily Digest Email:** Summarizes new `AMBER` / `INFO` advisories and resolved signals once per morning.
  - **User Controls:** Org owners can configure notification channels (email / webhook URL) and mute/acknowledge specific alerts per org.

---

## 5. Integration with Sub-Project 2 (Financial Risk) & Sub-Project 3 (ESG)

- Active `RiskSignal` matches feed an optional `liveRiskMultiplier` into `@kulgo/engine`'s Financial Risk model (Sub-Project 2) so active `RED` corridor/facility disruptions dynamically raise short-term disruption probability and TTR.
- Sanctions and conflict `RiskSignal` vertices double as Level 0 Governance (`G1`) risk indicators for Sub-Project 3.

---

## 6. Phased Execution Plan (Sub-Tasks)

### Phase 0 — Feed & Tooling Research (Required Before Coding)
- [ ] Evaluate free / open-source and low-cost structured feeds for all 5 categories:
  - Weather/Disasters: GDACS, NOAA, MeteoAlarm (Europe), ReliefWeb.
  - Sanctions/Geopolitics: OpenSanctions, EU Consolidated Sanctions List, OFAC SDN, ACLED/GDELT.
  - Maritime/Ports/Strikes: GDELT, UNCTAD/AIS port congestion open feeds, targeted RSS/Google News/NewsAPI/Tavily.
- [ ] Define the canonical **Global Chokepoint & Corridor Registry** (Suez, Panama, Red Sea, Malacca, Strait of Hormuz, Baltic Sea, North Sea, English Channel, Alpine/EU rail corridors) with WKT bounding polygons and route-matching rules.
- [ ] Design the Stage 2 semantic classifier prompt, strict Zod output schema, deduplication key strategy, and estimated monthly API/LLM cost at 10 / 100 / 1,000 organizations.
- [ ] Produce `docs/research/LIVE_DISRUPTION_FEEDS_AND_ARCHITECTURE.md`.

### Phase 1 — Shared Contracts, Chokepoint Registry & Pure Matching (`@kulgo/shared` + `@kulgo/engine`)
- [ ] Extend `RiskSignalSchema` in `packages/shared/src/network.ts` with `affectedChokepoints`, `affectedSectors`, `sourceUrls`, `publishedAt`, `expiresAt`, `dedupeKey`, and `confidence`.
- [ ] Add `AlertNotificationPreferenceSchema` and `OrgAlertAckSchema` (`.strict()`).
- [ ] Implement pure chokepoint corridor tagging and 3-layer matching helpers in `@kulgo/engine` with Vitest unit tests.

### Phase 2 — Ingestion Worker, ArcadeDB Graph & Alert Delivery (`@kulgo/api`)
- [ ] Extend `RiskSignal` vertex properties/indexes and add `AlertDeliveryLog` / `OrgAlertAck` vertices in `apps/api/src/db/schema.ts`.
- [ ] Build the modular ingestion runner (`apps/api/src/intelligence/`) with Stage 1 structured parsers, Stage 2 semantic classifier, canonical deduplication, and 3x daily cron scheduler.
- [ ] Wire transactional email (SMTP / Resend) and signed webhook delivery for new `RED` alerts + daily `AMBER` digest, with strict `(orgId, signalId)` deduplication and audit logging.
- [ ] Extend `apps/api/tests/privacy-boundary.test.ts` (verifying zero Tier-2+ leakage in live alerts & emails) and `apps/api/tests/integration/arcadedb.integration.test.ts`.

### Phase 3 — Map Overlays, Alert Feed UI & E2E (`@kulgo/web`)
- [ ] Render live `RiskSignal` WKT polygons and chokepoint markers on `SupplyMap` with click-to-inspect source links and affected lanes.
- [ ] Add an **Alerts & Live Feed** panel with acknowledge/mute controls and notification preference settings in `OrgSettingsModal`.
- [ ] Add Playwright E2E coverage verifying a newly ingested `RiskSignal` highlights affected facilities/lanes and can be acknowledged.
