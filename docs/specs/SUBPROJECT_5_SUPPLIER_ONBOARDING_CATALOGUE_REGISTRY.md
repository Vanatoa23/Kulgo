# Sub-Project 5 Spec: Supplier Onboarding, Business Registry Enrichment, Product Catalogues & "See Alternatives (x)"

**Status:** Draft Spec (Ready for Research Phase)  
**Product Goal:** Create a self-reinforcing B2B network flywheel — buyers onboard suppliers in minutes (via Add New or Excel/CSV), Kulgo enriches company details from public business registries and automatically invites them, and suppliers join for free risk monitoring + **new buyer visibility** by uploading their **Product Catalogue**, powering **"See alternatives (x)"** directly inside every supplier node.  
**Architectural Constraints:** Must adhere strictly to [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md) (Directory & Catalogue listings expose **only** self-declared public capability/product info and **never** reveal existing buyers, private supply links, or Tier-2+ upstream suppliers).

---

## 1. Two-Path Supplier Onboarding (Add New vs. Excel/CSV)

When an organization onboards (or adds suppliers in the Network Hub — Sub-Project 4), it has two frictionless paths:

1. **Path A — "Add New" Quick Form:**
   - **Required:** `Supplier Name` (Level 0 minimum).
   - **Optional:** `Registry Code` (e.g., Estonian *registrikood*, VAT/LEI), `Country`, `Email`, `Product / Material Category`, `Location`, `Volume`, `Spend`.
   - **Commercial Layer Integration:** If optional `Volume` or `Spend` is entered during quick onboarding, Kulgo creates the physical `SUPPLIES_LANE` plus an initial Level-1 `ESTIMATE` contract (`Contract` + `ContractLine`), which is automatically replaced/archived when the buyer later adds their first formal `FRAMEWORK` contract (preventing double-counting per Sub-Project 2 Section 2).
2. **Path B — Structured Excel (`.xlsx`) / CSV Upload:**
   - Downloadable template with clear required (`supplier_name`) and optional columns (`registry_code`, `country_code`, `email`, `material_category`, `base_unit`, `annual_volume`, `annual_spend_eur`, `currency`, `contract_type`, `contract_end_date`, `warehouse_split`).
   - Validates rows with clear inline error feedback (extending existing `apps/api/src/workspace/import-export.ts`).

---

## 2. Business Registry Enrichment, Automated Outreach & Two-Sided Facility Reconciliation

1. **Public Business Registry Lookup:**
   - When a supplier is added with a `supplierName` (and optional `registryCode` / `countryCode`), Kulgo runs a background enrichment lookup against regional public business registries (starting with **Estonia e-Business Register / Äriregister**, plus EU BRIS / OpenCorporates / Nordic registries researched in Phase 0) to resolve:
     - Official legal name, registry code, registered HQ address/coordinates, NACE/sector code, and public contact email.
