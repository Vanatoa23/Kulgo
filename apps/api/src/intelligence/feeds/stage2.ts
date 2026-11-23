import { CHOKEPOINT_REGISTRY } from "@kulgo/engine";
import {
  ChokepointCodeSchema,
  RiskSignalKindSchema,
  RiskSignalLifecycleSchema,
  RiskSignalSchema,
  RiskStatusSchema,
  type RiskSignal,
  type RiskSignalLifecycle,
} from "@kulgo/shared";
import { z } from "zod";
import {
  buildEventDiscriminator,
  computeCanonicalDedupeKey,
  trigramJaccardSimilarity,
} from "../dedupe.js";
import type { LlmRouter } from "../llm-router.js";

export interface UnstructuredFeedItem {
  articleId?: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: string;
}

export const ExtractedSignalItemSchema = z
  .object({
    articleId: z.string().trim().min(1).max(64),
    evidenceQuote: z.string().trim().min(6).max(400),
    kind: RiskSignalKindSchema,
    severity: RiskStatusSchema,
    title: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().default(null),
    affectedCountryCodes: z.array(z.string().length(2)).default([]),
    affectedChokepoints: z.array(ChokepointCodeSchema).default([]),
    affectedSectors: z.array(z.string().max(100)).default([]),
    lifecycle: RiskSignalLifecycleSchema.default("ACTIVE"),
    eventStartAt: z.string().datetime().nullable().optional().default(null),
    eventEndAt: z.string().datetime().nullable().optional().default(null),
    confidence: z.number().min(0).max(1).default(0.7),
  })
  .strict();

export const Stage2ExtractionBatchSchema = z
  .object({
    signals: z.array(ExtractedSignalItemSchema),
  })
  .strict();

export const DISRUPTION_KEYWORD_PATTERN = new RegExp(
  [
    // Prefix boundary (start of string or non-letter/number) + stem/prefix keywords
    "(?:^|[^\\p{L}\\p{N}])(?:" +
      [
        // English
        "strike",
        "walkout",
        "blockade",
        "port",
        "ports",
        "canal",
        "sanction",
        "sanctions",
        "embargo",
        "tariff",
        "tariffs",
        "ransomware",
        "cyberattack",
        "bankruptcy",
        "insolvency",
        "outage",
        "shutdown",
        "flood",
        "floods",
        "storm",
        "rail",
        "customs",
        "border",
        // Estonian (EE)
        "tööseisak",
        "streik",
        "streig",
        "pankrot",
        "tarneraskus",
        "tarnehäir",
        "katkestus",
        "elektrikatkestus",
        "sadam",
        "torm",
        "üleujutus",
        "küberrünnak",
        "sanktsioon",
        "blokaad",
        "piiripunkt",
        "raudtee",
        // Finnish (FI)
        "lakko",
        "satamalakko",
        "työnseisaus",
        "konkurssi",
        "toimitushäiriö",
        "sähkökatko",
        "tulva",
        "myrsky",
        "kyberhyökkäys",
        "pakote",
        "pakotteet",
        "satama",
        // Swedish (SE)
        "strejk",
        "hamnstrejk",
        "konkurs",
        "leveransstörning",
        "strömavbrott",
        "driftstopp",
        "översvämning",
        "cyberattack",
        "blockad",
        // Latvian (LV)
        "streiks",
        "streik",
        "bankrots",
        "bankrot",
        "plūdi",
        "vētra",
        "osta",
        "ostas",
        "sankcijas",
        "kiberuzbrukums",
        "pārtraukums",
        "dzelzceļ",
        // Lithuanian (LT)
        "streikas",
        "bankrotas",
        "uostas",
        "uosto",
        "potvynis",
        "audra",
        "sankcijos",
        "kibernetin",
        "sutrikim",
        "geležinkel",
        // German (DE)
        "warnstreik",
        "hafenstreik",
        "insolvenz",
        "lieferengpass",
        "lieferstopp",
        "stromausfall",
        "betriebsausfall",
        "überschwemmung",
        "hochwasser",
        "sturmflut",
        "cyberangriff",
        "hafen",
        "zoll",
        // French (FR)
        "grève",
        "greve",
        "faillite",
        "inondation",
        "tempête",
        "cyberattaque",
        "pénurie",
        "douane",
        // Polish (PL)
        "strajk",
        "upadłość",
        "bankructwo",
        "powódź",
        "awaria",
        "przestój",
        "sankcje",
        "cyberatak",
      ].join("|") +
      ")",
    // Compound-word suffixes (e.g. satamalakko, tööseisak, hafenstreik, hamnstrejk, tarneraskused, elektrikatkestus)
    "(?:tööseisak|streik|pankrot|tarneraskus|katkestus|üleujutus|lakko|konkurssi|strejk|konkurs|insolvenz|ausfall|hochwasser)",
  ].join("|"),
  "iu",
);

