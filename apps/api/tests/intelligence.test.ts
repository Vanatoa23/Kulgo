import { matchFacilityRiskSignals } from "@kulgo/engine";
import { RiskSignalSchema } from "@kulgo/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InMemoryRiskSignalRepository } from "../src/analytics/risk-signals.js";
import { createTestApp } from "../src/app.js";
import { InMemoryAlertRepository } from "../src/intelligence/alert-repository.js";
import {
  areSignalsSameEvent,
  computeCanonicalDedupeKey,
  extractSourceDomain,
  trigramJaccardSimilarity,
} from "../src/intelligence/dedupe.js";
import {
  parseGdacsGeoJson,
  parseMeteoAlarmAtomXml,
  parsePortWatchGeoJson,
  parseUsgsGeoJson,
} from "../src/intelligence/feeds/stage1.js";
import {
  classifyUnstructuredItems,
  preFilterUnstructuredItems,
  Stage2ExtractionBatchSchema,
} from "../src/intelligence/feeds/stage2.js";
import { LlmRouter, type LlmProviderAdapter } from "../src/intelligence/llm-router.js";
import {
  dispatchInstantRedAlerts,
  InMemoryCaptureEmailProvider,
  signWebhookPayload,
} from "../src/intelligence/notifications.js";
import { msUntilNextUtcSweep } from "../src/intelligence/scheduler.js";

describe("Stage 1 deterministic structured feed parsers", () => {
  it("parses GDACS GeoJSON into CONFIRMED WKT RiskSignals and skips GREEN events", () => {
    const signals = parseGdacsGeoJson(
      {
        features: [
          {
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [24.0, 59.0],
                  [25.5, 59.0],
                  [25.5, 59.8],
                  [24.0, 59.8],
                  [24.0, 59.0],
                ],
              ],
            },
            properties: {
              eventid: 1042,
              eventtype: "FL",
              alertlevel: "Red",
              name: "Baltic Coastal Flood",
              description: "Severe coastal flooding near port infrastructure",
              country: "EE",
              fromdate: "2026-11-21T06:00:00Z",
              url: { report: "https://www.gdacs.org/report.aspx?eventid=1042" },
            },
          },
          {
            geometry: { type: "Point", coordinates: [10, 50] },
            properties: {
              eventid: 1043,
              eventtype: "EQ",
              alertlevel: "Green",
              name: "Minor Tremor",
            },
          },
        ],
      },
      "2026-11-21T08:00:00Z",
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]!.severity).toBe("RED");
    expect(signals[0]!.verificationStatus).toBe("CONFIRMED");
    expect(signals[0]!.polygonWkt).toContain("POLYGON ((");
    expect(signals[0]!.sourceUrls).toEqual([
      "https://www.gdacs.org/report.aspx?eventid=1042",
    ]);
  });

  it("parses USGS M5.5+ earthquakes and IMF PortWatch chokepoint transit drops", () => {
    const quakes = parseUsgsGeoJson({
      features: [
        {
          id: "us7000abcd",
          geometry: { type: "Point", coordinates: [140.5, 36.2] },
          properties: {
            mag: 6.9,
            place: "Eastern Honshu, Japan",
            time: Date.parse("2026-11-21T04:00:00Z"),
            alert: "red",
            title: "M 6.9 - Eastern Honshu",
            url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
          },
        },
      ],
    });
    expect(quakes).toHaveLength(1);
    expect(quakes[0]!.severity).toBe("RED");

    const chokepoints = parsePortWatchGeoJson({
      features: [
        {
          properties: {
            chokepoint_name: "Suez Canal",
            transit_drop_pct: 52,
            date: "2026-11-21T00:00:00Z",
          },
        },
        {
          properties: {
            chokepoint_name: "Panama Canal",
            transit_drop_pct: 10,
          },
        },
      ],
    });
    expect(chokepoints).toHaveLength(1);
    expect(chokepoints[0]!.affectedChokepoints).toEqual(["SUEZ_CANAL"]);
    expect(chokepoints[0]!.severity).toBe("RED");
  });

  it("parses MeteoAlarm CAP 1.2 Atom XML for EU/Baltic severe weather", () => {
    const xml = `
      <feed>
        <entry>
          <id>urn:oid:ee-storm-01</id>
          <title>Extreme coastal windstorm warning</title>
          <link href="https://meteoalarm.org/en/live/region/EE" />
          <cap:event>Coastal Windstorm</cap:event>
          <cap:severity>Extreme</cap:severity>
          <cap:areaDesc>Harju County</cap:areaDesc>
          <cap:sent>2026-11-21T06:00:00Z</cap:sent>
          <cap:expires>2026-11-22T06:00:00Z</cap:expires>
          <cap:polygon>59.0,24.0 59.0,25.5 59.8,25.5 59.8,24.0 59.0,24.0</cap:polygon>
        </entry>
      </feed>
    `;
    const signals = parseMeteoAlarmAtomXml(xml, "EE", "2026-11-21T08:00:00Z");
    expect(signals).toHaveLength(1);
    expect(signals[0]!.severity).toBe("RED");
    expect(signals[0]!.affectedCountryCodes).toEqual(["EE"]);
    expect(signals[0]!.polygonWkt).toContain("24 59");
  });
});

