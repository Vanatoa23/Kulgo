# Kulgo 🌍🔗

> *From the Estonian word "kulg" (flow, path, course) — bringing radical visibility, resilience, and ESG intelligence to global supply networks without exposing private partner relationships.*

## Stack
* **Frontend (`apps/web`):** React 19, Vite, TypeScript, Tailwind CSS v4, MapLibre GL JS, Deck.gl, React Flow
* **Backend (`apps/api`):** Hono, Node 24, TypeScript, Zod
* **Database:** ArcadeDB (Apache 2.0 multi-model graph + geospatial, private network only)
* **Shared & Analytics (`packages/shared`, `packages/engine`):** Strict Zod contracts + pure HHI, risk, and Scope 1/2/3 ESG engine

## Quickstart (Local Development)

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start hardened ArcadeDB container
docker compose --env-file .env -f infra/docker-compose.yml up -d arcadedb

# 3. Install dependencies & bootstrap schema
pnpm install
pnpm db:bootstrap

# 4. Run API and Web in separate terminals
pnpm dev:api
pnpm dev:web
```

## Verification Commands
```bash
pnpm typecheck                       # Strict TypeScript check across all packages
pnpm build                           # Build web + verify API & packages
pnpm test                            # Run all unit and API tests
pnpm test:privacy                    # Run mandatory Tier-2+ privacy boundary test suite
pnpm --filter @kulgo/web test:e2e    # Run live Playwright browser E2E suite
pnpm --filter @kulgo/web test:e2e:map # Verify worker loading & GeoJSON rendering in dev and production
```

## Documentation
* [Product & Engineering Roadmap](docs/ROADMAP.md)
* [AI & Engineering Decision Ledger (Append-Only)](docs/AI_LEDGER.md)
* [Architecture](docs/ARCHITECTURE.md)
* [Privacy Contract](docs/PRIVACY_CONTRACT.md)
* [Deployment & Operations Guide](docs/DEPLOYMENT.md)
* [Architecture Decisions](docs/DECISIONS.md)
* [Phase 2 Specifications](docs/specs/)

## Network import and export

JSON network exports are the portable format for products, inputs, facilities, lanes, and their associations. Import creates organization-scoped entities with new identifiers; existing facilities may be matched by name, kind, and country. Contracts and verified partner links are not included in the network export.

CSV is a facilities-and-lanes format for spreadsheet editing; it does not include products, inputs, or lane-to-input associations. Use JSON when those associations need to be restored. Import is row-based and can partially succeed, so check the returned errors.
