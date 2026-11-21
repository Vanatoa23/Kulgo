# Sub-Project 4 Spec: UX Redesign, 4-Page Navigation Shell & Strategy-Game Supply Map

**Status:** Draft Spec (Ready for Design & Implementation Phases)  
**Design Goal:** Make Kulgo immediately intuitive for mid-market manufacturers — zero clutter, progressive disclosure, and a strategy-game-inspired interactive supply map (drawing from *Victoria 3 / Hearts of Iron IV / Factorio* supply hub clarity).  
**Visual Theme:** **Dark Tactical Command-Center** (deep slate/obsidian surfaces with high-contrast emerald/amber/red risk signals so glowing flow lines and risk badges pop immediately; optional Light mode later).

---

## 1. Global App Shell & Navigation

Replace the current single-screen dense toolbar with a clean **4-Page App Shell**:

- **Persistent Slim Left Icon-Rail** (collapsible with tooltips):
  1. **Hub** (Page 1 — Default landing page for managing Suppliers, Own Facilities/Warehouses, and Clients)
  2. **Map** (Page 2 — Full-bleed Strategy-Game Supply Map + Logical Graph toggle)
  3. **Dashboard** (Page 3 — Financial Risk, ESG/PCAF, Regional Compliance & Report Downloads)
  4. **Settings** (Page 4 — User Profile, Organization Profile, Team Members/RBAC, Audit Log, Notifications)
- **Minimal Top Context Bar:**
  - Organization badge + Product/Material filter pill + **Time View Toggle (`Current Run-Rate` vs. `Selected Period Window T`)** + Live Alert Bell (unread `RED`/`AMBER` count) + User avatar/logout menu.

---

## 2. Page 1 — Network Hub (Suppliers → My Facilities → Clients)

**Layout:** Clean **3-Column Flow Layout** so any user immediately grasps their end-to-end supply chain:
1. **Column 1: Upstream Suppliers** (`+ Add Supplier`)
2. **Column 2: My Facilities & Warehouses** (`+ Add Warehouse / Factory`)
3. **Column 3: Downstream Clients** (`+ Add Client`)

**Card Design (Level 0 Friendly):**
- Each card shows: **Name**, **Country/City**, **Color-coded Risk Indicator Dot** (`GREEN` / `AMBER` / `RED`), and optional derived volume/verified badge.
- Users can create a node with just a **name + location** (Level 0); no volumes or costs required upfront.

**Right-Hand Inspector Drawer, Commercial Contracts & 30/70 Allocation Splits:**
- Clicking any Supplier, Warehouse, or Client opens a clean **Inspector Drawer**:
  - Edit physical/operational route attributes (`transportMode`, `leadTimeDays`, `distanceKm`), optional operational buffer details (collapsed by default), and **Commercial Commitments (`Contract` + `ContractLine`)**.
  - **Progressive Commercial Layer:** Entering a quick volume/spend creates a Level-1 `ESTIMATE` contract; adding the first formal `FRAMEWORK` contract (`FIXED` | `INDEXED`, defaulting to `HOLDOVER` or `AUTO_RENEW` with `noticePeriodDays`) automatically replaces/archives the quick `ESTIMATE` to prevent double-counting, while one-off `SPOT` top-ups default to `AUTO_ARCHIVE`.
  - **Destination Allocation Splits:** When a supplier delivers to multiple own warehouses (or a warehouse ships to multiple clients), users can assign visual **split bars** (e.g., `30% → Tallinn Warehouse`, `70% → Tartu Plant`) that auto-validate to `100%` and automatically compute exact per-lane derived volume (`activeVolume × allocationSplitPct`).

---

## 3. Page 2 — Strategy-Game Supply Map

Full-bleed interactive MapLibre + Deck.gl canvas inspired by strategy-game supply hub overlays:

1. **Animated Directional Flow Lines:**
   - **Line Thickness** scales smoothly with derived lane `activeVolume` / derived `volumeSharePct` (or badged `~Spend Share %` when physical volume is missing or units conflict) for the active time view (**Current Run-Rate** by default, or pro-rated **Period Window `T`**).
   - **Line Color** reflects live risk status (`Emerald` = Low/Green, `Amber` = Elevated / Renewal Cliff, `Red` = Critical Disruption / SPOF).
   - **Subtle Animated Pulses** travel along arcs to show physical flow direction (`Supplier → Warehouse → Client`).
2. **Floating Strategy-Game HUD:**
   - **Top-Center Flow Toggle:** `[ Suppliers | Both | Clients ]` — switches instantly between upstream supply lines, downstream client delivery lines, or the full network.
   - **Bottom-Left Layer Toggles:** `[ Risk Polygons | Chokepoints | Emissions | Logical Graph ]` + quick button to open the **What-If Simulator** drawer.
   - **Click-on-Line HUD Card:** Clicking any route arc opens a compact tactical card displaying derived **`activeVolume`** (in canonical `SupplyInput.baseUnit`, reflecting 30/70 warehouse splits), **`activeSpendEur`**, denominator-hygienic **`weightedAvgUnitPrice`**, derived **`volumeSharePct`** (or badged **`~Spend Share %`**), **renewal cliff status** (`>30%` volume expiring in 90 days), **transport mode**, **lead time**, **estimated CO2e**, and **active risk reason**.