describe("AI API Centre (LlmRouter) & Stage 2 classification", () => {
  it("fails over automatically from primary provider to fallback provider", async () => {
    const failingPrimary: LlmProviderAdapter = {
      name: "gemini",
      model: "gemini-2.5-flash-lite",
      async completeJson() {
        throw new Error("Gemini HTTP 429");
      },
    };
    const healthyFallback: LlmProviderAdapter = {
      name: "groq",
      model: "llama-3.3-70b-versatile",
      async completeJson() {
        return JSON.stringify({ ok: true, category: "LABOR_INDUSTRIAL" });
      },
    };

    const router = new LlmRouter([failingPrimary, healthyFallback]);
    const res = await router.generateStructured(
      z.object({ ok: z.boolean(), category: z.string() }),
      { systemPrompt: "sys", userPrompt: "usr" },
    );

    expect(res.provider).toBe("groq");
    expect(res.data.ok).toBe(true);
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0]?.error).toContain("429");
  });

  it("pre-filters duplicates/irrelevant items, binds server-verified provenance, blocks syndication self-corroboration, and promotes genuine independent corroboration", async () => {
    const items = preFilterUnstructuredItems([
      {
        articleId: "hamburg-1",
        title: "Port of Hamburg dockworkers announce 48-hour strike",
        summary: "Container terminal operations halted across Hamburg berths.",
        sourceUrl: "https://www.reuters.com/world/hamburg-strike",
        publishedAt: "2026-11-21T07:00:00Z",
      },
      {
        // Near-duplicate headline should be dropped by trigram Jaccard
        title: "Port of Hamburg dockworkers announce 48-hour strike!",
        summary: "Syndicated copy",
        sourceUrl: "https://mirror.example/hamburg-strike",
        publishedAt: "2026-11-21T07:05:00Z",
      },
      {
        // Irrelevant article (no disruption keyword)
        title: "Quarterly earnings beat expectations",
        summary: "Strong revenue growth reported",
        sourceUrl: "https://finance.example/earnings",
        publishedAt: "2026-11-21T07:10:00Z",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(
      trigramJaccardSimilarity(
        "Port of Hamburg dockworkers announce 48-hour strike",
        "Port of Hamburg dockworkers announce 48-hour strike!",
      ),
    ).toBeGreaterThanOrEqual(0.75);

    let capturedUserPrompt = "";
    const mockRouter = new LlmRouter([
      {
        name: "gemini",
        model: "gemini-2.5-flash-lite",
        async completeJson(req) {
          capturedUserPrompt = req.userPrompt;
          return JSON.stringify({
            signals: [
              {
                articleId: "hamburg-1",
                evidenceQuote: "Container terminal operations halted across Hamburg berths",
                kind: "LABOR_INDUSTRIAL",
                severity: "RED",
                title: "Port of Hamburg 48-hour Dockworker Strike",
                description: "Terminal operations suspended across Hamburg.",
                affectedCountryCodes: ["DE"],
                affectedChokepoints: ["NORTH_SEA"],
                affectedSectors: ["Logistics"],
                lifecycle: "ACTIVE",
                confidence: 0.85,
              },
            ],
          });
        },
      },
    ]);

    const classified = await classifyUnstructuredItems(
      items,
      mockRouter,
      "2026-11-21T08:00:00Z",
    );
    expect(classified.errors).toEqual([]);
    expect(classified.signals).toHaveLength(1);
    // Input prompt must include explicit articleId and omit sourceUrl
    expect(capturedUserPrompt).toContain('"articleId":"hamburg-1"');
    expect(capturedUserPrompt).not.toContain("reuters.com");
    // Server attaches verified sourceUrl and publishedAt from matched input article
    expect(classified.signals[0]!.sourceUrls).toEqual([
      "https://www.reuters.com/world/hamburg-strike",
    ]);
    expect(classified.signals[0]!.publishedAt).toBe("2026-11-21T07:00:00.000Z");
    expect(classified.signals[0]!.evidenceQuotes).toEqual([
      "Container terminal operations halted across Hamburg berths",
    ]);
    expect(classified.signals[0]!.verificationStatus).toBe("ALLEGED");

    // Upsert first report -> ALLEGED
    const repo = new InMemoryRiskSignalRepository([]);
    const first = await repo.upsertSignal(classified.signals[0]!);
    expect(first.created).toBe(true);
    expect(first.signal.verificationStatus).toBe("ALLEGED");

    // Same publisher on a different subdomain -> collapses to reuters.com, stays ALLEGED
    const subdomainReport = {
      ...classified.signals[0]!,
      signalId: "sig-s2-reuters-uk",
      title: "Port of Hamburg 48-hour Dockworker Strike enters afternoon",
      evidenceQuotes: ["Vessels anchored off Elbe estuary as union talks stall"],
      sourceUrls: ["https://uk.reuters.com/world/hamburg-strike-update"],
    };
    const mergedSubdomain = await repo.upsertSignal(subdomainReport);
    expect(mergedSubdomain.created).toBe(false);
    expect(mergedSubdomain.signal.verificationStatus).toBe("ALLEGED");

    // Verbatim syndicated copy on a different domain -> merges URL but stays ALLEGED
    const syndicatedReport = {
      ...classified.signals[0]!,
      signalId: "sig-s2-syndicated-wire",
      sourceUrls: ["https://finance.yahoo.com/news/hamburg-strike-reuters"],
    };
    const mergedSyndicated = await repo.upsertSignal(syndicatedReport);
    expect(mergedSyndicated.created).toBe(false);
    expect(mergedSyndicated.signal.verificationStatus).toBe("ALLEGED");

    // Second independent domain with distinct reporting -> merges & promotes to CORROBORATED
    const independentReport = {
      ...classified.signals[0]!,
      signalId: "sig-s2-second-domain",
      title: "Hamburg container terminals shut down as dockworker walkout widens",
      description: "Shipping lines divert vessels to Bremerhaven and Rotterdam.",
      evidenceQuotes: ["Shipping lines diverted six container vessels away from Hamburg"],
      sourceUrls: ["https://lloydslist.example/hamburg-strike-confirmed"],
    };
    const merged = await repo.upsertSignal(independentReport);
    expect(merged.created).toBe(false);
    expect(merged.signal.signalId).toBe(first.signal.signalId);
    expect(merged.signal.sourceUrls).toHaveLength(4);
    expect(merged.signal.verificationStatus).toBe("CORROBORATED");
  });

  it("enforces .strict() on Stage 2 schemas and rejects unknown articleId or fabricated quotes", async () => {
    // .strict() rejects LLM-invented sourceUrl or extra fields
    expect(() =>
      Stage2ExtractionBatchSchema.parse({
        signals: [
          {
            articleId: "art-1",
            evidenceQuote: "Port of Tallinn strike",
            kind: "LABOR_INDUSTRIAL",
            severity: "RED",
            title: "Port of Tallinn Strike",
            sourceUrl: "https://hallucinated.example/fake",
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      Stage2ExtractionBatchSchema.parse({
        signals: [],
        extraMetadata: true,
      }),
    ).toThrow();

    const routerWithBadProvenance = new LlmRouter([
      {
        name: "gemini",
        model: "gemini-2.5-flash-lite",
        async completeJson() {
          return JSON.stringify({
            signals: [
              {
                articleId: "unknown-999",
                evidenceQuote: "Container terminal operations halted",
                kind: "LABOR_INDUSTRIAL",
                severity: "RED",
                title: "Ghost Strike",
                affectedCountryCodes: ["DE"],
              },
              {
                articleId: "art-1",
                evidenceQuote: "Fabricated quote not present in source article text",
                kind: "LABOR_INDUSTRIAL",
                severity: "RED",
                title: "Hallucinated Strike",
                affectedCountryCodes: ["DE"],
              },
            ],
          });
        },
      },
    ]);

    const res = await classifyUnstructuredItems(
      [
        {
          title: "Port of Hamburg dockworkers announce 48-hour strike",
          summary: "Container terminal operations halted across Hamburg berths.",
          sourceUrl: "https://reuters.example/hamburg-strike",
          publishedAt: "2026-11-21T07:00:00Z",
        },
      ],
      routerWithBadProvenance,
      "2026-11-21T08:00:00Z",
    );
    expect(res.signals).toHaveLength(0);
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0]).toContain("unknown articleId");
    expect(res.errors[1]).toContain("non-verbatim evidenceQuote");
  });

  it("omits fake EU/Baltic fallback polygon for country-only Stage 2 signals so neighboring countries are not hit", async () => {
    const countryOnlyRouter = new LlmRouter([
      {
        name: "gemini",
        model: "gemini-2.5-flash-lite",
        async completeJson() {
          return JSON.stringify({
            signals: [
              {
                articleId: "art-1",
                evidenceQuote: "Nationwide rail freight strike disrupts German industrial corridors",
                kind: "LABOR_INDUSTRIAL",
                severity: "RED",
                title: "German Rail Freight Strike",
                description: "Freight trains halted across Germany.",
                affectedCountryCodes: ["DE"],
                affectedChokepoints: [],
                affectedSectors: [],
                lifecycle: "ACTIVE",
                confidence: 0.85,
              },
            ],
          });
        },
      },
    ]);

    const res = await classifyUnstructuredItems(
      [
        {
          title: "Nationwide rail freight strike disrupts German industrial corridors",
          summary: "Train drivers begin 48-hour walkout across Germany.",
          sourceUrl: "https://dw.example/de-rail-strike",
          publishedAt: "2026-11-21T07:00:00Z",
        },
      ],
      countryOnlyRouter,
      "2026-11-21T08:00:00Z",
    );

    expect(res.signals).toHaveLength(1);
    expect(res.signals[0]!.polygonWkt).toBe("POLYGON EMPTY");

    // Facility in Germany matches via COUNTRY; facility in Estonia (previously inside fake EU/Baltic box) does NOT match
    const matches = matchFacilityRiskSignals(
      [
        { facilityId: "fac-de", lat: 52.52, lng: 13.405, countryCode: "DE", regionCode: "DE-BE" },
        { facilityId: "fac-ee", lat: 59.437, lng: 24.7536, countryCode: "EE", regionCode: "EE-37" },
      ],
      res.signals,
      "2026-11-21T08:00:00Z",
    );
    expect(matches).toEqual([
      {
        facilityId: "fac-de",
        signalId: res.signals[0]!.signalId,
        matchType: "COUNTRY",
        severity: "RED",
      },
    ]);
  });

  it("extracts true registrable domains across subdomains and multi-part public suffixes", () => {
    expect(extractSourceDomain("https://www.reuters.com/world/a")).toBe("reuters.com");
    expect(extractSourceDomain("https://uk.reuters.com/world/b")).toBe("reuters.com");
    expect(extractSourceDomain("https://m.bbc.co.uk/news/business-123")).toBe("bbc.co.uk");
    expect(extractSourceDomain("https://www.bbc.co.uk/news/business-456")).toBe("bbc.co.uk");
    expect(extractSourceDomain("https://news.err.ee/1609123")).toBe("err.ee");
    expect(extractSourceDomain("not-a-url")).toBeNull();
  });

  it("keeps unrelated same-country/same-week events separate while merging ongoing events across an ISO-week boundary", async () => {
    const router = new LlmRouter([
      {
        name: "gemini",
        model: "gemini-2.5-flash-lite",
        async completeJson(req) {
          const batch = JSON.parse(req.userPrompt) as Array<{ articleId: string; title: string; summary: string }>;
          return JSON.stringify({
            signals: batch.map((a) => {
              if (a.articleId === "hamburg-sun") {
                return {
                  articleId: a.articleId,
                  evidenceQuote: "Port of Hamburg dockworkers begin strike",
                  kind: "LABOR_INDUSTRIAL",
                  severity: "RED",
                  title: "Port of Hamburg Dockworker Strike",
                  affectedCountryCodes: ["DE"],
                  affectedChokepoints: [],
                };
              }
              if (a.articleId === "munich-sun") {
                return {
                  articleId: a.articleId,
                  evidenceQuote: "Munich automotive assembly plant workers walk out",
                  kind: "LABOR_INDUSTRIAL",
                  severity: "YELLOW",
                  title: "Munich Automotive Assembly Plant Walkout",
                  affectedCountryCodes: ["DE"],
                  affectedChokepoints: [],
                };
              }
              return {
                articleId: a.articleId,
                evidenceQuote: "Hamburg container terminals remain closed on Monday",
                kind: "LABOR_INDUSTRIAL",
                severity: "RED",
                title: "Port of Hamburg Dockworker Strike Continues on Day Two",
                affectedCountryCodes: ["DE"],
                affectedChokepoints: [],
              };
            }),
          });
        },
      },
    ]);

    // Sunday 2026-11-22 is 2026-W47; Monday 2026-11-23 is 2026-W48
    const sundayBatch = await classifyUnstructuredItems(
      [
        {
          articleId: "hamburg-sun",
          title: "Port of Hamburg dockworkers begin strike",
          summary: "Cargo handling halted on Sunday evening.",
          sourceUrl: "https://reuters.com/hamburg-sun",
          publishedAt: "2026-11-22T18:00:00Z",
        },
        {
          articleId: "munich-sun",
          title: "Munich automotive assembly plant workers walk out",
          summary: "Bavarian car plant halts production over wage dispute.",
          sourceUrl: "https://handelsblatt.com/munich-auto",
          publishedAt: "2026-11-22T19:00:00Z",
        },
      ],
      router,
      "2026-11-22T20:00:00Z",
    );

    const mondayBatch = await classifyUnstructuredItems(
      [
        {
          articleId: "hamburg-mon",
          title: "Hamburg container terminals remain closed on Monday",
          summary: "Independent shipping survey confirms ongoing berth closures.",
          sourceUrl: "https://lloydslist.com/hamburg-mon",
          publishedAt: "2026-11-23T08:00:00Z",
        },
      ],
      router,
      "2026-11-23T09:00:00Z",
    );

    const repo = new InMemoryRiskSignalRepository([]);
    const r1 = await repo.upsertSignal(sundayBatch.signals[0]!);
    const r2 = await repo.upsertSignal(sundayBatch.signals[1]!);
    const r3 = await repo.upsertSignal(mondayBatch.signals[0]!);

    // Unrelated Hamburg and Munich strikes in DE/2026-W47 must NOT merge
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
    expect(r2.signal.signalId).not.toBe(r1.signal.signalId);
    expect(r2.signal.verificationStatus).toBe("ALLEGED");

    // Monday's Hamburg update (2026-W48) MUST merge into Sunday's Hamburg signal (2026-W47) and corroborate it
    expect(r3.created).toBe(false);
    expect(r3.signal.signalId).toBe(r1.signal.signalId);
    expect(r3.signal.verificationStatus).toBe("CORROBORATED");
    expect(await repo.listActive()).toHaveLength(2);
  });

  it("separates event validity window (eventStartAt/eventEndAt) from 7-day feed staleness TTL", async () => {
    const repo = new InMemoryRiskSignalRepository([]);

    // Planned strike announced on Day 0 for Day 10..Day 12, even with an aggressive 7-day feed TTL (Day 7)
    const plannedSignal = RiskSignalSchema.parse({
      signalId: "sig-planned-strike",
      kind: "LABOR_INDUSTRIAL",
      severity: "RED",
      title: "Planned Port of Rotterdam Strike",
      affectedCountryCodes: ["NL"],
      polygonWkt: "POLYGON EMPTY",
      sourceUrls: ["https://reuters.com/rotterdam-planned"],
      publishedAt: "2026-11-01T08:00:00Z",
      lastSeenAt: "2026-11-01T08:00:00Z",
      eventStartAt: "2026-11-11T00:00:00Z",
      eventEndAt: "2026-11-13T00:00:00Z",
      expiresAt: "2026-11-08T08:00:00Z",
      lifecycle: "PLANNED",
      verificationStatus: "CORROBORATED",
      active: true,
    });
    await repo.upsertSignal(plannedSignal);

    // Day 9: past 7-day feed TTL (Nov 8), but before eventStartAt (Nov 11) -> MUST stay active & PLANNED
    expect(await repo.resolveExpired("2026-11-09T12:00:00Z")).toBe(0);
    let active = await repo.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]!.lifecycle).toBe("PLANNED");

    // Day 11: eventStartAt reached, still before eventEndAt (Nov 13) -> transitions PLANNED -> ACTIVE
    expect(await repo.resolveExpired("2026-11-11T12:00:00Z")).toBe(0);
    active = await repo.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]!.lifecycle).toBe("ACTIVE");

    // Day 14: past eventEndAt (Nov 13) -> NOW resolves
    expect(await repo.resolveExpired("2026-11-14T00:00:00Z")).toBe(1);
    expect(await repo.listActive()).toHaveLength(0);
  });
});

