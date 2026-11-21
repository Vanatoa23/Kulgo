# Kulgo Architecture

## Overview
Kulgo is a TypeScript monorepo (`pnpm` workspaces) designed around three non-negotiable principles:
1. **Smooth User Experience** — 60fps interactive geospatial mapping (`MapLibre GL JS` + `Deck.gl`) paired with a toggleable logical graph view (`React Flow`).
2. **Strict Multi-Tenant Privacy** — Companies only see the supply network they enter; hidden Tier-2+ partner networks are traversed strictly server-side to produce anonymized risk, sanctions, and ESG insights.
3. **End-to-End Consistency** — Shared Zod contracts (`@kulgo/shared`) and pure, deterministic risk/ESG algorithms (`@kulgo/engine`).

## Workspace Packages
* `apps/web` (`@kulgo/web`) — React 19 + Vite + Tailwind CSS v4 SPA. Imports **only** from `@kulgo/shared`.
* `apps/api` (`@kulgo/api`) — Hono API on Node 24. The **only** package allowed to communicate with ArcadeDB.
* `packages/shared` (`@kulgo/shared`) — Zod schemas and inferred TypeScript types. Privacy-sensitive analytics DTOs use `.strict()` to reject unexpected fields.
* `packages/engine` (`@kulgo/engine`) — Pure, zero-I/O algorithms for HHI concentration (with partial-coverage indicators), SPOF alerts, contract-derived run-rate & period-window analytics (with FX rates passed explicitly as pure inputs), multimodal transport emissions, and GHG Protocol Category 1-attributed Scope 1/2/3 ESG roll-ups.

## Database: ArcadeDB (Multi-Model Graph + Geospatial)
* Runs strictly inside the private `kulgo-internal` Docker network (`infra/docker-compose.yml`).
* Unused wire-protocol plugins (Redis, MongoDB, Postgres wire) are disabled (`-Darcadedb.server.plugins=`).
* Schema is bootstrapped idempotently via `apps/api/src/db/schema.ts` (`pnpm db:bootstrap`).
* Geospatial indexing uses ArcadeDB's `GEOSPATIAL` WKT index on `Facility.locationWkt` and `RiskSignal.polygonWkt`.
* Cross-tenant partner graph traversal (`VERIFIED_PARTNER_LINK`) runs strictly server-side with cycle-safe per-path `visited` org sets and bounded tier depth.
