# Kulgo Deployment & Operations Guide

This guide covers local development, production Docker Compose deployment, ArcadeDB schema bootstrapping, health checks, compliance audit logging, and backup/restore procedures.

---

## 1. Prerequisites

* **Node.js 24 LTS** (or `>=22.0.0`) and **pnpm 12.21.0** (`corepack enable`)
* **Docker Engine** with Compose v2 (`docker compose`) for ArcadeDB and production containers
* **Single Source of Truth Dockerfiles**:
  * API image: [`apps/api/Dockerfile`](../apps/api/Dockerfile)
  * Web (Nginx SPA + `/api` reverse proxy) image: [`apps/web/Dockerfile`](../apps/web/Dockerfile)

---

## 2. Local Development

### Option A: Zero-Docker In-Memory Mode (Fastest for UI / E2E dev)
```bash
pnpm install
pnpm --filter @kulgo/api start:memory
# In a second terminal:
pnpm dev:web
```

### Option B: Full Stack with Local ArcadeDB
1. Copy `.env.example` to `.env` and set strong local values for `SESSION_SECRET`, `ARCADEDB_PASSWORD`, and `WEB_ORIGIN=http://localhost:5173`.
2. Start ArcadeDB only (bound strictly to `127.0.0.1:2480`):
   ```bash
   docker compose --env-file .env -f infra/docker-compose.yml up -d arcadedb
   ```
3. Bootstrap the ArcadeDB graph & geospatial schema (idempotent):
   ```bash
   pnpm db:bootstrap
   ```
4. Start the API and Web dev servers:
   ```bash
   pnpm dev:api
   pnpm dev:web
   ```

---

## 3. Production Deployment (Docker Compose)

### 3.1 Configure Production Environment
Create a `.env` file on the host (mode `0600`, never committed to git) from `.env.example`:

```bash
cp .env.example .env
chmod 600 .env
```

Generate cryptographically strong secrets:
```bash
openssl rand -hex 32     # -> SESSION_SECRET (>= 32 chars required)
openssl rand -base64 24  # -> ARCADEDB_PASSWORD (>= 12 chars required)
```

Set `WEB_ORIGIN` to your public HTTPS origin (e.g. `https://app.kulgo.example`).

> **Fail-Fast Secret Enforcement:** When `NODE_ENV=production`, [`apps/api/src/config.ts`](../apps/api/src/config.ts) refuses to boot if `SESSION_SECRET` or `ARCADEDB_PASSWORD` is missing, too short, low-entropy, or matches known dev/placeholder patterns.

### 3.2 Private Network Hardening
Per [`docs/PRIVACY_CONTRACT.md`](./PRIVACY_CONTRACT.md) and [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md):
* ArcadeDB runs with unused protocol plugins disabled (`-Darcadedb.server.plugins=`).
* In production behind a TLS reverse proxy (Caddy, Traefik, Nginx, or Coolify), **remove the `ports:` mapping from `arcadedb` (and optionally `api`)** in [`infra/docker-compose.yml`](../infra/docker-compose.yml) so ArcadeDB is reachable **only** inside the private `kulgo-internal` Docker bridge network.

### 3.3 Build, Start & Bootstrap Schema
```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
```

Run the idempotent ArcadeDB schema bootstrap inside the `api` container after first startup (and after any schema-updating release):
```bash
docker compose --env-file .env -f infra/docker-compose.yml exec api \
  ./apps/api/node_modules/.bin/tsx apps/api/src/db/bootstrap.ts
```

This creates all vertex types (`Organization`, `User`, `Session`, `Product`, `SupplyInput`, `Facility`, `Invitation`, `RiskSignal`, `AuditEvent`), edge types (`SUPPLIES_LANE`, `VERIFIED_PARTNER_LINK`), unique/lookup indexes, and WKT `GEOSPATIAL` indexes idempotently.