describe("Anti-fatigue RED alert dispatch & scheduler", () => {
  it("skips ALLEGED rumours, deduplicates repeat (orgId, signalId) deliveries, and signs webhooks", async () => {
    const alertRepo = new InMemoryAlertRepository();
    const orgId = "11111111-1111-4111-8111-111111111111";
    const emailProvider = new InMemoryCaptureEmailProvider();
    const capturedWebhooks: Array<{ url: string; sig: string | null; body: string }> = [];

    await alertRepo.upsertNotificationPreference({
      orgId,
      instantRedEmailEnabled: true,
      emailRecipients: ["ops@kulgo.eu"],
      webhookUrl: "https://hooks.example/kulgo",
      webhookSecret: "super-secret-webhook-signing-key-2026",
    });

    const confirmedSignal = parsePortWatchGeoJson(
      {
        features: [
          {
            properties: {
              chokepoint_name: "Suez Canal",
              transit_drop_pct: 55,
              date: "2026-11-21T00:00:00Z",
            },
          },
        ],
      },
      "2026-11-21T08:00:00Z",
    )[0]!;

    const allegedSignal = {
      ...confirmedSignal,
      signalId: "sig-alleged-rumour",
      verificationStatus: "ALLEGED" as const,
      dedupeKey: computeCanonicalDedupeKey("MARITIME_CHOKEPOINT", "RUMOUR", "2026-11-21T08:00:00Z"),
    };

    const mockFetch: typeof fetch = async (input, init) => {
      const headers = init?.headers as Record<string, string>;
      capturedWebhooks.push({
        url: String(input),
        sig: headers["X-Kulgo-Signature-256"] ?? null,
        body: String(init?.body ?? ""),
      });
      return new Response("ok", { status: 200 });
    };

    const bundles = [
      {
        orgId,
        signal: allegedSignal,
        facilityMatches: [],
        laneMatches: [],
        partnerRegionAlerts: [],
      },
      {
        orgId,
        signal: confirmedSignal,
        facilityMatches: [],
        laneMatches: [
          {
            laneId: "lane-1",
            signalId: confirmedSignal.signalId,
            matchedChokepoints: ["SUEZ_CANAL" as const],
            severity: "RED" as const,
          },
        ],
        partnerRegionAlerts: [],
      },
    ];

    const publicDnsLookup = async () => [
      { address: "93.184.216.34", family: 4 as const },
    ];

    const run1 = await dispatchInstantRedAlerts(bundles, {
      alertRepo,
      redEmailProvider: emailProvider,
      fromEmail: "alerts@kulgo.eu",
      fetchFn: mockFetch,
      webhookDnsLookup: publicDnsLookup,
    });
    expect(run1.skippedUnverified).toBe(1);
    expect(run1.emailsSent).toBe(1);
    expect(run1.webhooksSent).toBe(1);
    expect(capturedWebhooks).toHaveLength(1);
    expect(capturedWebhooks[0]!.sig).toBe(
      signWebhookPayload(
        capturedWebhooks[0]!.body,
        "super-secret-webhook-signing-key-2026",
      ),
    );

    // Repeat run must NOT spam duplicate email or webhook
    const run2 = await dispatchInstantRedAlerts(bundles, {
      alertRepo,
      redEmailProvider: emailProvider,
      fromEmail: "alerts@kulgo.eu",
      fetchFn: mockFetch,
      webhookDnsLookup: publicDnsLookup,
    });
    expect(run2.emailsSent).toBe(0);
    expect(run2.webhooksSent).toBe(0);
    expect(run2.skippedDuplicate).toBe(2);
  });

  it("computes next 3x daily UTC sweep window (06:00, 12:00, 17:00 UTC)", () => {
    const at0500 = new Date("2026-11-21T05:00:00Z");
    expect(msUntilNextUtcSweep(at0500)).toBe(60 * 60 * 1000);

    const at1230 = new Date("2026-11-21T12:30:00Z");
    expect(msUntilNextUtcSweep(at1230)).toBe(4.5 * 60 * 60 * 1000);

    const at1800 = new Date("2026-11-21T18:00:00Z");
    expect(msUntilNextUtcSweep(at1800)).toBe(12 * 60 * 60 * 1000);
  });
});

