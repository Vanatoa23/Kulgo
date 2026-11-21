# Kulgo Live Disruption Monitoring — Feeds, Tooling & Architecture (Phase 0)

> **Status:** Approved & Finalized (Phase 0 of Issue #26 / [`SUBPROJECT_1_LIVE_DISRUPTION_MONITORING.md`](../specs/SUBPROJECT_1_LIVE_DISRUPTION_MONITORING.md))  
> **Scope:** v1 (€0/month MVP) prioritizing **Europe, the Baltic region, and major global maritime lanes**, scaling cleanly to 1,000+ organizations under the **"Pull Once, Match Many"** architecture.

---

## 1. Core Architectural Decisions

1. **Pull Once, Match Many (Event-Centric Shared Graph):**
   - Disruptions are ingested globally/regionally 3x daily (**06:00, 12:00, 17:00 UTC**), deduplicated into canonical `RiskSignal` vertices in ArcadeDB, and matched across all tenants via 3 layers (Facility WKT/Country, Lane Chokepoint/Corridor, and Privacy-Preserving Tier-2+ Partner Traversal).
   - Ingestion costs scale with the **deduplicated union** of active countries, ports, and chokepoints—never linearly with organization count.
2. **100% TypeScript-Native Ingestion (Zero Extra Containers for v1):**
   - Run all Stage 1 deterministic parsers (`fetch` + `fast-xml-parser` + `cheerio`) and Stage 2 batched LLM classifiers directly inside `apps/api/src/intelligence/`.
   - Defer heavy Python/browser scraping sidecars (Scrapy, Crawl4AI, Firecrawl, RSSHub, LiteLLM) until a concrete coverage gap justifies the RAM and maintenance overhead.
3. **Epistemic Discipline (Claims vs. Confirmed Facts & Lifecycle):**
   - Every `RiskSignal` tracks:
     - `verificationStatus`: `CONFIRMED` (Stage 1 official structured feeds) | `CORROBORATED` (2+ independent Stage 2 sources) | `ALLEGED` (single unverified report — watchlist only, never triggers instant `RED` email).
     - `lifecycle`: `PLANNED` | `ACTIVE` | `RESOLVED` (so resolved disruptions automatically clear from active alerts and map overlays).
   - Maintain `sourceUrls[]` and canonical `dedupeKey` so syndicated reposts merge into one vertex without inflating corroboration.
4. **Provider-Agnostic "AI API Centre" (`apps/api/src/intelligence/llm-router.ts`):**
   - Built with **Vercel AI SDK (`ai`)** + `generateObject()` enforcing Kulgo's `.strict()` Zod schemas.
   - Circuit-breaker fallback chain:
     1. **Primary (€0 Free Tier):** Google Gemini (`gemini-2.5-flash-lite` / `gemini-2.5-flash`, 1,000+ RPD free).
     2. **Fallback 1 (€0 Free Tier):** Groq (`llama-3.3-70b-versatile`, 1,000 RPD free).
     3. **Fallback 2 (Optional Paid SLA):** OpenAI (`gpt-4o-mini`) or OpenRouter.
5. **Bounded Deep-Dive Search (Stage 2b):**
   - Reserve **Tavily (1,000 free credits/mo)** and **Exa (€10 free credit)** strictly for single-event deep-dives (e.g., explaining a >25% IMF PortWatch transit drop or cross-verifying a candidate `RED` alert before firing emails). Never use paid search APIs for broad cron discovery.

---

## 2. Data Sources Across All 5 Disruption Categories (v1 €0/mo Stack)

### Category 1: Geopolitical & Sanctions
| Source | Access | Format & Geo | Stage |
| :--- | :--- | :--- | :--- |
| **EU Financial Sanctions Files (FSF)** | Free XML/CSV/RSS | XML/CSV + ISO-2 country codes | Stage 1 (Deterministic) |
| **OFAC Consolidated & SDN Lists** | Free HTTPS XML/CSV | XML/CSV + ISO country + vessel IMOs | Stage 1 (Deterministic) |
| **EU TARIC / EUR-Lex RSS** | Free XML/RSS | Origin ISO-2 + CN/HS codes | Stage 1 (Deterministic) |
| **GDELT 2.0 DOC API** | Free REST JSON/GeoJSON | CAMEO codes + lat/lng + country | Stage 2 (Filtered + LLM) |

### Category 2: Maritime & Logistics Chokepoints
| Source | Access | Format & Geo | Stage |
| :--- | :--- | :--- | :--- |
| **IMF / Oxford PortWatch (ArcGIS API)** | Free ArcGIS GeoJSON | Native GeoJSON; 28 global chokepoints & 2,065 ports (7-day transit drops) | Stage 1 (Deterministic) |
| **Fintraffic Digitraffic Marine (Baltic)** | Free REST JSON/GeoJSON | Baltic port calls, ETA delays, icebreaker/NAVTEX | Stage 1 (Deterministic) |
| **Danish Maritime Authority (Niord API)** | Free REST JSON/GeoJSON | Baltic Sea, Kattegat, Great Belt, Øresund polygons | Stage 1 (Deterministic) |
| **NGA Maritime Safety Information (MSI)** | Free REST JSON | Global NAVAREA warnings (Red Sea, Hormuz, Malacca, Channel) | Stage 1 (Deterministic) |
| **Carrier Advisories (Maersk, Hapag-Lloyd)** | Free RSS / Cheerio | UN/LOCODE port advisories | Stage 2 (LLM) |

### Category 3: Extreme Weather & Natural Disasters
| Source | Access | Format & Geo | Stage |
| :--- | :--- | :--- | :--- |
| **GDACS (UN / EC JRC)** | Free REST GeoJSON + CAP | Native GeoJSON polygons + `Red`/`Orange`/`Green` | Stage 1 (Deterministic) |
| **MeteoAlarm (EUMETNET)** | Free Atom / CAP 1.2 XML | Explicit `<polygon>` rings for 38 EU/Baltic agencies (incl. EE/LV/LT) | Stage 1 (Deterministic) |
| **USGS Earthquake Hazards API** | Free REST GeoJSON | Point + magnitude buffer → WKT polygon | Stage 1 (Deterministic) |
| **ReliefWeb Disasters API (UN OCHA)** | Free REST JSON | GLIDE IDs + `alert`/`ongoing`/`past` lifecycle tracker | Stage 1 (Deterministic) |

### Category 4: Labor & Industrial Disruptions
| Source | Access | Format & Geo | Stage |
| :--- | :--- | :--- | :--- |
| **ENTSO-E / Nord Pool UMM** | Free REST XML/JSON | Bidding zones (`EE`, `LV`, `LT`, `FI`, `SE`, `DE-LU`, `PL`) & interconnectors | Stage 1 (Deterministic) |
| **ITF & ETF Transport Union RSS** | Free RSS 2.0 | Dockworker, rail, and freight union actions | Stage 2 (LLM) |
| **GDELT DOC 2.0 + Google News RSS** | Free REST / RSS | Deduplicated union of active corridors & union keywords | Stage 2 (LLM) |

### Category 5: Cyber & Financial Distress
| Source | Access | Format & Geo | Stage |
| :--- | :--- | :--- | :--- |
| **Estonia `Ametlikud Teadaanded` (RIK)** | Free XML/RSS | Bankruptcy/liquidation notices (`registrikood`, `EE`) | Stage 1 (Deterministic) |
| **Latvia `data.gov.lv` Insolvency Register** | Free CKAN CSV/JSON | Official insolvency proceedings (`LV`) | Stage 1 (Deterministic) |
| **Lithuania `data.gov.lt` / AVNT** | Free REST/CSV | Bankruptcy & restructuring proceedings (`LT`) | Stage 1 (Deterministic) |
| **CERT-EE (RIA), CERT.LV, NKSC.LT, CERT-EU** | Free RSS/Atom | Regional cyber/logistics infrastructure advisories | Stage 2 (LLM) |
| **Ransomlook.io (`/api/recent`)** | Free REST JSON | Verified ransomware victim domains & sectors | Stage 2 (LLM / Match) |

---

## 3. Canonical Global & European Chokepoint Registry

Defined as pure, zero-I/O WKT bounding polygons and corridor route-matching rules in `packages/engine/src/chokepoints.ts`:
- **Global Maritime:** `SUEZ_CANAL`, `RED_SEA_BAB_EL_MANDEB`, `PANAMA_CANAL`, `MALACCA_STRAIT`, `STRAIT_OF_HORMUZ`, `BOSPORUS_STRAIT`
- **European & Baltic Maritime:** `BALTIC_SEA`, `DANISH_STRAITS`, `NORTH_SEA`, `ENGLISH_CHANNEL`
- **European Overland / Rail Corridors:** `ALPINE_BRENNER_CORRIDOR`, `ALPINE_GOTTHARD_CORRIDOR`, `RHINE_VALLEY_CORRIDOR`, `BALTIC_VIA_BALTICA_CORRIDOR`, `EU_EASTERN_BORDER_CORRIDOR`

---

## 4. Stage 2 Semantic Classifier & Deduplication Strategy

- **Pre-Filter (Zero Tokens):** Drop already-seen URLs (SHA-256) and near-duplicate titles (Jaccard trigram similarity ≥ 0.75 over a 72h window).
- **Batched Extraction:** Send 10–15 candidate snippets per `generateObject()` call, returning strict Zod-validated `ExtractedRiskSignal` items (`kind`, `severity`, `verificationStatus`, `lifecycle`, `title`, `summary`, `affectedCountryCodes`, `affectedChokepoints`, `affectedSectors`, `sourceUrl`, `publishedAt`, `confidence`).
- **Canonical Deduplication Key:** `sha256(kind + ":" + canonicalLocationOrChokepoint + ":" + isoYearWeek)` so multiple reports of the same strike or canal blockage merge into **one** `RiskSignal` vertex with appended `sourceUrls` and promoted `verificationStatus` (`ALLEGED` → `CORROBORATED`).

---

## 5. Cost Model (10 / 100 / 1,000 Organizations)

| Component | 10 Orgs (MVP) | 100 Orgs (Growth) | 1,000 Orgs (Scale) |
| :--- | :--- | :--- | :--- |
| **Stage 1 Structured Feeds** | €0 | €0 | €0 *(optional +€845/mo for commercial OpenSanctions + ACLED)* |
| **Stage 2b Deep-Dive Search** | €0 (Tavily 1k/mo + Exa €10 credit) | ~€14/mo (Exa PAYG) | ~€95/mo (Exa/Tavily Growth) |
| **AI API Centre (Batched LLM)** | €0 (Gemini + Groq Free) | ~€1–€3/mo (Gemini Flash-Lite) | ~€10–€25/mo (Gemini + OpenAI fallback) |
| **Email & Webhooks** | €0 (Resend 3k/mo + Brevo 9k/mo) | ~€18.50/mo (Resend Pro EU) | ~€3–€50/mo (Amazon SES `eu-north-1` or Postmark) |
| **Total Monthly Spend** | **€0.00 / mo** | **~€33 – €36 / mo** | **~€110 / mo** *(core stack)* |