The invitation atomicity update adds a unique index on `VERIFIED_PARTNER_LINK.@out`, covering existing edges without a backfill. Run bootstrap before serving the updated API. If older concurrent accepts created multiple links from one buyer facility, index creation fails; reconcile those links and their accepted invitations with the buyer before rerunning bootstrap. The migration deliberately does not choose a supplier or delete relationship data automatically.

---

## 4. Health Checks & Observability

### Built-In Health Endpoints
* **API Health (liveness + ArcadeDB connectivity):**
  ```bash
  curl -fsS http://127.0.0.1:4000/api/v1/health
  ```
  Returns HTTP `200` with `{"status":"ok","database":{"engine":"arcadedb","connected":true,"latencyMs":...}}` when healthy, or HTTP `503` (`"status":"degraded"`) if ArcadeDB is unreachable.
* **Web Container (Nginx):**
  ```bash
  curl -fsS http://127.0.0.1:8080/
  ```
* **ArcadeDB Readiness (internal network):**
  `http://arcadedb:2480/api/v1/ready`

Both `apps/api/Dockerfile` and `apps/web/Dockerfile` include Docker `HEALTHCHECK` directives, and `web` waits for `api` to report `service_healthy` in `infra/docker-compose.yml`.

### Structured Logging & Compliance Audit Trail
* `@kulgo/api` emits single-line JSON request logs (`method`, `path`, `status`, `durationMs`, `timestamp`) to `stdout` when `NODE_ENV !== "test"` — passwords, session cookies, and invite tokens are never logged.
* Org-scoped compliance & security events (`ORG_PROFILE_UPDATED`, `MEMBER_ADDED`, `MEMBER_REMOVED`, `BULK_IMPORT_EXECUTED`, `INVITE_CREATED`, `INVITE_ACCEPTED`, `INVITE_REVOKED`, `CSRD_REPORT_EXPORTED`) are persisted as immutable `AuditEvent` vertices in ArcadeDB and queryable exclusively by `OWNER` users via `GET /api/v1/auth/audit-log` (or the **Audit Log** section in Org Settings).

---

## 5. Backup & Restore (ArcadeDB)

ArcadeDB stores all database files in the named Docker volume `arcadedb_data` mounted at `/home/arcadedb/databases`.

### 5.1 Online Backup via ArcadeDB HTTP Command API
Trigger a consistent server-side zip backup from inside the private network:
```bash
docker compose --env-file .env -f infra/docker-compose.yml exec arcadedb \
  curl -fsS -u "root:${ARCADEDB_PASSWORD}" \
  -H "Content-Type: application/json" \
  -d '{"command":"BACKUP DATABASE"}' \
  "http://127.0.0.1:2480/api/v1/command/${ARCADEDB_DATABASE:-kulgo}"
```
Archive files are written under `/home/arcadedb/backups/` (mount an encrypted off-host volume or sync to S3/Backblaze B2 with retention policies).

### 5.2 Offline Volume Snapshot (Maintenance Window)
```bash
# 1. Stop API and ArcadeDB cleanly to flush all WAL/pages
docker compose --env-file .env -f infra/docker-compose.yml stop api arcadedb

# 2. Archive the volume to a timestamped tarball
docker run --rm \
  -v kulgo_arcadedb_data:/data:ro \
  -v "$(pwd)/backups":/backup \
  alpine tar czf "/backup/kulgo-arcadedb-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C /data .

# 3. Restart services
docker compose --env-file .env -f infra/docker-compose.yml start arcadedb api
```

### 5.3 Restore from Volume Snapshot
```bash
# 1. Stop services
docker compose --env-file .env -f infra/docker-compose.yml stop web api arcadedb

# 2. Clear and restore the volume from the target archive
docker run --rm \
  -v kulgo_arcadedb_data:/data \
  -v "$(pwd)/backups":/backup:ro \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/<archive-name>.tar.gz -C /data"

# 3. Start services and verify health + schema
docker compose --env-file .env -f infra/docker-compose.yml up -d
curl -fsS http://127.0.0.1:4000/api/v1/health
```