2. **Fully Automatic Background Outreach (with Anti-Spam Guardrails):**
   - Whenever a supplier is added and a valid contact email is provided or resolved from a registry, Kulgo **automatically** dispatches a clean, boilerplate invitation email in the background asking the supplier to:
     1. Confirm the supply relationship (upgrading the buyer's node to **Network-Verified**).
     2. Reconcile which specific production/distribution facility (`fulfilledByFacilityId`) fulfills the buyer's material (**Two-Sided Facility Reconciliation** per [`PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md); before reconciliation, Kulgo applies a conservative org-wide upstream fallback).
     3. Join Kulgo for free disruption monitoring and **opt-in buyer visibility** by uploading their Product Catalogue.
   - **Mandatory Guardrails:**
     - Strict deduplication: never email the same supplier twice for the same buyer org.
     - Global suppression / 1-click unsubscribe list (GDPR & anti-spam compliance).
     - Per-org and global outbound email rate limits, plus `INVITE_CREATED` audit logging (never storing raw invite tokens).

---

## 3. Supplier Product Catalogue & Hybrid Matching Taxonomy

To power accurate alternative matching without brittle exact-string lookups:

- **Hybrid Taxonomy + Free-Text:**
  - Suppliers who opt in (`openToNewBuyers = true`) can upload or edit their **Product Catalogue** (via form or Excel/CSV).
  - Each catalogue item includes:
    - **Standardized Category** (Kulgo standard material/product taxonomy mapped to HS/CN/UNSPSC codes, e.g., `Aluminum Extrusions`, `PCB Assembly`, `Lithium-Ion Cells`).
    - **Canonical Unit & Optional PCF:** `baseUnit` / `unitFamily` (`MASS` | `COUNT` | `VOLUME`) and optional verified Product Carbon Footprint (`productEmissionFactorTco2ePerUnit` in `tCO2e / baseUnit` for GHG Protocol Scope 3 Category 1 attribution).
    - **Optional Free-Text & Specs:** Product title/SKU, specs/tags, typical lead time (days), minimum order quantity (MOQ), capacity band, and ESG/quality certifications.
- **Matching Logic:**
  - Matches buyer's supplier node material/product category against opted-in network suppliers' catalogues using **standardized category match** + compatible `unitFamily` + optional semantic tag similarity.

---

## 4. Node Inspector: `"See alternatives (x)"` Experience

When a buyer clicks any supplier node (in the **Network Hub** or on the **Strategy-Game Supply Map**):
- The Node Inspector Drawer displays a compact, pressable button: **`See alternatives (x)`**, where `x` is the live count of opted-in network suppliers offering the same product/material category (excluding the current supplier and the buyer's own org).
- Clicking **`See alternatives (x)`** opens the **Alternative Suppliers View** with three core actions:
  1. **Ranked Alternative Comparison:** Shows each candidate's public profile — Country, Risk badge (`GREEN`/`AMBER`/`RED`), ESG & quality certifications, estimated distance & transport CO2e delta vs. current supplier, and catalogue specs.
  2. **1-Click "Test in What-If Simulator":** Launches the stateless What-If Simulator pre-loaded with switching `30%–100%` of volume to the selected alternative so the buyer sees live **Resilience Score**, **Expected Annual Loss (EAL)**, and **Transport CO2e** deltas.
  3. **1-Click "Request Intro / Quote":** Sends an opt-in introduction email to the alternative supplier with the buyer's requested material/volume band — **without** exposing the buyer's private supply graph or existing suppliers.

---

## 5. Phased Execution Plan (Sub-Tasks)

### Phase 0 — Registry, Email & Taxonomy Research (Required Before Coding)
- [ ] Research public business registry APIs and open datasets:
  - **Estonia:** e-Business Register (*Äriregister* / `avaandmed.ariregister.rik.ee` open data & JSON/XML APIs).
  - **Nordics & EU:** Finland PRH/YTJ, Sweden Bolagsverket, Latvia Lursoft/UR, Lithuania Registrų Centras, EU BRIS, GLEIF (LEI), OpenCorporates.
  - Document rate limits, licensing, contact-email availability, and GDPR lawful basis for B2B outreach.
- [ ] Evaluate transactional email providers (Resend / Postmark / AWS SES / SMTP) for automated outreach, bounce handling, and suppression lists.
- [ ] Define v1 **Kulgo Standardized Material/Product Taxonomy** (mapped to 4/6-digit HS/CN codes for manufacturing).
- [ ] Produce `docs/research/BUSINESS_REGISTRY_AND_CATALOGUE_TAXONOMY.md`.

### Phase 1 — Shared Contracts & ArcadeDB Schema (`@kulgo/shared` + `@kulgo/api`)
- [ ] Add `CatalogueItemSchema`, `RegistryEnrichmentResultSchema`, `AlternativeMatchSchema`, and `IntroRequestInputSchema` (`.strict()`) in `packages/shared/src/`.
- [ ] Add `registryCode` to `FacilitySchema` / `OrganizationSchema` and add `CatalogueItem` + `EmailSuppression` vertex types to `apps/api/src/db/schema.ts`.

### Phase 2 — Registry Enrichment, Auto-Outreach & Catalogue API (`@kulgo/api`)
- [ ] Implement pluggable `BusinessRegistryService` (Estonia Äriregister adapter + generic fallback) and background enrichment + automatic invite email dispatch with deduplication and suppression-list enforcement.
- [ ] Add Supplier Catalogue CRUD & Excel/CSV upload endpoints (`/api/v1/directory/catalogue`).
- [ ] Add `GET /api/v1/directory/alternatives/for-facility/:facilityId` (returns count `x` + ranked matches) and `POST /api/v1/directory/request-intro`.
- [ ] Extend `apps/api/tests/privacy-boundary.test.ts` to guarantee zero private supply-link or Tier-2+ leakage in catalogue matches and intro emails.

### Phase 3 — Frontend UI & E2E (`@kulgo/web`)
- [ ] Add `.xlsx` (Excel) + CSV template download & upload alongside the "Add New" supplier form in Network Hub.
- [ ] Add **My Public Product Catalogue** management section in Org Settings (for opted-in suppliers).
- [ ] Add **`See alternatives (x)`** button to the Node Inspector Drawer with ranked comparison, **1-Click Test in What-If Simulator**, and **1-Click Request Intro / Quote**.
- [ ] Add Playwright E2E coverage verifying catalogue upload → `"See alternatives (1)"` badge → What-If switch preview → Request Intro.