describe("/api/v1/alerts HTTP routes", () => {
  it("supports live alert feed, acknowledge/mute, notification preferences, and manual sweep", async () => {
    const app = createTestApp();
    const reg = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@alerts-test.eu",
        password: "AlertsTestPassword2026!",
        organizationName: "Baltic Electronics OÜ",
        countryCode: "EE",
        sector: "Electronics",
      }),
    });
    expect(reg.status).toBe(201);
    const cookie = /kulgo_session=([^;]+)/.exec(
      reg.headers.get("set-cookie") ?? "",
    )![0];

    const feedRes = await app.request("/api/v1/alerts/feed", {
      headers: { Cookie: cookie },
    });
    expect(feedRes.status).toBe(200);
    const feed = (await feedRes.json()) as {
      signals: Array<{ signalId: string }>;
      acknowledgements: unknown[];
    };
    expect(feed.signals.length).toBeGreaterThanOrEqual(2);
    expect(feed.acknowledgements).toEqual([]);

    // Acknowledge a signal
    const ackRes = await app.request(
      `/api/v1/alerts/${feed.signals[0]!.signalId}/ack`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ status: "ACKNOWLEDGED", note: "Mitigation underway" }),
      },
    );
    expect(ackRes.status).toBe(200);

    // Update notification preferences
    const prefRes = await app.request("/api/v1/alerts/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        instantRedEmailEnabled: true,
        emailRecipients: ["risk@alerts-test.eu"],
        webhookUrl: "https://hooks.alerts-test.eu/kulgo",
        webhookSecret: "my-strong-webhook-secret-1234",
      }),
    });
    expect(prefRes.status).toBe(200);
    const pref = (await prefRes.json()) as {
      webhookSecretConfigured: boolean;
      emailRecipients: string[];
    };
    expect(pref.webhookSecretConfigured).toBe(true);
    expect(pref.emailRecipients).toEqual(["risk@alerts-test.eu"]);
    // Secret value itself must never be returned in DTO
    expect(JSON.stringify(pref)).not.toContain("my-strong-webhook-secret-1234");

    // Manual sweep trigger (OWNER)
    const sweepRes = await app.request("/api/v1/alerts/sweep", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(sweepRes.status).toBe(200);
  });
});