3. **Focus / Isolation Mode (Supply Hub Highlight):**
   - Hovering or clicking any facility dims unrelated routes and illuminates only its connected upstream suppliers and downstream clients (mirroring HOI4 / Victoria 3 supply hub inspection).

---

## 4. Page 3 — Executive Dashboard (Financial, ESG & Compliance)

Designed for scannable CFO / COO / Procurement review without a cluttered wall of charts:

- **Top KPI Strip (4 Cards):**
  1. **Resilience Score** (`0–100` + `GREEN`/`AMBER`/`RED` badge + HHI partial-coverage indicator, e.g., *"Based on 9 of 10 active lanes"*)
  2. **Expected Annual Loss (EAL)** (`Low–High €/yr` range for Selected Period Window `T` + confidence badge from Sub-Project 2)
  3. **Total Carbon Footprint** (`Scope 1+2+3 tCO2e` with GHG Protocol Category 1 attribution + **PCAF 1–5** data quality score from Sub-Project 3)
  4. **Active Disruptions** (live `RED`/`AMBER` count from Sub-Project 1)
- **Prominent Header Action — `Export Reports` Dropdown:**
  - Download **Board / Bank-Ready PDF Executive Summary**
  - Download **Auditor CSV Ledger** (with emission factor citations, attribution methods & PCAF scores)
  - Download **Structured JSON Report** + **Bulk Import / Export Workspace**
- **Clean Sub-Tabs:**
  - `Overview` (top risks, HHI concentration with explicit Coverage %, top emitting lanes, quick actions to narrow ranges / improve PCAF score)
  - `Financial Risk` (EAL/VaR bands over Period Window `T`, renewal cliffs & TTS vs. TTR outage gaps, defect buffer recommendations)
  - `ESG & Emissions` (Scope 1/2/3 breakdown with PCF / economic intensity attribution, hotspots, CBAM flags)
  - `Compliance` (Regional Compliance Readiness Checklist driven by Org HQ + Target Sales Markets)

---

## 5. Page 4 — User & Organization Settings

Replaces the crowded `OrgSettingsModal` with a dedicated, tabbed Settings page:
- **My Profile:** Email, role badge, password change (future), personal notification preferences.
- **Organization & Markets (`OWNER`-only edit):** Scope 1/2 inputs, ESG badges, Alternative Directory opt-in, **Target Sales / Export Markets** & Regional Compliance Pack toggles.
- **Team Members & RBAC:** List members, add `OWNER` / `MEMBER` accounts, remove members (with last-owner protection).
- **Compliance Audit Log (`OWNER`-only):** Filterable, newest-first immutable security & CSRD audit log.

---

## 6. Data Model & Phased Execution Plan

### Phase 0 — Data Model Extension (`@kulgo/shared` + `@kulgo/api`)
- [ ] Extend `FacilitySchema` with `relationshipRole: z.enum(["SUPPLIER", "OWN", "CLIENT"])` (backwards-compatible with `isOwnFacility`).
- [ ] Extend `SupplyLaneSchema` with `direction: z.enum(["UPSTREAM", "INTERNAL", "DOWNSTREAM"])` and `allocationSplitPct` support for 30/70 multi-warehouse splits while keeping commercial commitments decoupled in `Contract` + `ContractLine` (Sub-Project 2).
- [ ] Update ArcadeDB schema (`apps/api/src/db/schema.ts`), `WorkspaceRepository`, and `seedEstoniaProductXDemo` (adding sample downstream clients & a 30/70 warehouse split).

### Phase 1 — 4-Page App Shell & Network Hub (`@kulgo/web`)
- [ ] Build slim left icon-rail navigation + minimal top context bar (`Hub`, `Map`, `Dashboard`, `Settings`, plus **Current Run-Rate vs. Period Window `T`** toggle).
- [ ] Build Page 1 **Network Hub** (3-column `Suppliers → My Facilities → Clients` layout) + right-hand Inspector Drawer with interactive 30/70 destination split bars and progressive Contract (`ESTIMATE` / `FRAMEWORK` / `SPOT`) management.
- [ ] Migrate `OrgSettingsModal` into Page 4 **Settings** tabs.

### Phase 2 — Strategy-Game Supply Map (`@kulgo/web`)
- [ ] Upgrade `SupplyMap` with animated directional Deck.gl flow pulses, derived volume-scaled line thickness (with badged `~Spend Share %` fallback), `[Suppliers | Both | Clients]` HUD toggle, Focus/Isolation mode on hover/click, and Click-on-Line tactical HUD card.

### Phase 3 — Executive Dashboard & E2E (`@kulgo/web`)
- [ ] Build Page 3 **Dashboard** (KPI Strip, HHI Coverage % badges, `[Overview | Financial Risk | ESG & Emissions | Compliance]` sub-tabs, and `Export Reports` dropdown).
- [ ] Update and expand Playwright E2E suite (`apps/web/tests/e2e/smoke.spec.ts`) to cover Hub 30/70 split creation, Map `[Suppliers | Both | Clients]` toggle + line click inspection, Dashboard report export, and Settings RBAC.
