# AI Orchestration, Knowledge Factory, Frameworks & Training Data Synthesis

> **Status:** Approved Product & Engineering Synthesis (Reviews of Research Issues [#61](https://github.com/Vanatoa23/Kulgo/issues/61), [#62](https://github.com/Vanatoa23/Kulgo/issues/62), [#63](https://github.com/Vanatoa23/Kulgo/issues/63), and [#64](https://github.com/Vanatoa23/Kulgo/issues/64))  
> **Date:** 2026-11-23  
> **Actionable Follow-Up Issues:** [#65](https://github.com/Vanatoa23/Kulgo/issues/65), [#66](https://github.com/Vanatoa23/Kulgo/issues/66), [#67](https://github.com/Vanatoa23/Kulgo/issues/67), [#68](https://github.com/Vanatoa23/Kulgo/issues/68), [#69](https://github.com/Vanatoa23/Kulgo/issues/69)

---

## 1. Executive Summary (Product Verdict)

After reviewing four deep-dive research reports covering **LangGraph & Durable Workflow Orchestration (#61)**, **Knowledge Factory & Self-Improving Intelligence (#62)**, **TypeScript AI Frameworks (#63)**, and **Deep Agents, LangSmith & AI Evaluation Infrastructure (#64)**, we reached a clear product and engineering conclusion:

1. **Do NOT adopt heavyweight external AI frameworks, multi-agent harnesses, or self-hosted observability stacks right now.**
   - Most of Kulgo's core pipeline (structured feed parsing, 3-layer supply-graph matching, financial EAL/VaR & TTS/TTR calculation, Scope 3 ESG attribution, and alert gating) is **deterministic math and rules**, not open-ended AI reasoning.
   - Adding **LangGraph**, **Mastra**, **Temporal**, **LangChain.js**, **Deep Agents**, **Mem0/Zep**, or a **6-container self-hosted Langfuse/LangSmith stack** at our current stage introduces dependency bloat (100+ MB, Zod v4 conflicts against our Zod v3 contracts) and operational overhead without improving alert accuracy or lowering inference bills.
2. **DO implement the high-leverage, low-complexity data, UTF-8, provenance, and reliability improvements exposed by the audits.**
   - The four research audits identified concrete, high-payoff improvements inside `apps/api/src/intelligence/` that are cheap to build now and prevent false alerts, lost European-language news, duplicate emails, and wasted LLM tokens as we scale.
3. **DO capture and archive all public intelligence and anonymized operational feedback from Day 1 to train future internal models (#69).**
   - Every 3x/day sweep, pre-filter decision, LLM extraction, event lifecycle duration, entity match, and structured user alert dismissal is valuable training data. By archiving this cleanly in a two-plane (Public Corpus vs. Anonymized Operational Outcomes) append-only training lake, Kulgo builds a proprietary dataset for training internal models in the future.

---

## 2. Report-by-Report Product Takeaways & Decisions

| Research Report | Core Question | Product Verdict | What We Adopt Now vs. Defer |
| :--- | :--- | :--- | :--- |
| **[#61 — LangGraph & Agent Orchestration](https://github.com/Vanatoa23/Kulgo/issues/61)** | Should we replace our TypeScript pipeline with LangGraph, Mastra, Temporal, Inngest, or Trigger.dev? | **Keep custom TypeScript orchestration in `apps/api`.** Strict separation between Public Evidence (`Pull Once`) and Tenant Impact (`Match Many`). | **Adopt now:** Atomic alert delivery claim/outbox, persisted sweep lease in ArcadeDB, and depth-4 Layer-3 partner alert matching aligned with `partner-resolver.ts` ([#67](https://github.com/Vanatoa23/Kulgo/issues/67)).<br>**Defer:** LangGraph (until multi-step public investigation loops need resumable branching) and Temporal (until multi-worker fleets outgrow single-worker leases). |
| **[#62 — Knowledge Factory & Self-Improving AI](https://github.com/Vanatoa23/Kulgo/issues/62)** | How should Kulgo learn from mistakes over time without leaking private tenant data? | **Use a 3-Plane boundary:** (1) Global Playbooks in Git, (2) Public Evidence & Entity Aliases in ArcadeDB, (3) Tenant-Private Overlays strictly scoped to `orgId`. | **Adopt now:** Structured dismissal reason codes on `OrgAlertAck` (`HANDLED`, `WRONG_ENTITY_OR_SITE`, `FALSE_OR_OUTDATED_EVENT`, `NOT_RELEVANT_TO_LANE`) and a shared Public Entity Alias dictionary connecting Sub-Project 1 (News) and Sub-Project 5 (Business Registries, #29) ([#68](https://github.com/Vanatoa23/Kulgo/issues/68)).<br>**Defer:** Autonomous nightly AI curator agents, Mem0, Zep/Graphiti, Letta, and LangSmith Context Hub. |
| **[#63 — LangChain vs AI SDK vs TS Frameworks](https://github.com/Vanatoa23/Kulgo/issues/63)** | Does switching `LlmRouter` to LangChain.js, Vercel AI SDK, Mastra, Genkit, or TanStack AI improve cost or speed? | **No framework lowers provider token tariffs** (~$0.72/mo per 10k articles on Gemini 2.5 Flash-Lite). Keep `LlmRouter` as our application-owned boundary. | **Adopt now:** Wire cross-sweep 72h URL/title deduplication in `runner.ts` ([#65](https://github.com/Vanatoa23/Kulgo/issues/65)), require `articleId` + verbatim `evidenceQuote` binding with `.strict()` schemas in `stage2.ts`, remove the giant EU/Baltic fallback polygon ([#66](https://github.com/Vanatoa23/Kulgo/issues/66)), and add a real 60s provider cooldown + token usage counter to `LlmRouter` ([#67](https://github.com/Vanatoa23/Kulgo/issues/67)).<br>**Reject/Defer:** LlamaIndex.TS (deprecated/archived), LangChain.js, Mastra, Genkit. |
| **[#64 — Deep Agents, LangSmith & Evaluation](https://github.com/Vanatoa23/Kulgo/issues/64)** | Should we adopt Deep Agents, LangSmith/Engine, Langfuse, or Phoenix for evaluation and observability? | **Skip paid/heavy observability servers for MVP.** Test the full pipeline (`Article -> Signal -> Dedupe -> Alert`) in Vitest with edge-case fixtures. | **Adopt now:** Full UTF-8/Unicode normalization (`\p{L}`, `\p{N}`, `/u`) and multilingual Estonian/Nordic/Baltic keyword pre-filtering ([#65](https://github.com/Vanatoa23/Kulgo/issues/65)), move Gemini API key from URL query string to `x-goog-api-key` header ([#67](https://github.com/Vanatoa23/Kulgo/issues/67)), and add Vitest edge-case fixtures for syndication, week boundaries, and multilingual headlines.<br>**Defer:** Deep Agents SDK, LangSmith Engine, and self-hosted Langfuse/Phoenix. |

---

## 3. High-Leverage Early Engineering Improvements (Tracked Issues)

### 3.1 Full UTF-8 / Unicode Normalization, Multilingual Baltic/EU Pre-Filter & Cross-Sweep Dedupe — [Issue #65](https://github.com/Vanatoa23/Kulgo/issues/65)
- **Why it matters early:** Estonian (`õ, ä, ö, ü, š, ž`), Finnish, Swedish, Latvian, Lithuanian, German, and Polish characters are essential for our target market.
- **Concrete fixes:**
  1. Replace ASCII-only `.replace(/[^a-z0-9\s]/g, " ")` in `apps/api/src/intelligence/dedupe.ts` (`buildTrigrams`) with Unicode property escapes (`.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ")`) so words like `"Tööseisak Pärnu sadamas"` aren't broken into fragments.
  2. Replace ASCII `\b(...)\b/i` in `apps/api/src/intelligence/feeds/stage2.ts` (`DISRUPTION_KEYWORD_PATTERN`) with Unicode-aware (`/iu`) stem/compound matching so Estonian and Nordic terms (`tööseisak`, `pankrot`, `tarneraskus`, `katkestus`, `üleujutus`, `satamalakko`, `hamnstrejk`, etc.) pass the zero-token pre-filter.
  3. Normalize diacritics in `buildOrgSlug()` (`apps/api/src/auth/repository.ts`) so `"Pärnu Tööstus OÜ"` generates `"parnu-toostus-ou-..."` instead of `"p-rnu-t-stus-o-..."`.
  4. Pass active signals' `sourceUrls` and `title` list into `preFilterUnstructuredItems()` inside `runner.ts` so the 3 daily sweeps don't re-classify the exact same news articles.

### 3.2 Stage 2 Input-Article Provenance Binding, Strict Geography & Syndication-Aware Corroboration — [Issue #66](https://github.com/Vanatoa23/Kulgo/issues/66)
- **Why it matters early:** Prevents false `RED` alerts and hallucinated citations.
- **Concrete fixes:**
  1. Assign an `articleId` to each input item in Stage 2 batches and require the LLM to return `articleId` + a verbatim `evidenceQuote` in a `.strict()` Zod schema. The server attaches the true `sourceUrl` and `publishedAt` from the input item.
  2. Remove the giant EU/Baltic fallback polygon (`POLYGON ((10.0 46.0, 29.0 46.0, 29.0 60.5, 10.0 60.5, 10.0 46.0))`) in `stage2.ts` when an article only mentions a country or sector. Country-level news should match by `COUNTRY` / `REGION`, never by drawing a box over half of Europe.
  3. Upgrade `dedupe.ts` corroboration to check true registrable domains and headline/quote similarity so two syndicated copies of one wire report do not self-corroborate into an instant `RED` email.
  4. Separate actual event validity dates (`eventStartAt` / `eventEndAt`) from the 7-day feed staleness TTL (`expiresAt`), and handle ongoing events crossing ISO-week boundaries (Sunday -> Monday) without splitting or colliding with unrelated same-country events.

### 3.3 LlmRouter Hardening, Atomic Alert Outbox & Depth-4 Partner Matching — [Issue #67](https://github.com/Vanatoa23/Kulgo/issues/67)
- **Why it matters early:** Prevents duplicate customer alert emails, avoids 48-second timeout stalls during provider rate limits, and aligns alert matching with our depth-4 analytics engine.
- **Concrete fixes:**
  1. Move the Gemini API key in `llm-router.ts` from `?key=...` in the URL query string to the `x-goog-api-key` HTTP header.
  2. Add a 60-second provider cooldown after consecutive 429/5xx failures, explicit `maxOutputTokens`, and token usage accounting (`promptTokens`, `completionTokens`) in `LlmRouterResult`.
  3. Make alert dispatch in `alert-repository.ts` and `notifications.ts` claim delivery atomically before sending email/webhooks.
  4. Align Layer-3 partner alert matching in `runner.ts` with `partner-resolver.ts` (depth-4 cycle-safe traversal + two-sided `fulfilledByFacilityId` reconciliation) while keeping emitted partner alerts coarse and anonymized.
  5. Add a lightweight persisted sweep lease in ArcadeDB so restarts or multi-replica deployments don't double-run sweeps.

### 3.4 Structured Alert Feedback Reason Codes & Shared Public Entity Aliases — [Issue #68](https://github.com/Vanatoa23/Kulgo/issues/68)
- **Why it matters early:** Connects user actions and Sub-Project 5 (Business Registry Onboarding, #29) directly to intelligence accuracy.
- **Concrete fixes:**
  1. Add an optional structured `reason` enum (`HANDLED`, `WRONG_ENTITY_OR_SITE`, `FALSE_OR_OUTDATED_EVENT`, `NOT_RELEVANT_TO_LANE`) to `OrgAlertAckSchema` (`POST /api/alerts/:signalId/ack`).
  2. Create a shared public entity alias & HQ-vs-production-site dictionary used by both Sub-Project 5 (Estonian *Äriregister* & EU registries) and Sub-Project 1 (News Matching).

---

## 4. Long-Term Data Strategy: Saving All Data for Future Internal Model Training — [Issue #69](https://github.com/Vanatoa23/Kulgo/issues/69)

As Kulgo runs daily sweeps and serves clients, our most valuable long-term moat is the **longitudinal dataset** of raw multilingual feeds, extracted claims, corroboration lineages, entity mappings, real-world disruption durations, and human-in-the-loop feedback.

To ensure we can train and fine-tune internal models in the future without ever violating `docs/PRIVACY_CONTRACT.md` or GDPR:

1. **What We Save:**
   - **Public Intelligence Stream:** Every raw Stage 1 & Stage 2 feed item (UTF-8 text, title, summary, URL, publisher domain, language, timestamps, SHA-256 hash), pre-filter pass/drop decisions, LLM extraction outputs + `evidenceQuote` spans, dedupe merges, and full event lifecycle timestamps (`PLANNED -> ACTIVE -> RESOLVED` to measure true disruption durations).
   - **Adjudication & Operational Signals:** Structured alert dismissal reasons (`WRONG_ENTITY_OR_SITE`, `FALSE_OR_OUTDATED_EVENT`, etc.), public entity-alias pairs from registry enrichment, and de-identified disruption duration/recovery outcomes.
2. **How We Separate It (Two-Plane Training Vault):**
   - **Plane A (`GLOBAL_PUBLIC`):** 100% tenant-free public news, extraction, entity-alias, and event-lifecycle corpus. Immediately usable for training multilingual classifiers, entity resolvers, and corroboration models.
   - **Plane B (`ANONYMIZED_OUTCOMES`):** De-identified feedback and recovery statistics with all `orgId`, partner identities, private facility coordinates, unit prices, and revenues stripped at ingestion time.
3. **Where We Store It:**
   - Keep **ArcadeDB** lean as the hot operational graph.
   - Write append-only, date-partitioned, compressed **JSONL (`.jsonl.gz` / `.jsonl.zst`) or Parquet** batches to a low-cost EU-sovereign Object Storage bucket (e.g., Hetzner Object Storage in Helsinki/Falkenstein at ~€5/TB/month, with a local directory fallback in development):
     `training-vault/v1/{plane}/{dataset}/year=YYYY/month=MM/day=DD/{sweepId}.jsonl.gz`