describe("structured event identity", () => {
  it("keeps separate confirmed weather alerts and their polygons", async () => {
    const repo = new InMemoryRiskSignalRepository([]);
    const base = parseMeteoAlarmAtomXml(`<feed><entry><id>wind-1</id><title>Wind (EE — Harju)</title><cap:event>Wind</cap:event><cap:severity>Severe</cap:severity><cap:areaDesc>Harju</cap:areaDesc><cap:sent>2026-11-21T06:00:00Z</cap:sent><cap:polygon>59,24 59,25 60,25 59,24</cap:polygon></entry></feed>`, "EE", "2026-11-21T08:00:00Z")[0]!;
    const wind = { ...base, signalId: "wind", dedupeKey: "wind-key", title: "Wind (EE — Harju)", verificationStatus: "CONFIRMED" as const };
    const flood = { ...wind, signalId: "flood", dedupeKey: "flood-key", title: "Flood (EE — Harju)", polygonWkt: "POLYGON ((25 59, 26 59, 26 60, 25 59))" };
    expect(areSignalsSameEvent(wind, flood)).toBe(false);
    expect((await repo.upsertSignal(wind)).created).toBe(true);
    expect((await repo.upsertSignal(flood)).created).toBe(true);
    expect((await repo.listActive()).map(s => s.polygonWkt)).toEqual([wind.polygonWkt, flood.polygonWkt]);
  });
});

