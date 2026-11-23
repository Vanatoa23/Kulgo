import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InMemoryRiskSignalRepository } from "../src/analytics/risk-signals.js";
import { createTestApp } from "../src/app.js";
import {
  buildOrgSlug,
  InMemoryAuthRepository,
} from "../src/auth/repository.js";
import { InMemoryAlertRepository } from "../src/intelligence/alert-repository.js";
import {
  buildTrigrams,
  computeCanonicalDedupeKey,
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
} from "../src/intelligence/feeds/stage2.js";
import { LlmRouter, type LlmProviderAdapter } from "../src/intelligence/llm-router.js";
import {
  dispatchInstantRedAlerts,
  InMemoryCaptureEmailProvider,
  signWebhookPayload,
} from "../src/intelligence/notifications.js";
import { IntelligenceRunner } from "../src/intelligence/runner.js";
import { msUntilNextUtcSweep } from "../src/intelligence/scheduler.js";
import { InMemoryInvitationRepository } from "../src/invites/repository.js";
import { InMemoryWorkspaceRepository } from "../src/workspace/repository.js";

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

  it("pre-filters duplicates/irrelevant items and promotes ALLEGED -> CORROBORATED across independent domains", async () => {
    const items = preFilterUnstructuredItems([
      {
        title: "Port of Hamburg dockworkers announce 48-hour strike",
        summary: "Container terminal operations halted",
        sourceUrl: "https://reuters.example/hamburg-strike",
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

    const mockRouter = new LlmRouter([
      {
        name: "gemini",
        model: "gemini-2.5-flash-lite",
        async completeJson() {
          return JSON.stringify({
            signals: [
              {
                kind: "LABOR_INDUSTRIAL",
                severity: "RED",
                title: "Port of Hamburg 48-hour Dockworker Strike",
                description: "Terminal operations suspended across Hamburg.",
                affectedCountryCodes: ["DE"],
                affectedChokepoints: ["NORTH_SEA"],
                affectedSectors: ["Logistics"],
                lifecycle: "ACTIVE",
                sourceUrl: "https://reuters.example/hamburg-strike",
                publishedAt: "2026-11-21T07:00:00Z",
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
    expect(classified.signals).toHaveLength(1);
    expect(classified.signals[0]!.verificationStatus).toBe("ALLEGED");

    // Upsert first report -> ALLEGED
    const repo = new InMemoryRiskSignalRepository([]);
    const first = await repo.upsertSignal(classified.signals[0]!);
    expect(first.created).toBe(true);
    expect(first.signal.verificationStatus).toBe("ALLEGED");

    // Second independent domain reporting same canonical event -> merges & promotes to CORROBORATED
    const secondReport = {
      ...classified.signals[0]!,
      signalId: "sig-s2-second-domain",
      sourceUrls: ["https://lloydslist.example/hamburg-strike-confirmed"],
    };
    const merged = await repo.upsertSignal(secondReport);
    expect(merged.created).toBe(false);
    expect(merged.signal.signalId).toBe(first.signal.signalId);
    expect(merged.signal.sourceUrls).toHaveLength(2);
    expect(merged.signal.verificationStatus).toBe("CORROBORATED");
  });

  it("preserves UTF-8 diacritics in trigrams, matches multilingual Baltic/EU headlines & compounds, transliterates org slugs, and deduplicates across sweeps", async () => {
    // 1. UTF-8 / Unicode trigrams preserve Estonian/Nordic characters instead of splitting into spaces
    const estonianTrigrams = buildTrigrams("Tööseisak Pärnu sadamas");
    expect(estonianTrigrams.has("töö")).toBe(true);
    expect(estonianTrigrams.has("öös")).toBe(true);
    expect(estonianTrigrams.has("pär")).toBe(true);

    // Distinct words with different diacritics should not collapse to identical empty/stripped strings
    expect(trigramJaccardSimilarity("töö", "tää")).toBe(0);
    // Composed (NFC) vs decomposed (NFD) Unicode strings normalize identically via NFKC
    expect(
      trigramJaccardSimilarity(
        "Tööseisak Pärnu sadamas".normalize("NFC"),
        "Tööseisak Pärnu sadamas".normalize("NFD"),
      ),
    ).toBe(1);

    // 2. Multilingual Stage 2 pre-filter accepts Estonian, Finnish, Swedish, German, French, Polish, Latvian, Lithuanian headlines & compounds
    const multilingualBatch = [
      {
        title: "Tööseisak ja tarneraskused Pärnu sadamas",
        summary: "Ulatuslik elektrikatkestus ning torm häirivad laevaliiklust",
        sourceUrl: "https://err.ee/parnu-sadam-tooseisak",
        publishedAt: "2026-11-21T06:00:00Z",
      },
      {
        // Near-duplicate Estonian headline with punctuation difference -> dropped by trigram Jaccard
        title: "Tööseisak ja tarneraskused Pärnu sadamas!",
        summary: "Kordusuudis",
        sourceUrl: "https://postimees.ee/parnu-sadam-tooseisak",
        publishedAt: "2026-11-21T06:05:00Z",
      },
      {
        title: "Satamalakko pysäyttää Vuosaaren konttiliikenteen ja aiheuttaa toimitushäiriöitä",
        summary: "AKT:n lakko ja alihankkijan konkurssi vaikuttavat vientiin",
        sourceUrl: "https://yle.fi/vuosaari-satamalakko",
        publishedAt: "2026-11-21T06:10:00Z",
      },
      {
        title: "Hamnstrejk i Göteborg och plötslig konkurs hos underleverantör",
        summary: "Omfattande leveransstörningar i Västra Götaland",
        sourceUrl: "https://svt.se/goteborg-hamnstrejk",
        publishedAt: "2026-11-21T06:15:00Z",
      },
      {
        title: "Warnstreik und Stromausfall legen Hamburger Hafen lahm",
        summary: "Zulieferer meldet Insolvenz nach Hochwasser an",
        sourceUrl: "https://ndr.de/hamburg-warnstreik-hafen",
        publishedAt: "2026-11-21T06:20:00Z",
      },
      {
        title: "Grève des dockers au port du Havre et faillite d'un transporteur",
        summary: "Blocage logistique majeur",
        sourceUrl: "https://lemonde.fr/le-havre-greve",
        publishedAt: "2026-11-21T06:25:00Z",
      },
      {
        title: "Strajk w porcie Gdańsk oraz upadłość operatora kolejowego",
        summary: "Poważny przestój w terminalu kontenerowym",
        sourceUrl: "https://pap.pl/gdansk-strajk-port",
        publishedAt: "2026-11-21T06:30:00Z",
      },
      {
        title: "Rīgas ostā streiks un spēcīga vētra kavē kravu pārvadājumus",
        summary: "Loģistikas pārtraukums",
        sourceUrl: "https://lsm.lv/rigas-osta-streiks",
        publishedAt: "2026-11-21T06:35:00Z",
      },
      {
        title: "Klaipėdos uoste streikas ir tiekimo sutrikimai dėl audros",
        summary: "Geležinkelio pervežimai sustabdyti",
        sourceUrl: "https://lrt.lt/klaipedos-uostas-streikas",
        publishedAt: "2026-11-21T06:40:00Z",
      },
    ];

    const filteredMultilingual = preFilterUnstructuredItems(multilingualBatch);
    expect(filteredMultilingual).toHaveLength(8);
    expect(
      filteredMultilingual.some(
        (i) => i.sourceUrl === "https://postimees.ee/parnu-sadam-tooseisak",
      ),
    ).toBe(false);

    // 3. Diacritic-safe organization slugs
    expect(buildOrgSlug("Pärnu Tööstus OÜ")).toMatch(
      /^parnu-toostus-ou-[0-9a-f]{8}$/,
    );
    expect(buildOrgSlug("Øresund & Ærø Straßentransport Łódź")).toMatch(
      /^oresund-aero-strassentransport-lodz-[0-9a-f]{8}$/,
    );

    // 4. Cross-sweep 72h URL & title deduplication in IntelligenceRunner.runSweep()
    let llmCallCount = 0;
    const countingRouter = new LlmRouter([
      {
        name: "gemini",
        model: "gemini-2.5-flash-lite",
        async completeJson() {
          llmCallCount++;
          return JSON.stringify({
            signals: [
              {
                kind: "LABOR_INDUSTRIAL",
                severity: "RED",
                title: "Tööseisak ja tarneraskused Pärnu sadamas",
                description: "Pärnu sadama töö on peatatud.",
                affectedCountryCodes: ["EE"],
                affectedChokepoints: ["BALTIC_SEA"],
                affectedSectors: ["Logistics"],
                lifecycle: "ACTIVE",
                sourceUrl: "https://err.ee/parnu-sadam-tooseisak",
                publishedAt: "2026-11-21T06:00:00Z",
                confidence: 0.9,
              },
            ],
          });
        },
      },
    ]);

    const authRepo = new InMemoryAuthRepository();
    const workspaceRepo = new InMemoryWorkspaceRepository();
    const riskSignalRepo = new InMemoryRiskSignalRepository([]);
    const runner = new IntelligenceRunner({
      authRepo,
      workspaceRepo,
      inviteRepo: new InMemoryInvitationRepository({ authRepo, workspaceRepo }),
      riskSignalRepo,
      alertRepo: new InMemoryAlertRepository(),
      llmRouter: countingRouter,
      fromEmail: "alerts@kulgo.eu",
      fetchStage1: async () => ({ signals: [], errors: [] }),
      fetchStage2Raw: async () => [
        {
          title: "Tööseisak ja tarneraskused Pärnu sadamas",
          summary: "Ulatuslik tööseisak Pärnu sadamas",
          sourceUrl: "https://err.ee/parnu-sadam-tooseisak",
          publishedAt: "2026-11-21T06:00:00Z",
        },
        {
          // Near-duplicate headline from a second URL on subsequent sweep
          title: "Tööseisak ja tarneraskused Pärnu sadamas!",
          summary: "Kordusuudis teisest portaalist",
          sourceUrl: "https://delfi.ee/parnu-sadam-tooseisak",
          publishedAt: "2026-11-21T12:00:00Z",
        },
      ],
    });

    // 06:00 UTC sweep classifies the new article once
    const sweep1 = await runner.runSweep({ nowIso: "2026-11-21T06:00:00Z" });
    expect(sweep1.stage2Classified).toBe(1);
    expect(sweep1.upsertedNew).toBe(1);
    expect(llmCallCount).toBe(1);

    // 12:00 UTC sweep sees the active signal's URL & title from 06:00 UTC and skips LLM invocation altogether
    const sweep2 = await runner.runSweep({ nowIso: "2026-11-21T12:00:00Z" });
    expect(sweep2.stage2Classified).toBe(0);
    expect(llmCallCount).toBe(1);
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