/**
 * Zero-token pre-filter:
 * 1. Drops already-seen URLs
 * 2. Requires at least one supply-chain disruption keyword
 * 3. Drops near-duplicate headlines (trigram Jaccard >= 0.75)
 */
export function preFilterUnstructuredItems(
  items: readonly UnstructuredFeedItem[],
  seenUrls: ReadonlySet<string> = new Set(),
  recentTitles: readonly string[] = [],
  changedUrls: ReadonlySet<string> = new Set(),
): UnstructuredFeedItem[] {
  const accepted: UnstructuredFeedItem[] = [];
  const acceptedTitles = [...recentTitles];
  const localUrls = new Set(seenUrls);

  for (const item of items) {
    if (localUrls.has(item.sourceUrl)) continue;

    const haystack = `${item.title} ${item.summary}`.normalize("NFKC");
    if (!DISRUPTION_KEYWORD_PATTERN.test(haystack)) {
      continue;
    }

    const isNearDuplicate = acceptedTitles.some(
      (existing) => trigramJaccardSimilarity(existing, item.title) >= 0.75,
    );
    if (isNearDuplicate && !changedUrls.has(item.sourceUrl)) continue;

    localUrls.add(item.sourceUrl);
    acceptedTitles.push(item.title);
    accepted.push(item);
  }

  return accepted;
}

const STAGE2_SYSTEM_PROMPT = `You are Kulgo's Supply Chain Disruption Intelligence classifier.
Extract ONLY real, operational supply-chain disruptions (sanctions, maritime chokepoints, port congestion, extreme weather, labor strikes, factory/grid outages, logistics cyberattacks, or corporate insolvencies).
Ignore routine market commentary, opinion pieces, or unrelated news.
Each input article includes an explicit "articleId".
For every extracted disruption, you MUST return the matching "articleId" and a verbatim "evidenceQuote" substring copied directly from that input article's title or summary.
Do NOT invent or return "sourceUrl", "publishedAt", or any extra fields.
Return strict JSON matching: { "signals": [ { "articleId", "evidenceQuote", "kind", "severity", "title", "description", "affectedCountryCodes", "affectedChokepoints", "affectedSectors", "lifecycle", "eventStartAt", "eventEndAt", "confidence" } ] }.
Valid kind: SANCTIONS | GEOPOLITICAL | MARITIME_CHOKEPOINT | PORT_CONGESTION | CLIMATE | LABOR_INDUSTRIAL | CYBER_FINANCIAL.
Valid severity: GREEN | YELLOW | RED.
Valid lifecycle: PLANNED | ACTIVE | RESOLVED.
Set eventStartAt / eventEndAt to ISO-8601 UTC datetimes only when the article states when the disruption starts or ends; otherwise null.`;

