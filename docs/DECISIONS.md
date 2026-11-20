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
