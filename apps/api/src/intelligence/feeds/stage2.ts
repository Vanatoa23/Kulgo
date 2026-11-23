import { CHOKEPOINT_REGISTRY } from "@kulgo/engine";
import {
  ChokepointCodeSchema,
  RiskSignalKindSchema,
  RiskSignalLifecycleSchema,
  RiskSignalSchema,
  RiskStatusSchema,
  type RiskSignal,
} from "@kulgo/shared";
import { z } from "zod";
import {
  computeCanonicalDedupeKey,
  trigramJaccardSimilarity,
} from "../dedupe.js";
import type { LlmRouter } from "../llm-router.js";

export interface UnstructuredFeedItem {
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: string;
}

const ExtractedSignalItemSchema = z.object({
  kind: RiskSignalKindSchema,
  severity: RiskStatusSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().default(null),
  affectedCountryCodes: z.array(z.string().length(2)).default([]),
  affectedChokepoints: z.array(ChokepointCodeSchema).default([]),
  affectedSectors: z.array(z.string().max(100)).default([]),
  lifecycle: RiskSignalLifecycleSchema.default("ACTIVE"),
  sourceUrl: z.string().url(),
  publishedAt: z.string().datetime().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.7),
});

export const Stage2ExtractionBatchSchema = z.object({
  signals: z.array(ExtractedSignalItemSchema),
});

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
Return strict JSON matching: { "signals": [ { "kind", "severity", "title", "description", "affectedCountryCodes", "affectedChokepoints", "affectedSectors", "lifecycle", "sourceUrl", "publishedAt", "confidence" } ] }.
Valid kind: SANCTIONS | GEOPOLITICAL | MARITIME_CHOKEPOINT | PORT_CONGESTION | CLIMATE | LABOR_INDUSTRIAL | CYBER_FINANCIAL.
Valid severity: GREEN | YELLOW | RED.
Valid lifecycle: PLANNED | ACTIVE | RESOLVED.`;

function resolveFallbackPolygonWkt(
  chokepoints: readonly (keyof typeof CHOKEPOINT_REGISTRY)[],
): string {
  const first = chokepoints[0];
  if (first && CHOKEPOINT_REGISTRY[first]) {
    return CHOKEPOINT_REGISTRY[first].polygonWkt;
  }
  // Coarse EU/Baltic fallback polygon when an unstructured article only specifies country/sector
  return "POLYGON ((10.0 46.0, 29.0 46.0, 29.0 60.5, 10.0 60.5, 10.0 46.0))";
}

/**
 * Classifies pre-filtered unstructured feed items in batches of 10-15 via the
 * AI API Centre (`LlmRouter`). Single-source unstructured detections are marked
 * `ALLEGED` until corroborated by a second independent source domain on merge.
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

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const userPrompt = JSON.stringify(batch);

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
        if (item.severity === "GREEN") continue;
        const publishedAt = item.publishedAt ?? nowIso;
        const canonicalLocation =
          item.affectedChokepoints[0] ??
          item.affectedCountryCodes[0] ??
          item.title.slice(0, 40);
        const dedupeKey = computeCanonicalDedupeKey(
          item.kind,
          canonicalLocation,
          publishedAt,
        );
        const expiresAt = new Date(
          Date.parse(nowIso) + 7 * 86_400_000,
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
              item.affectedCountryCodes[0] ??
              null,
            affectedCountryCodes: item.affectedCountryCodes.map((c) =>
              c.toUpperCase(),
            ),
            affectedChokepoints: item.affectedChokepoints,
            affectedSectors: item.affectedSectors,
            polygonWkt: resolveFallbackPolygonWkt(item.affectedChokepoints),
            sourceUrls: [item.sourceUrl],
            publishedAt,
            lastSeenAt: nowIso,
            expiresAt,
            resolvedAt: null,
            dedupeKey,
            confidence: item.confidence,
            verificationStatus: "ALLEGED",
            lifecycle: item.lifecycle,
            active: item.lifecycle !== "RESOLVED",
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

