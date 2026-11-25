# Training Data Vault — Architecture, Schemas & Governance Spec (Issue #69)

> **Status:** Proposed Spec (v1)  
> **Related:** [Issue #69](https://github.com/Vanatoa23/Kulgo/issues/69), [Issue #68](https://github.com/Vanatoa23/Kulgo/issues/68), [`docs/PRIVACY_CONTRACT.md`](../PRIVACY_CONTRACT.md), [`docs/research/AI_ORCHESTRATION_AND_KNOWLEDGE_SYNTHESIS.md`](../research/AI_ORCHESTRATION_AND_KNOWLEDGE_SYNTHESIS.md)

## 1. Goal & North-Star Product Vision

### 1.1 The Supply Chain Gym (Ultimate Goal)
Kulgo's long-term vision is to train an **internal supply-chain decision-making agent** inside a **historical Supply Chain Gym** — a simulation environment built from years of real-world disruption history where an agent observes the exact information available at time $t$ and learns to recommend the best possible supply-chain management actions (rerouting, buffer sizing, supplier switching, escalation) to minimize disruption impact.

### 1.2 Supporting Internal Models
Alongside the Supply Chain Gym, the same archived data enables smaller, high-ROI internal models along the way:
- **Learned pre-filters & multilingual disruption classifiers** (cutting third-party LLM token spend)
- **Baltic/EU entity & facility resolvers**
- **False-positive / relevance filters**
- **Time-to-Recover (TTR) and disruption-duration predictors**

### 1.3 Design Principles
1. **100% Hands-Off Capture:** Zero manual labeling required today. All capture runs automatically inside `IntelligenceRunner`, API routes, and scheduled scripts. Future analysts can layer gold labels or hindsight false-negative audits on top later without changing the archive format.
2. **Zero Lookahead Bias (Gym Replayability):** Every record preserves both *event time* (`publishedAt` / `firstSeenAt`) and *knowledge time* (`fetchedAt` / `recordedAt`) so a future gym can reconstruct *"exactly what Kulgo knew at timestamp $t$"* without leaking future outcomes.
3. **Strict Provenance Tagging:** Every label or extraction is tagged with `labelProvenance` (`LLM_SILVER` | `RULE_VERIFIED` | `HUMAN_VERIFIED`) to respect LLM provider ToS and separate silver-standard model outputs from verified ground truth.
4. **Privacy & Enterprise-Ready from Day One:** Hard separation between `global_public` (Plane A) and `anonymized_outcomes` (Plane B), plus a per-organization `allowAnonymizedTraining` toggle so strict enterprise DPAs are never blocked.

---

## 2. Storage Architecture & Technical Decisions

### 2.1 Hot Operational Graph vs. Cold Training Lake

- **Hot Operational Store (ArcadeDB):** Keeps active `RiskSignal` vertices, recent operational audit logs, and live tenant supply graphs fast and lightweight.
- **Cold Append-Only Training Lake (EU Object Storage):** Receives immutable, date-partitioned, compressed batch files written asynchronously after each sweep or feedback batch.

### 2.2 File Format: Gzip-Compressed JSON Lines (`.jsonl.gz`)

**Decision:** Standardize on **`.jsonl.gz`** for v1 ingestion.

**Why:**
- **Zero extra runtime dependencies:** Node.js includes `node:zlib` (`gzipSync` / `createGzip`) natively, avoiding native C++/WASM Parquet writer dependencies in the API container.
- **Append & stream friendly:** Newlines are self-framing; small sweep batches (tens to hundreds of records) avoid Parquet row-group overhead.
- **High compression on text:** UTF-8 news snippets, prompts, and JSON payloads compress by ~80–90% with gzip.
- **Trivial Parquet conversion later:** When training or gym-replay jobs run, DuckDB or Polars can read `training-vault/v1/**/*.jsonl.gz` directly or compact daily files into Parquet offline without touching the live API.

### 2.3 Storage Backend: EU-Sovereign S3-Compatible Object Storage + Local Fallback

**Decision:** Define a `TrainingVaultSink` interface with three implementations:
1. **`S3TrainingVaultSink` (Production):** Uses `@aws-sdk/client-s3` pointed at an EU-sovereign S3-compatible bucket (e.g., **Hetzner Object Storage** in Helsinki `hel1` or Falkenstein `fsn1`, ~€5/TB/month).
2. **`LocalFsTrainingVaultSink` (Development / Self-Hosted):** Writes the exact same partitioned directory tree to a local path configured via `TRAINING_VAULT_DIR`.
3. **`NoopTrainingVaultSink` (Tests / Disabled):** Used when neither S3 credentials nor `TRAINING_VAULT_DIR` is configured.

**Why `@aws-sdk/client-s3` over a custom SigV4 `fetch` client:**
- Battle-tested AWS Signature v4 signing, checksums, and exponential backoff retries out of the box.
- Works identically across Hetzner Object Storage, Scaleway, OVH, MinIO, and AWS S3 EU regions via `endpoint` + `forcePathStyle`.
- Avoids maintaining custom cryptographic signing code in-house.

### 2.4 Partitioning Layout

```text
training-vault/v1/{plane}/{dataset}/year=YYYY/month=MM/day=DD/{batchId}.jsonl.gz
```

- `plane`: `global_public` (Plane A) or `anonymized_outcomes` (Plane B)
- `dataset`: `raw_feeds` | `llm_extractions` | `signal_lifecycles` | `entity_resolution_pairs` | `anonymized_alert_feedback` | `anonymized_decision_outcomes` (Phase 2)
- `batchId`: `{sweepId}` for sweep-driven datasets, or `fb-{timestampMs}-{randomHex}` for feedback/resolution batches

### 2.5 Operational Safety (Non-Blocking)

All vault writes are **best-effort and non-blocking**. If object storage is temporarily unreachable, errors are logged with structured telemetry and **never** fail a 3x/day intelligence sweep or an HTTP alert acknowledgement.

---

## 3. Two-Plane Governance, Privacy, Retention & Copyright Rules

### 3.1 Plane A — `global_public` (Permanent Longitudinal World Archive)

Contains **zero tenant IDs, zero customer supply graphs, and zero private commercial data** — only public world events, feeds, extractions, lifecycles, and public-registry entity mappings.
- **Retention:** **Permanent** (multi-year longitudinal archive) so the Supply Chain Gym can replay years of real-world disruptions, seasonal patterns, and rare tail events.
- **Datasets:** `raw_feeds`, `llm_extractions`, `signal_lifecycles`, `entity_resolution_pairs` (public-registry-verified pairs only — see §3.3).

### 3.2 Plane B — `anonymized_outcomes` (De-Identified Operational Feedback & Trajectories)

Contains strictly de-identified human-in-the-loop feedback and (in Phase 2) de-identified decision/recovery outcomes.

**Hard Privacy Invariants (enforced at ingestion + CI):**
1. **Per-Org Enterprise Opt-Out (`allowAnonymizedTraining`):**
   - Organizations have an explicit `allowAnonymizedTraining` boolean setting (default `true` for standard plans; settable to `false` for enterprise customers requiring a strict zero-training DPA).
   - When `allowAnonymizedTraining === false`, **zero** Plane B records are emitted for that organization.
2. **Forbidden fields — NEVER written to any plane:**
   - `orgId`, `ownerOrgId`, `userId`, `email`
   - `facilityId`, `facilityName`, `supplierId`, unresolved `supplierName`
   - Private facility coordinates (`lat`, `lng`), street addresses
   - Commercial financials (`unitPrice`, `revenue`, `spend`, `margin`, `contractValue`)
   - Hidden Tier-2+ partner identities or `VERIFIED_PARTNER_LINK` topology
3. **Coarse time bucketing:** Feedback timestamps are truncated to UTC day (`YYYY-MM-DD`) to prevent timing-correlation attacks against low-volume tenants.
4. **Retention & Deletion:** Because Plane B records are non-invertible and contain zero PII or tenant identifiers at write time, they are retained permanently alongside Plane A and never require historical `.jsonl.gz` rewrites upon a tenant DPA deletion request.
5. **Contract & CI enforcement:** Every Plane B schema in `@kulgo/shared` uses Zod `.strict()`. `pnpm test:privacy` (`apps/api/tests/privacy-boundary.test.ts`) asserts that passing any forbidden field throws a validation error and that emitted JSONL lines contain zero tenant identifiers.

### 3.3 Entity Resolution Pairs Boundary

- **Rule:** Only log an `entity_resolution_pairs` record when the input resolves to a **verified public registry entity** (e.g., Estonian *Äriregister*, EU/national business registries, LEI, UN/LOCODE).
- **Never log unresolved free-text strings:** Unresolved user inputs may contain internal vendor codes, personal names, or confidential project names and are excluded from the vault.

### 3.4 Copyright & Content Retention Policy (`raw_feeds`)

Every `raw_feeds` record carries an explicit `contentPolicy` and `licenseTag` so downstream training pipelines can filter by legal provenance:

| Source Category | `contentPolicy` | `licenseTag` Examples | What We Store |
| :--- | :--- | :--- | :--- |
| **Open / Public-Domain / Uncopyrighted** (government & regulatory notices, official sanctions lists EU/OFAC/UN, open maritime/port/customs advisories, GDACS/NOAA/USGS/Copernicus alerts, CC0 / CC-BY / Open Government License feeds) | `FULL_TEXT` | `PUBLIC_DOMAIN`, `CC0`, `CC_BY`, `OPEN_GOV` | **Full UTF-8 payload/body**, title, summary, URL, timestamps, SHA-256 hash |
| **Copyrighted News & Trade Media** (commercial newsrooms, press agencies, trade journals) | `EXCERPT_ONLY` | `COPYRIGHTED_EXCERPT` | **Feed-provided `title`, `summary`/`snippet`, extracted `evidenceQuote` spans, canonical `url`, `publisherDomain`, timestamps, and `contentSha256` hash only.** Never scrape or store full copyrighted article bodies. |

### 3.5 Label Provenance & LLM Provider ToS Hygiene

Every extracted or labeled record carries:
```ts
labelProvenance: "LLM_SILVER" | "RULE_VERIFIED" | "HUMAN_VERIFIED"
```
- `LLM_SILVER`: Generated by a third-party LLM (Gemini/OpenAI/Anthropic). Separated so training pipelines can exclude or gate it based on provider ToS.
- `RULE_VERIFIED`: Derived deterministically from official registries, structured feeds, or automated corroboration rules.
- `HUMAN_VERIFIED`: Confirmed by customer feedback or a future Kulgo analyst review.

---

## 4. Dataset Schemas (v1)

All records share a common envelope:
- `schemaVersion`: `"1.0"`
- `plane`: `"global_public"` | `"anonymized_outcomes"`
- `recordedAt`: ISO-8601 UTC timestamp (or `YYYY-MM-DD` bucket for Plane B)

### 4.1 `raw_feeds` (`global_public`)

Captures both kept and dropped Stage 1 / Stage 2 items so we can measure pre-filter false negatives and train learned pre-filters.

```ts
{
  schemaVersion: "1.0",
  plane: "global_public",
  sweepId: string,
  sourceId: string,
  stage: "STAGE_1" | "STAGE_2",
  url: string,
  publisherDomain: string,
  fetchedAt: string,          // Knowledge time (ISO-8601) — prevents gym lookahead bias
  publishedAt: string | null, // Event/publication time (ISO-8601)
  language: string | null,    // BCP-47 / ISO-639-1
  contentSha256: string,
  contentPolicy: "FULL_TEXT" | "EXCERPT_ONLY",
  licenseTag: "PUBLIC_DOMAIN" | "CC0" | "CC_BY" | "OPEN_GOV" | "COPYRIGHTED_EXCERPT",
  title: string,
  summary: string | null,
  fullText: string | null,    // MUST be null when contentPolicy === "EXCERPT_ONLY"
  preFilterPassed: boolean,
  preFilterReason: string | null,
  matchedKeywords: string[]
}
```

### 4.2 `llm_extractions` (`global_public`)

Captures every LLM extraction attempt (including validation failures) for evaluation, distillation (where permitted), and fine-tuning.

```ts
{
  schemaVersion: "1.0",
  plane: "global_public",
  labelProvenance: "LLM_SILVER",
  sweepId: string,
  articleContentSha256: string,
  promptTemplateVersion: string,
  provider: string,           // e.g., "gemini", "openai", "anthropic"
  model: string,
  promptText: string,         // Public-only prompt (zero tenant context)
  rawOutput: string,
  parsedCandidate: Record<string, unknown> | null,
  evidenceQuotes: string[],
  validationPassed: boolean,
  validationErrors: string[],
  promptTokens: number | null,
  completionTokens: number | null,
  latencyMs: number,
  recordedAt: string
}
```

### 4.3 `signal_lifecycles` (`global_public`)

Tracks deduplication merges, corroboration independence, and `PLANNED -> ACTIVE -> RESOLVED` transitions so the Supply Chain Gym can replay disruption evolution over time.

```ts
{
  schemaVersion: "1.0",
  plane: "global_public",
  labelProvenance: "LLM_SILVER" | "RULE_VERIFIED" | "HUMAN_VERIFIED",
  sweepId: string,
  signalId: string,
  eventCategory: string,
  severity: string,
  countryCodes: string[],
  lifecycleStatus: "PLANNED" | "ACTIVE" | "RESOLVED",
  previousStatus: "PLANNED" | "ACTIVE" | "RESOLVED" | null,
  mergedArticleHashes: string[],
  independentSourceCount: number,
  firstSeenAt: string,
  lastUpdatedAt: string,
  resolvedAt: string | null,
  observedDurationHours: number | null,
  recordedAt: string
}
```

### 4.4 `entity_resolution_pairs` (`global_public`)

Captures verified mappings from normalized input strings to public registry entities (Sub-Project 5 #29 & Sub-Project 1).

```ts
{
  schemaVersion: "1.0",
  plane: "global_public",
  labelProvenance: "RULE_VERIFIED" | "HUMAN_VERIFIED",
  inputNormalized: string,    // Normalized company/port/facility string (verified public entity only)
  inputLanguage: string | null,
  registrySource: string,     // e.g., "EE_ARIREGISTER", "EU_GLEIF", "UN_LOCODE"
  registryId: string,
  canonicalName: string,
  countryCode: string | null,
  resolutionMethod: "EXACT_ID" | "ALIAS_DICTIONARY" | "FUZZY_MATCH" | "USER_CONFIRMED",
  confidence: number,         // 0..1
  recordedAt: string
}
```

### 4.5 `anonymized_alert_feedback` (`anonymized_outcomes`)

Captures structured customer alert acknowledgements and dismissals (#68) with all tenant/user/facility identifiers stripped (gated by `allowAnonymizedTraining`).

```ts
{
  schemaVersion: "1.0",
  plane: "anonymized_outcomes",
  labelProvenance: "HUMAN_VERIFIED",
  signalId: string,
  reasonCode: "HANDLED" | "WRONG_ENTITY_OR_SITE" | "FALSE_OR_OUTDATED_EVENT" | "NOT_RELEVANT_TO_LANE",
  eventCategory: string | null,
  severity: string | null,
  countryCode: string | null, // Coarse ISO-3166-1 alpha-2 only
  timestampBucket: string     // UTC day "YYYY-MM-DD"
}
```

### 4.6 Phase 2 Placeholder: `anonymized_decision_outcomes` (`anonymized_outcomes`)

Reserved for when Kulgo tracks mitigation actions and actual supplier/lane recovery outcomes to power offline RL in the Supply Chain Gym (gated by `allowAnonymizedTraining`):

```ts
{
  schemaVersion: "1.0",
  plane: "anonymized_outcomes",
  labelProvenance: "HUMAN_VERIFIED" | "RULE_VERIFIED",
  signalId: string,
  eventCategory: string,
  transportMode: string | null,   // e.g., "SEA", "ROAD", "RAIL", "AIR"
  regionBucket: string | null,    // Coarse region / corridor (never exact coordinates)
  predictedTtrBandDays: string | null,
  observedTtrBandDays: string | null,
  actionType: string | null,      // e.g., "REROUTE", "BUFFER_INCREASE", "ALT_SUPPLIER", "NO_ACTION"
  timestampBucket: string         // UTC day "YYYY-MM-DD"
}
```

---

## 5. Planned Implementation Checklist (Next Step)

1. **`packages/shared/src/training-vault.ts`:** Define `.strict()` Zod schemas and TypeScript types for all v1 datasets, including `labelProvenance` and the runtime invariant ensuring `fullText === null` whenever `contentPolicy === "EXCERPT_ONLY"`.
2. **`apps/api/src/intelligence/training-vault.ts`:** Implement `TrainingVaultSink`, `LocalFsTrainingVaultSink`, `S3TrainingVaultSink` (`@aws-sdk/client-s3`), and `NoopTrainingVaultSink` with `.jsonl.gz` serialization and partitioned keys.
3. **Per-Org Opt-Out Gate:** Add `allowAnonymizedTraining` (default `true`) to org settings / workspace config and enforce it before writing any Plane B record.
4. **Pipeline Wiring:**
   - Emit `raw_feeds`, `llm_extractions`, and `signal_lifecycles` batches from `IntelligenceRunner` (`apps/api/src/intelligence/runner.ts`).
   - Emit `anonymized_alert_feedback` from `POST /api/alerts/:signalId/ack` (`apps/api/src/intelligence/routes.ts`).
5. **Governance & Tests:**
   - Add a **Training Data Vault** section to `docs/PRIVACY_CONTRACT.md`.
   - Extend `apps/api/tests/privacy-boundary.test.ts` (`pnpm test:privacy`) to verify strict stripping of tenant/PII fields, `allowAnonymizedTraining: false` suppression, and `EXCERPT_ONLY` enforcement.
   - Add unit tests for gzip JSONL writing, partition path generation, and non-blocking error handling.
