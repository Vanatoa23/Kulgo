# Kulgo Business Registry Enrichment, Transactional Outreach & Product Catalogue Taxonomy (Phase 0)

> **Status:** Approved & Finalized (Phase 0 of GitHub Issue #29 / [`SUBPROJECT_5_SUPPLIER_ONBOARDING_CATALOGUE_REGISTRY.md`](../specs/SUBPROJECT_5_SUPPLIER_ONBOARDING_CATALOGUE_REGISTRY.md))  
> **Scope:** Public business registry ingestion and lookup strategy (Estonia, Nordics & Baltics, EU/Global), transactional email & anti-spam architecture, and the v1 Kulgo Standardized Material/Product Taxonomy powering `"See alternatives (x)"` and GHG Protocol Scope 3 Category 1 PCF attribution.  
> **Privacy & Isolation Baseline:** Strictly adheres to [`docs/PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md) and [`docs/REGISTRY_SNAPSHOTS.md`](../REGISTRY_SNAPSHOTS.md). Tenant-entered supplier names are never leaked to external registry APIs, and public catalogue/directory profiles never reveal existing buyers, private supply links, or Tier-2+ upstream suppliers.

---

## 1. Public Business Registry APIs & Open Datasets

### 1.1 Architectural Principle: Snapshot-First Privacy & Separation of Facts

When a buyer adds a supplier in Kulgo (via the Quick Form or Excel/CSV import), the supplier's name is confidential commercial intelligence: revealing to a third-party SaaS registry API that `Org A` just searched for `Supplier X` leaks `Org A`'s private supply-chain graph.

To prevent this metadata leakage, Kulgo adopts a **snapshot-first, local-lookup architecture** (already implemented for Estonia in [`docs/REGISTRY_SNAPSHOTS.md`](../REGISTRY_SNAPSHOTS.md), `apps/api/src/registry/`, and `packages/shared/src/registry.ts`):

1. **Zero Outbound Tenant Queries for Snapshot-Backed Registries:** Kulgo downloads open bulk registry snapshots out-of-band (daily/weekly cron) and indexes them locally on disk (`FileRegistrySnapshotStore`). Searches via `POST /api/v1/workspace/company-registry/search` run entirely server-side against the local snapshot so tenant supplier names never leave Kulgo's infrastructure.
2. **Strict Field Minimization:** Snapshot parsers extract only non-personal corporate identifiers (legal name, official registry code, country, corporate status, and—where legally published as corporate metadata—registered seat/NACE code). Personal data of natural-person directors/shareholders is dropped at parse time.
3. **Separation of Facts:** Registry matching (`CONCLUSIVE_MATCH` vs. `CANDIDATES`), public directory opt-in (`openToNewBuyers`), and supply-relationship confirmation (`VERIFIED_PARTNER_LINK`) remain strictly separate facts. A client-supplied `registryCode` never verifies a partner relationship on its own.
4. **Pluggable `BusinessRegistryService` Adapter Pattern:** Country adapters implement a common `CompanyRegistrySearchService` interface (`apps/api/src/registry/service.ts`). Snapshot-backed adapters (EE, LV, LT, GLEIF) run with zero network I/O per tenant search; live API adapters (FI PRH/YTJ, SE Bolagsverket, EU BRIS) are gated behind explicit opt-in or server-side bulk caching/proxying without tenant attribution.

---

### 1.2 Regional & Global Registry Analysis

#### Estonia — e-Business Register (*Äriregister*, RIK) *(v1 Production Baseline)*
- **Operator:** Centre of Registers and Information Systems (*Registrite ja Infosüsteemide Keskus*, RIK).
- **Open Data Portal:** `https://avaandmed.ariregister.rik.ee/en/downloading-open-data`
- **Primary Snapshot (Already Implemented):** Daily basic-data CSV archive (`ettevotja_rekvisiidid__lihtandmed.csv.zip`), UTF-8 semicolon-delimited, refreshed once daily under **CC BY 4.0** (attribution to RIK required).
  - Currently parsed in `apps/api/src/registry/snapshot.ts` for `nimi` (legal name), `ariregistri_kood` (8-digit registry code), and `ettevotja_staatus` (`R` → `ACTIVE`; `L`/`N`/other → `INACTIVE`).
  - Configured via `EE_REGISTRY_SNAPSHOT_PATH` with atomic file-replace hot-reloading (mtime/size check; graceful `SNAPSHOT_UNAVAILABLE` fallback so ordinary workspace operations are never disrupted).
- **Extended Bulk Datasets & XML/JSON APIs:**
  - RIK also publishes daily general-data JSON/XML dumps (`ettevotja_rekvisiidid__yldandmed.json.zip`) containing registered address, EMTAK/NACE activity codes, and public corporate contact channels (including official corporate email addresses where registered under the Estonian Commercial Code, § 63¹).
  - RIK offers SOAP/XML (`ariregxmlv6`) and X-Road (*X-tee*) services for real-time queries, requiring a RIK contract/IP allowlist and incurring per-query fees for non-public fields.
- **Why Kulgo Uses the Local Snapshot:** Zero per-request cost, sub-millisecond local matching, zero rate-limit risk during bulk Excel/CSV onboarding, and **complete privacy** — tenant supplier names are never transmitted to RIK or any third party.

#### Nordics & Baltics

1. **Finland — PRH / YTJ Open Data API (*Patentti- ja rekisterihallitus* / Business Information System)**
   - **Endpoints:** Free public REST JSON API (`https://avoindata.prh.fi/opendata-ytj-api/v3/companies`), plus bulk JSON snapshots for Finnish Business IDs (*Y-tunnus*).
   - **Data Coverage:** Official name, Business ID (`1234567-8`), registration/liquidation status, registered municipality/address, TOL 2008 / NACE main business line, and website URL.
   - **Limitations:** Corporate email addresses are **not** exposed in the public YTJ Open Data API (contact details are largely restricted to postal address and optional website). Rate-limited to ~300 requests/minute per IP; bulk nightly mirror is preferred over per-tenant live lookups.
   - **Licence:** CC BY 4.0 (PRH).

2. **Sweden — Bolagsverket (*Swedish Companies Registration Office*)**
   - **Access Model:** Bolagsverket provides the *Värdefulla datamängder* (High-Value Datasets) REST API (OAuth 2.0 client credentials, free registration via `portal.api.bolagsverket.se`) under the EU Open Data Directive, alongside commercial paid APIs (*Företagsinformation*) for deeper filings.
   - **Data Coverage:** Corporate name, 10-digit organization number (*organisationsnummer*), legal form, active/deregistered status, postal address, and SNI/NACE codes.
   - **Limitations:** Public contact emails are **not** included in Bolagsverket's open dataset. Live API requires OAuth token management and respects strict per-client quotas. For Kulgo v1.x, Sweden is best served via periodic bulk sync or GLEIF cross-reference for exporting manufacturers.
   - **Licence:** CC0 1.0 / EU High-Value Dataset open terms (attribution recommended).

3. **Latvia — Enterprise Register (*Uzņēmumu reģistrs*, UR) & Lursoft**
   - **Open Data (UR via `data.gov.lv`):** Free daily CSV/JSON bulk dumps (`register.csv`, `address.csv`, etc.) published directly by the Register of Enterprises of the Republic of Latvia under **CC0 1.0**.
   - **Data Coverage:** Legal name, 11-digit registration number (`reģistrācijas numurs`), legal form, status, registered address, and SEPA/insolvency cross-links (already referenced for insolvency feeds in [`LIVE_DISRUPTION_FEEDS_AND_ARCHITECTURE.md`](./LIVE_DISRUPTION_FEEDS_AND_ARCHITECTURE.md)).
   - **Lursoft:** Commercial value-added aggregator offering paid REST APIs with historical financials and contact enrichment; **not** needed for v1 given UR's free daily CC0 bulk snapshots.
   - **Limitations:** UR open CSVs do not expose corporate email addresses; ideal for local snapshot indexing (identical architecture to Estonia).

4. **Lithuania — Registrų Centras (*State Enterprise Centre of Registers*)**
   - **Open Data (`data.gov.lt` / `registrucentras.lt`):** Free monthly/daily open CSV/JSON datasets of Legal Entities (*Juridinių asmenų registras*, JAR) published on the Lithuanian Open Data Portal (`data.gov.lt`) under **CC BY 4.0**.
   - **Data Coverage:** Legal name, 9-digit legal entity code (*juridinio asmens kodas*), legal form, status, registered address, and EVRK/NACE codes (via linked open datasets).
   - **Commercial API:** Registrų Centras offers paid SOAP/REST services for real-time extracts.
   - **Limitations:** Contact emails are **not** included in the JAR open CSV dump. Well-suited for Kulgo's local snapshot architecture.

#### EU & Global

1. **EU BRIS (Business Registers Interconnection System)**
   - **Access Model:** Operated by the European Commission via the European e-Justice Portal (`e-justice.europa.eu`), interconnecting all EU/EEA national business registers using EUID identifiers.
   - **Limitations:** No open public bulk dump or unauthenticated developer REST API for third-party SaaS apps; designed primarily for cross-border official/judicial exchange and human web search via e-Justice. Useful as a reference identifier standard (`EUID`), not as a v1 programmatic ingestion source.

2. **GLEIF (Global Legal Entity Identifier Foundation) API & Golden Copy Files**
   - **Access Model:** Free, unauthenticated REST JSON:API (`https://api.gleif.org/api/v1/lei-records`) **and** free daily "Golden Copy" bulk JSON/XML/CSV files (`https://www.gleif.org/en/lei-data/gleif-golden-copy`) under **CC0 1.0**.
   - **Data Coverage:** 20-character ISO 17442 LEI, official legal name, legal & HQ addresses, registration authority + local registry ID (`RegistrationAuthorityEntityID`), entity status, and corporate parent relationships (Level 2 data). Covers ~2.7M+ global entities (strong coverage for mid-to-large EU/global exporters, financial entities, and CBAM/CSRD-regulated manufacturers).
   - **Rate Limits:** Live API allows 60 requests/minute per IP; Golden Copy bulk download has no per-query rate limit and enables 100% local privacy-preserving lookup.
   - **Limitations:** No contact emails; smaller SMEs without capital-market or customs LEI mandates may not hold an LEI.

3. **OpenCorporates**
   - **Access Model:** Commercial REST API (`api.opencorporates.com`) aggregating 140+ jurisdictions. Free/open-data tier is strictly restricted to non-commercial public-benefit/journalism use; commercial SaaS usage requires a paid API key/enterprise licence.
   - **Data Coverage:** Company name, company number, jurisdiction, status, registered address, officers (jurisdiction-dependent).
   - **Limitations:** Paid commercial licensing, strict rate limits by plan, no corporate email addresses, and **privacy conflict** (live lookups send tenant supplier names to an external vendor). Deferred/excluded for v1.

---

### 1.3 Registry Comparison Matrix

| Registry / Source | Scope | Access Model | Rate Limits / Refresh | Licence | Public Contact Email? | Kulgo Strategy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Estonia Äriregister (RIK)** | `EE` | Bulk CSV/JSON snapshot (primary); paid XML/X-Road | Daily dump; unlimited local queries | CC BY 4.0 (RIK attribution) | **Yes** (in `yldandmed` general data dump; excluded from `lihtandmed` basic CSV) | **v1 Live** — Local snapshot (`apps/api/src/registry/`) |
| **Finland PRH / YTJ** | `FI` | Free REST JSON API + bulk JSON | ~300 req/min (API); daily bulk | CC BY 4.0 (PRH) | No (postal address + optional website only) | **v1.1** — Local bulk snapshot mirror |
| **Sweden Bolagsverket** | `SE` | Free HVD OAuth REST API; paid commercial API | Per-client OAuth quota | CC0 1.0 / EU HVD | No | **v1.2** — Cached/bulk sync or GLEIF fallback |
| **Latvia UR (`data.gov.lv`)** | `LV` | Free bulk CSV/JSON snapshot | Daily dump; unlimited local queries | CC0 1.0 | No | **v1.1** — Local snapshot adapter |
| **Lithuania Registrų Centras (`data.gov.lt`)** | `LT` | Free bulk CSV/JSON snapshot; paid SOAP/REST | Daily/monthly dump; unlimited local queries | CC BY 4.0 | No | **v1.1** — Local snapshot adapter |
| **EU BRIS** | `EU/EEA` | Web portal (e-Justice); no public SaaS REST API | N/A (not programmatic for SaaS) | EU Public Sector | No | **Reference only** (EUID schema compatibility) |
| **GLEIF (LEI)** | Global | Free daily Golden Copy bulk files + REST JSON:API | Daily bulk (unlimited local); 60 req/min (API) | CC0 1.0 | No | **v1.1** — Local Golden Copy snapshot for global/LEI lookup |
| **OpenCorporates** | Global (140+ juris.) | Commercial REST API (paid for SaaS) | Plan-tiered (strict) | Proprietary / Paid Commercial | No | **Excluded for v1** (cost + privacy leak of tenant queries) |

---

### 1.4 GDPR Lawful Basis & Compliance for B2B Registry Enrichment & Outreach

When Kulgo resolves a supplier's corporate contact email (either buyer-supplied during onboarding or sourced from a public statutory register such as Estonia's Äriregister general dataset) and dispatches an automated invitation email:

1. **Lawful Basis — GDPR Art. 6(1)(f) (Legitimate Interest):**
   - **Purpose:** B2B supply-chain verification, statutory resilience/ESG due diligence (CSRD / CSDDD / CBAM readiness), and two-sided facility reconciliation initiated by an existing commercial buyer (`Org A`) who already has a business relationship with the supplier (`Org B`).
   - **Balancing Test (Legitimate Interest Assessment — LIA):**
     - *Necessity:* Automated outreach is strictly triggered by a buyer's explicit addition of a Tier-1 supplier—never bulk cold-prospecting or scraping unrelated businesses.
     - *Data Minimization:* Only corporate/role-based contact emails (e.g., `info@`, `sales@`, `orders@`, or buyer-provided B2B contact) are used. Personal emails of natural-person board members are never harvested from registry dumps.
     - *Transparency (GDPR Art. 14):* Every automated invitation email clearly states (a) which buyer organization initiated the verification request (or that a customer on Kulgo invited them), (b) the data source (buyer-provided or public Estonian e-Business Register), (c) a link to Kulgo's privacy notice, and (d) how to object immediately.
2. **Right to Object — GDPR Art. 21 & ePrivacy B2B Opt-Out:**
   - Every outreach email includes a **1-click unsubscribe / objection link** (both visible in the email footer and machine-readable via RFC 8058 `List-Unsubscribe` headers).
   - Exercising opt-out immediately adds the email address to Kulgo's global `EmailSuppression` list, permanently blocking all future automated invitations or intro requests across **all** tenant organizations.
3. **Attribution Compliance (CC BY 4.0):**
   - Whenever Estonian Äriregister data (or FI/LT CC BY 4.0 datasets) is displayed in the UI or API response, Kulgo attaches the canonical source attribution object (`EE_COMPANY_REGISTRY_SOURCE` in `packages/shared/src/registry.ts`).

---

## 2. Transactional Email Providers & Anti-Spam Guardrails

### 2.1 Existing Kulgo Email Architecture

Kulgo already implements a provider-agnostic `EmailProvider` interface in [`apps/api/src/intelligence/notifications.ts`](../../apps/api/src/intelligence/notifications.ts):

- `OutboundEmailMessage` (`from`, `to`, `subject`, `text`, `html`, `idempotencyKey?`) — will be extended in Phase 1/2 with optional `headers?: Record<string, string>` to support RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
- **Built-in Providers:**
  - `createResendEmailProvider(apiKey)` — calls `https://api.resend.com/emails` with native `Idempotency-Key` header support.
  - `createBrevoEmailProvider(apiKey)` — calls `https://api.brevo.com/v3/smtp/email`.
  - `InMemoryCaptureEmailProvider` — deterministic in-memory capture used in unit/integration/privacy tests.
- **Proven Outbox Pattern:** `dispatchInstantRedAlerts()` already uses an atomic claim-before-send outbox pattern (`claimDelivery` → `provider.send` → `recordDelivery`) to guarantee at-most-once delivery under concurrency. Supplier onboarding outreach and intro requests will follow this exact same outbox discipline.

### 2.2 Provider Evaluation Matrix

| Provider | Free / Entry Tier | Pricing at Scale (50k emails/mo) | EU Data Residency | Bounce / Complaint Webhooks | Custom Headers (RFC 8058) | Idempotency Key | Fit for Kulgo |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Resend** *(Already Integrated)* | 3,000 emails/mo (100/day) | ~$20/mo (Pro) | **Yes** (`eu-west-1` Ireland) | Svix-signed JSON webhooks (`email.bounced`, `email.complained`) | Yes (`headers` object) | **Native** (`Idempotency-Key`) | **Primary (MVP & Growth)** — zero extra dependency, native idempotency, EU region, clean DX. |
| **Brevo** *(Already Integrated)* | 300 emails/day (~9,000/mo) | ~$15–$25/mo | **Yes** (EU/France native, GDPR-first) | JSON webhooks (`hard_bounce`, `spam`, `unsubscribed`) | Yes (`headers` object) | No native header (app-level dedupe required) | **Secondary / Fallback** — already wired in `notifications.ts`; strong EU/GDPR posture. |
| **Postmark** | 100 emails/mo (dev only) | ~$55/mo | US-primary (DPA/SCCs) | Real-time JSON webhooks (`Bounce`, `SpamComplaint`), separate Message Streams | Yes (`Headers` array) | No native header | **High-deliverability alternative** — excellent inbox placement & stream separation (transactional vs. outreach), but higher cost and non-EU primary hosting. |
| **AWS SES** | 3,000/mo (12-mo free tier) | **~$5.00/mo** ($0.10 / 1k) | **Yes** (`eu-north-1` Stockholm / `eu-central-1` Frankfurt) | Amazon SNS notifications (Bounce, Complaint, Delivery) + account-level suppression | Yes (SES v2 `Raw` or MIME headers) | No native header | **Scale Tier (1,000+ orgs)** — unbeatable unit economics in `eu-north-1` (closest to Baltics/Nordics), requires SNS/IAM setup. |
| **Generic SMTP** (Nodemailer / self-hosted) | Self-hosted | Variable (IP reputation overhead) | Operator-controlled | Manual DSN/ARF parsing (fragile) | Yes (raw MIME) | None | **On-Prem / Escape Hatch Only** — poor deliverability & bounce telemetry compared to API providers; avoid for cloud SaaS. |

**Decision:** Keep **Resend (EU region)** as primary and **Brevo** as fallback via the existing `EmailProvider` abstraction in `apps/api/src/intelligence/notifications.ts`, adding `headers?: Record<string, string>` to `OutboundEmailMessage`. Defer AWS SES (`eu-north-1`) adapter until outbound volume exceeds ~50k emails/month.

---

### 2.3 Mandatory Anti-Spam, Deliverability & Compliance Guardrails

Automated B2B outreach risks domain reputation damage if unchecked. Kulgo enforces **six mandatory guardrails** before any onboarding invite or intro email is handed to `EmailProvider.send()`:

1. **Global `EmailSuppression` List (ArcadeDB Vertex):**
   - Stores normalized lowercase email addresses (indexed uniquely on `emailNormalized`) with `reason` (`UNSUBSCRIBED` | `HARD_BOUNCE` | `SPAM_COMPLAINT` | `ADMIN_BLOCKED`), `source` (`ONE_CLICK_LINK` | `WEBHOOK_RESEND` | `WEBHOOK_BREVO` | `MANUAL`), and `suppressedAt`.
   - Checked synchronously before every outreach or intro dispatch; suppressed addresses are skipped silently (status `SKIPPED_SUPPRESSED`) and never retried.
2. **RFC 8058 1-Click Unsubscribe (`List-Unsubscribe`):**
   - Every automated outreach and intro email includes:
     - `List-Unsubscribe: <https://<app-domain>/api/v1/public/email-suppression/unsubscribe?token=<hmacToken>>`
     - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
   - Supports both `POST` (automated mail-client RFC 8058 one-click POST without user interaction) and `GET` (human-clicked footer link rendering a clean confirmation page).
3. **HMAC-Signed Suppression Tokens (Tamper-Proof & Stateless):**
   - Token format: `base64url(payloadJson) + "." + hmacSha256Hex(payloadJson, EMAIL_SUPPRESSION_SECRET)` where `payloadJson` contains `{ email: normalizedEmail, purpose: "SUPPRESS_OUTREACH", iat: unixSeconds }` (reusing the same `node:crypto` `createHmac("sha256", ...)` pattern as `signWebhookPayload` in `notifications.ts`, verified with `timingSafeEqual`).
   - Suppression tokens have **no short expiry** (valid for at least 180 days so recipients can opt out months later) and are strictly decoupled from invitation acceptance tokens.
4. **Bounce & Complaint Webhook Ingestion:**
   - Dedicated signed webhook endpoint (`POST /api/v1/webhooks/email-events/:provider`) verifies provider signatures (Resend/Svix HMAC or Brevo secret) and automatically inserts `HARD_BOUNCE` and `SPAM_COMPLAINT` recipients into `EmailSuppression`.
   - Soft bounces are logged without permanent suppression; 3 consecutive soft bounces within 14 days promote to `EmailSuppression`.
5. **Per-Org Deduplication & Atomic Outbox:**
   - **Never email the same supplier twice for the same buyer org:** Before dispatching an automatic onboarding invite, Kulgo checks for an existing `PENDING` or `ACCEPTED` invite (or prior outreach record) for the `(buyerOrgId, recipientEmailNormalized)` tuple.
   - Uses atomic claim-before-send + `Idempotency-Key` (`sha256(JSON.stringify([buyerOrgId, supplierFacilityId, recipientEmailNormalized, "SUPPLIER_INVITE"]))`) so concurrent Excel/CSV uploads or retries cannot double-send.
6. **Rate Limiting & Audit Logging:**
   - **Per-Org Cap:** Max **25 automated outreach emails per org per hour** and **100 per org per 24 hours** (bulk CSV imports exceeding the cap queue or require manual batch confirmation rather than blasting immediately).
   - **Global Cap:** Max **500 automated outreach emails per hour** platform-wide (circuit breaker against compromised tenant accounts).
   - **Audit Trail:** Every dispatched invite records an `INVITE_CREATED` audit event (`packages/shared/src/auth.ts`) with `orgId`, `facilityId`, `recipientDomain` / masked recipient, and `inviteId` — **never storing raw invite tokens** in logs or audit tables (only SHA-256 token hashes are persisted).
   - **DNS Authentication Prerequisite:** Production sending domain must enforce SPF, DKIM (2048-bit), and DMARC (`p=quarantine` progressing to `p=reject`), using a dedicated subdomain (e.g., `network.kulgo.io`) isolated from corporate email.

---

## 3. v1 Kulgo Standardized Material/Product Taxonomy

### 3.1 Design Goals

Free-text supplier descriptions (e.g., `"6061-T6 Alu profile"`, `"extruded aluminum bar"`, `"alumiiniumprofiil"`) break exact-string matching and prevent reliable `"See alternatives (x)"` discovery or Scope 3 Category 1 PCF comparison. At the same time, forcing SMEs to browse all ~5,300 6-digit HS codes creates unacceptable onboarding friction.

Kulgo v1 therefore defines **20 standardized manufacturing categories** anchored to canonical **4-digit HS headings** and representative **6-digit EU Combined Nomenclature (CN) codes**, paired with Kulgo's existing `VolumeUnitSchema` (`UNITS` | `TONNES` | `KG` | `LITERS` | `EUR_VALUE`) and `UnitFamilySchema` (`MASS` | `COUNT` | `VOLUME`) in [`packages/shared/src/network.ts`](../../packages/shared/src/network.ts).

---

### 3.2 v1 Standardized Manufacturing Categories (20 Canonical Codes)

| # | Category Code | Display Name | HS (4-digit) | CN (6-digit) | Canonical `baseUnit` | `unitFamily` | Example Materials / Keywords |
| :-: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | `ALUMINUM_EXTRUSIONS` | Aluminum Extrusions | `7604` | `760429` | `TONNES` | `MASS` | 6061/6063 alloy profiles, anodized bars, structural frames |
| 2 | `RAW_STEEL` | Raw & Cold-Rolled Steel | `7209` | `720916` | `TONNES` | `MASS` | Cold-rolled coils, sheet steel, S235/S355 flat products |
| 3 | `STEEL_FASTENERS` | Steel Fasteners & Hardware | `7318` | `731815` | `KG` | `MASS` | Bolts, screws, nuts, rivets, stainless M-series hardware |
| 4 | `COPPER_WIRING` | Copper Wiring & Harnesses | `8544` | `854442` | `KG` | `MASS` | Insulated copper cables, wire harnesses, busbar leads |
| 5 | `PCB_ASSEMBLY` | PCB Assembly & Electronics | `8534` | `853400` | `UNITS` | `COUNT` | SMT/THT PCBA, multilayer rigid/flex circuit boards |
| 6 | `SEMICONDUCTOR_SUBSTRATES` | Semiconductor Substrates & Wafers | `3818` | `381800` | `UNITS` | `COUNT` | Silicon wafers, SiC/GaN substrates, doped discs |
| 7 | `POWER_ELECTRONICS` | Power Control & Electronics Modules | `8504` | `850440` | `UNITS` | `COUNT` | Inverters, DC-DC converters, rectifiers, IGBT power stages |
| 8 | `INDUSTRIAL_SENSORS` | Industrial Sensors & Actuators | `9031` | `903180` | `UNITS` | `COUNT` | Pressure/temp/proximity sensors, MEMS, industrial transducers |
| 9 | `LITHIUM_ION_CELLS` | Lithium-Ion Battery Cells | `8507` | `850760` | `UNITS` | `COUNT` | Cylindrical 21700/18650, prismatic LFP/NMC pouch cells |
| 10 | `BATTERY_PACK_ASSEMBLY` | Battery Pack Assembly & BMS | `8507` | `850760` | `UNITS` | `COUNT` | Integrated battery packs, modules, BMS enclosures |
| 11 | `THERMAL_MANAGEMENT` | Thermal Management Systems | `8419` | `841950` | `UNITS` | `COUNT` | Heat exchangers, cold plates, liquid cooling manifolds, heatsinks |
| 12 | `INDUSTRIAL_POLYMERS` | Industrial Polymers & Resins | `3901` | `390110` | `TONNES` | `MASS` | HDPE/LDPE/PP/PA66 pellets, engineering thermoplastic granules |
| 13 | `INJECTION_MOLDING` | Precision Injection Molding | `3926` | `392690` | `UNITS` | `COUNT` | Custom molded housings, connectors, technical plastic parts |
| 14 | `PRECISION_CNC_MACHINING` | Precision CNC Machining | `8483` | `848390` | `UNITS` | `COUNT` | 5-axis milled shafts, housings, gears, turned metal parts |
| 15 | `ELECTRIC_MOTORS` | Electric Motors & Drives | `8501` | `850152` | `UNITS` | `COUNT` | Brushless DC/AC traction motors, servo drives, stators |
| 16 | `HYDRAULIC_COMPONENTS` | Hydraulic & Pneumatic Components | `8412` | `841221` | `UNITS` | `COUNT` | Hydraulic cylinders, actuators, valves, pneumatic manifolds |
| 17 | `COMPOSITE_MATERIALS` | Carbon & Glass Composite Materials | `6815` | `681511` | `KG` | `MASS` | Carbon fiber prepreg, CFRP laminates, fiberglass roving |
| 18 | `INDUSTRIAL_COATINGS` | Industrial Coatings & Adhesives | `3208` | `320890` | `LITERS` | `VOLUME` | Powder/epoxy coatings, structural adhesives, industrial primers |
| 19 | `OPTICAL_COMPONENTS` | Optical Lenses & Assemblies | `9001` | `900190` | `UNITS` | `COUNT` | Precision glass lenses, prisms, optical filters, LiDAR windows |
| 20 | `PACKAGING_CORRUGATED` | Industrial Packaging & Corrugated | `4819` | `481910` | `TONNES` | `MASS` | Corrugated cartons, export crates, protective fiberboard |

> **Note on Dual-Category HS 8507 (`LITHIUM_ION_CELLS` vs. `BATTERY_PACK_ASSEMBLY`):** Both map to HS `8507` / CN `850760` because EU customs classifies both individual lithium-ion cells and assembled battery packs under `8507 60 00`. Separating them in Kulgo's taxonomy prevents matching a raw cell manufacturer against a downstream BMS pack integrator.

---

### 3.3 Hybrid Matching Strategy (`"See alternatives (x)"`)

When a buyer opens the Node Inspector Drawer for a supplier facility (`GET /api/v1/directory/alternatives/for-facility/:facilityId`), Kulgo computes the live alternative count `x` and ranked candidate list using a deterministic, privacy-safe **3-tier hybrid matching pipeline**:

1. **Eligibility & Privacy Filter (Hard Gate):**
   - Only organizations with `openToNewBuyers = true` and active `CatalogueItem` vertices are eligible.
   - Strictly excludes (a) the buyer's own `orgId` and (b) the currently inspected supplier's linked `orgId` (if Network-Verified) or exact matched registry ID.
   - **Zero Private Graph Leakage:** Matching reads **only** the buyer's own `SupplyInput` / `SUPPLIES_LANE` metadata (on the buyer side) and the candidate's self-declared public `CatalogueItem` + public org profile (on the candidate side). Candidate responses never expose existing buyers, private links, capacity utilization, or Tier-2+ upstream suppliers (`PRIVACY_CONTRACT.md`).

2. **Standardized Category & Unit-Family Compatibility (Primary Match):**
   - **Exact Category Match:** `candidate.categoryCode === buyerInput.categoryCode` (primary eligibility signal).
   - **HS-4 Prefix Fallback (Optional / Lower Score):** If `buyerInput` carries a `cnCode` without an explicit v1 category code, map the 4-digit HS prefix to the corresponding v1 category code(s).
   - **Compatible `unitFamily` Check:** Candidate `unitFamily` must match the buyer's `SupplyInput.unitFamily` (`MASS`, `COUNT`, or `VOLUME`). Within `MASS`, `KG` and `TONNES` are automatically normalized (`1 TONNES = 1,000 KG`) so a supplier quoting in `KG` cleanly matches a buyer demanding `TONNES` (and vice versa).

3. **Semantic Keyword / Tag Similarity & Multi-Factor Ranking:**
   - Within the category + `unitFamily` cohort, Kulgo computes a lightweight, deterministic **token Jaccard similarity** over normalized free-text `title`, `specs`, and `tags[]` (lowercased, diacritic-stripped, stop-words removed) so specialized matches (e.g., `"6061 anodized"` or `"LFP prismatic"`) rank above generic category listings.
   - **Composite Alternative Ranking Score** combines:
     - **Semantic Fit** (category match + tag/spec Jaccard similarity),
     - **Risk Posture** (live risk badge `GREEN` > `YELLOW` > `RED` from Kulgo's `RiskSignal` layer),
     - **Logistics & Transport CO2e Delta** (estimated great-circle/corridor distance and freight CO2e delta relative to the buyer's receiving facility vs. the incumbent supplier),
     - **ESG & Quality Readiness** (verified ISO 9001 / ISO 14001 / IATF 16949 certifications and availability of a verified PCF).
   - **1-Click What-If Handoff:** Because both sides share a compatible `unitFamily`, clicking **"Test in What-If Simulator"** can immediately pre-populate a 30%–100% volume shift without manual unit guesswork, computing live **Resilience Score**, **Expected Annual Loss (EAL)**, and **Transport CO2e** deltas.

---

### 3.4 GHG Protocol Scope 3 Category 1 PCF Integration

Each `CatalogueItem` optionally carries a supplier-declared Product Carbon Footprint:

- `productEmissionFactorTco2ePerUnit` (`number | null`, unit: **`tCO2e / baseUnit`**, matching the exact property name already used on `SupplyInput` and `SUPPLIES_LANE` in `packages/shared/src/network.ts` and `apps/api/src/db/schema.ts`).
- `pcfVerified` (`boolean`, default `false`) indicating third-party verification (e.g., ISO 14067 / PACT Pathfinder / EPD).

**Integration with Kulgo's Privacy-Safe Attribution Hierarchy (`PRIVACY_CONTRACT.md` §3):**
1. **Tier 1 (Highest Accuracy — Product/Volume-Based PCF):** When a supplier provides `productEmissionFactorTco2ePerUnit` in their catalogue (or reconciles it onto a `VERIFIED_PARTNER_LINK` / `SUPPLIES_LANE`), Kulgo computes attributed Scope 3 Category 1 emissions as:
   $$\text{Attributed Scope 3 Cat. 1 (tCO}_2\text{e)} = \text{purchasedVolume}_{\text{baseUnit}} \times \text{productEmissionFactorTco2ePerUnit}$$
   Unit conversions within `MASS` (`KG` ↔ `TONNES`) are applied deterministically prior to multiplication.
2. **Tier 2 (Economic Attribution Fallback):** If no product-level PCF is available on the catalogue item or lane, Kulgo falls back server-side to economic intensity (`buyerActiveSpendEur * (supplierTotalTco2e / supplierAnnualRevenueEur)`), keeping the supplier's total revenue strictly in memory on the server.
3. **Tier 3 (Sector Baseline Fallback):** If neither primary PCF nor verified partner financials exist, Kulgo applies the HS/CN category's sector emission factor baseline (see [`ESG_FACTOR_MATRIX_AND_COMPLIANCE.md`](./ESG_FACTOR_MATRIX_AND_COMPLIANCE.md)).
4. **Alternative Comparison Impact:** In the `"See alternatives (x)"` drawer and What-If Simulator, displaying both **Transport CO2e delta** and **Cradle-to-Gate PCF delta** (when `productEmissionFactorTco2ePerUnit` is present) lets buyers evaluate nearshoring vs. lower-carbon manufacturing trade-offs side by side.

---

## 4. Phase 1–3 Implementation Readiness Checklist

- **Phase 1 (`@kulgo/shared` + ArcadeDB schema):**
  - Export the 20-item `KULGO_MATERIAL_TAXONOMY` constant and `MaterialCategoryCodeSchema` enum in `packages/shared/src/` alongside `CatalogueItemSchema`, `RegistryEnrichmentResultSchema`, `AlternativeMatchSchema`, and `IntroRequestInputSchema` (all `.strict()`).
  - Add `CatalogueItem` and `EmailSuppression` vertex types and unique indexes (`EmailSuppression.emailNormalized`) in `apps/api/src/db/schema.ts`.
- **Phase 2 (`@kulgo/api`):**
  - Extend `OutboundEmailMessage` in `apps/api/src/intelligence/notifications.ts` with `headers?: Record<string, string>` for RFC 8058 `List-Unsubscribe`.
  - Build `OutreachService` enforcing `EmailSuppression`, HMAC-signed 1-click opt-out, per-org deduplication, rate limits, and `INVITE_CREATED` audit logging.
  - Extend `CompanyRegistrySearchService` (`apps/api/src/registry/service.ts`) for pluggable country adapters while preserving Estonia's local snapshot privacy guarantee.
  - Implement `/api/v1/directory/catalogue`, `/api/v1/directory/alternatives/for-facility/:facilityId`, and `/api/v1/directory/request-intro`, verified by `pnpm test:privacy`.
- **Phase 3 (`@kulgo/web`):**
  - Wire `.xlsx`/CSV onboarding, **My Public Product Catalogue** in Org Settings, and **`See alternatives (x)`** in the Node Inspector Drawer with 1-click What-If Simulator handoff and Request Intro.