function normalizeForQuoteMatch(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Verifies that an LLM-returned evidenceQuote appears verbatim (modulo
 * Unicode NFKC & whitespace normalization) in the matched input article.
 */
export function isVerbatimEvidenceQuote(
  quote: string,
  article: Pick<UnstructuredFeedItem, "title" | "summary">,
): boolean {
  const normalizedQuote = normalizeForQuoteMatch(quote);
  if (normalizedQuote.length < 6) {
    return false;
  }
  const normalizedTitle = normalizeForQuoteMatch(article.title);
  const normalizedSummary = normalizeForQuoteMatch(article.summary);
  const combined = `${normalizedTitle} ${normalizedSummary}`.trim();
  return (
    normalizedTitle.includes(normalizedQuote) ||
    normalizedSummary.includes(normalizedQuote) ||
    combined.includes(normalizedQuote)
  );
}

function resolveSignalPolygonWkt(
  chokepoints: readonly (keyof typeof CHOKEPOINT_REGISTRY)[],
): string {
  const first = chokepoints[0];
  if (first && CHOKEPOINT_REGISTRY[first]) {
    return CHOKEPOINT_REGISTRY[first].polygonWkt;
  }
  // Keep country/sector-only signals free of fabricated continental polygons so
  // Layer 1 matches them strictly at the COUNTRY / REGION / SECTOR level.
  return "POLYGON EMPTY";
}

function resolveLifecycleFromEventWindow(
  extractedLifecycle: RiskSignalLifecycle,
  eventStartAt: string | null,
  eventEndAt: string | null,
  nowMs: number,
): RiskSignalLifecycle {
  if (extractedLifecycle === "RESOLVED") {
    return "RESOLVED";
  }
  if (eventEndAt) {
    const endMs = Date.parse(eventEndAt);
    if (!Number.isNaN(endMs) && endMs <= nowMs) {
      return "RESOLVED";
    }
  }
  if (eventStartAt) {
    const startMs = Date.parse(eventStartAt);
    if (!Number.isNaN(startMs) && startMs > nowMs) {
      return "PLANNED";
    }
  }
  return extractedLifecycle;
}

/**
 * Classifies pre-filtered unstructured feed items in batches of 10-15 via the
 * AI API Centre (`LlmRouter`). Single-source unstructured detections are marked
 * `ALLEGED` until corroborated by a second independent non-syndicated source
 * domain on merge.
 */
export async function classifyUnstructuredItems(
  items: readonly UnstructuredFeedItem[],
  llmRouter: LlmRouter,
  nowIso = new Date().toISOString(),
  batchSize = 12,
): Promise<{ signals: RiskSignal[]; providersUsed: string[]; errors: string[] }> {
  const signals: RiskSignal[] = [];
  const providersUsed = new Set<string>();
  const errors: string[] = [];

  if (items.length === 0 || llmRouter.configuredProviders.length === 0) {
    return { signals, providersUsed: [], errors };
  }

  const nowMs = Date.parse(nowIso);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const articleById = new Map<string, UnstructuredFeedItem>();
    const promptBatch: Array<{
      articleId: string;
      title: string;
      summary: string;
      publishedAt: string;
    }> = [];

    for (let idx = 0; idx < batch.length; idx++) {
      const article = batch[idx]!;
      const preferredId = article.articleId?.trim();
      const articleId =
        preferredId && !articleById.has(preferredId)
          ? preferredId
          : `art-${i + idx + 1}`;
      articleById.set(articleId, article);
      promptBatch.push({
        articleId,
        title: article.title,
        summary: article.summary,
        publishedAt: article.publishedAt,
      });
    }

    const userPrompt = JSON.stringify(promptBatch);

    try {
      const result = await llmRouter.generateStructured(
        Stage2ExtractionBatchSchema,
        {
          systemPrompt: STAGE2_SYSTEM_PROMPT,
          userPrompt,
        },
      );
      providersUsed.add(`${result.provider}:${result.model}`);

      for (const item of result.data.signals) {
        const matchedArticle = articleById.get(item.articleId);
        if (!matchedArticle) {
          errors.push(
            `Stage2 batch ${i}: rejected extraction with unknown articleId "${item.articleId}"`,
          );
          continue;
        }
        if (!isVerbatimEvidenceQuote(item.evidenceQuote, matchedArticle)) {
          errors.push(
            `Stage2 batch ${i}: rejected extraction for "${item.articleId}" with non-verbatim evidenceQuote`,
          );
          continue;
        }
        if (item.severity === "GREEN") continue;

        const parsedPublishedMs = Date.parse(matchedArticle.publishedAt);
        const publishedAt = !Number.isNaN(parsedPublishedMs)
          ? new Date(parsedPublishedMs).toISOString()
          : nowIso;
        const eventStartAt = item.eventStartAt ?? null;
        const eventEndAt = item.eventEndAt ?? null;
        const lifecycle = resolveLifecycleFromEventWindow(
          item.lifecycle,
          eventStartAt,
          eventEndAt,
          nowMs,
        );

        const canonicalLocation =
          item.affectedChokepoints[0] ??
          item.affectedCountryCodes[0]?.toUpperCase() ??
          item.title.slice(0, 40);
        const eventDiscriminator = buildEventDiscriminator(item.title);
        const dedupeKey = computeCanonicalDedupeKey(
          item.kind,
          canonicalLocation,
          publishedAt,
          eventDiscriminator,
        );

        const startMs = eventStartAt ? Date.parse(eventStartAt) : Number.NaN;
        const stalenessAnchorMs =
          !Number.isNaN(startMs) && startMs > nowMs ? startMs : nowMs;
        const expiresAt = new Date(
          stalenessAnchorMs + 7 * 86_400_000,
        ).toISOString();

        signals.push(
          RiskSignalSchema.parse({
            signalId: `sig-s2-${dedupeKey.slice(0, 16)}`,
            kind: item.kind,
            severity: item.severity,
            title: item.title,
            description: item.description,
            regionCode:
              item.affectedChokepoints[0] ??
              item.affectedCountryCodes[0]?.toUpperCase() ??
              null,
            affectedCountryCodes: item.affectedCountryCodes.map((c) =>
              c.toUpperCase(),
            ),
            affectedChokepoints: item.affectedChokepoints,
            affectedSectors: item.affectedSectors,
            polygonWkt: resolveSignalPolygonWkt(item.affectedChokepoints),
            sourceUrls: [matchedArticle.sourceUrl],
            evidenceQuotes: [item.evidenceQuote.trim()],
            publishedAt,
            lastSeenAt: nowIso,
            eventStartAt,
            eventEndAt,
            expiresAt,
            resolvedAt: lifecycle === "RESOLVED" ? (eventEndAt ?? nowIso) : null,
            dedupeKey,
            confidence: item.confidence,
            verificationStatus: "ALLEGED",
            lifecycle,
            active: lifecycle !== "RESOLVED",
          }),
        );
      }
    } catch (err) {
      errors.push(
        `Stage2 batch ${i}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    signals,
    providersUsed: Array.from(providersUsed),
    errors,
  };
}

