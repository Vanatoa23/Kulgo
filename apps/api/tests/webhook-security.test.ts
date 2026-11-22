import { describe, expect, it } from "vitest";
import { createTestApp } from "../src/app.js";
import { InMemoryAlertRepository } from "../src/intelligence/alert-repository.js";
import { parsePortWatchGeoJson } from "../src/intelligence/feeds/stage1.js";
import {
  dispatchInstantRedAlerts,
  signWebhookPayload,
} from "../src/intelligence/notifications.js";
import {
  createPinnedLookup,
  deliverSafeWebhook,
  isPublicIp,
  isPublicIpv4,
  isPublicIpv6,
  validateWebhookDestination,
  WebhookSecurityError,
  type WebhookDnsLookup,
} from "../src/intelligence/webhook-security.js";

function makeConfirmedRedSignal() {
  return parsePortWatchGeoJson(
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
}

async function registerOwnerAndGetCookie(
  app: ReturnType<typeof createTestApp>,
  email = "owner@webhook-ssrf.eu",
): Promise<string> {
  const reg = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "WebhookSecurityPassword2026!",
      organizationName: "Webhook Security Test OÜ",
      countryCode: "EE",
      sector: "Electronics",
    }),
  });
  expect(reg.status).toBe(201);
  return /kulgo_session=([^;]+)/.exec(reg.headers.get("set-cookie") ?? "")![0];
}

describe("Webhook IP classification & URL destination validation", () => {
  it("classifies public vs non-public IPv4 addresses accurately", () => {
    expect(isPublicIpv4("93.184.216.34")).toBe(true);
    expect(isPublicIpv4("1.1.1.1")).toBe(true);
    expect(isPublicIpv4("8.8.8.8")).toBe(true);

    // Loopback, private, link-local, CGNAT, unspecified, multicast, docs, broadcast
    for (const blocked of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1",
      "100.127.255.254",
      "127.0.0.1",
      "127.255.255.254",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.254",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.0.1",
      "192.168.255.254",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPublicIpv4(blocked), `expected ${blocked} to be blocked`).toBe(
        false,
      );
    }
  });

  it("classifies public vs non-public IPv6 addresses including IPv4-mapped variants", () => {
    expect(isPublicIpv6("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(isPublicIpv6("2001:4860:4860::8888")).toBe(true);
    expect(isPublicIpv6("2a00:1450:4001:800::200e")).toBe(true);
    expect(isPublicIp("[2606:2800:220:1:248:1893:25c8:1946]")).toBe(true);

    for (const blocked of [
      "::",
      "::1",
      "::127.0.0.1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:192.168.1.1",
      "64:ff9b::127.0.0.1",
      "64:ff9b:1::10.0.0.1",
      "100::1",
      "2001::1",
      "2001:2::1",
      "2001:db8::1",
      "2002:7f00:0001::1",
      "3fff::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "fe80::1%eth0",
      "fec0::1",
      "ff02::1",
    ]) {
      expect(isPublicIpv6(blocked), `expected ${blocked} to be blocked`).toBe(
        false,
      );
    }
  });

  it("rejects non-HTTP(S) schemes, credentials, internal hostnames, and obfuscated/internal IPs", async () => {
    const publicLookup: WebhookDnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
    ];

    const blockedUrls = [
      "file:///etc/passwd",
      "ftp://hooks.example/kulgo",
      "gopher://127.0.0.1:6379/_INFO",
      "javascript:alert(1)",
      "https://user:pass@93.184.216.34/kulgo",
      "http://127.0.0.1:2480/private-target",
      "http://2130706433/private-target", // decimal 127.0.0.1
      "http://0177.0.0.1/private-target", // octal 127.0.0.1
      "http://127.1/private-target", // shorthand 127.0.0.1
      "http://0.0.0.0:2480/private-target",
      "http://10.0.0.5/internal",
      "http://172.16.0.10/internal",
      "http://192.168.1.1/internal",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]:2480/private-target",
      "http://[::]/private-target",
      "http://[::ffff:127.0.0.1]:2480/private-target",
      "http://[::ffff:7f00:1]:2480/private-target",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[fc00::1]/internal",
      "http://[fe80::1]/internal",
      "http://[2002:7f00:0001::1]/internal",
      "http://localhost:2480/api/v1/query",
      "http://localhost.:2480/api/v1/query",
      "http://api.localhost/hook",
      "http://arcadedb:2480/api/v1/query",
      "http://redis.internal/hook",
      "http://printer.local/hook",
      "http://metadata.google.internal/computeMetadata/v1/",
    ];

    for (const url of blockedUrls) {
      await expect(
        validateWebhookDestination(url, { dnsLookup: publicLookup }),
        `expected ${url} to be rejected`,
      ).rejects.toThrow(WebhookSecurityError);
    }
  });

  it("rejects hostnames that resolve to any non-public IP (including mixed public + private results)", async () => {
    const mixedIpv4Lookup: WebhookDnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await expect(
      validateWebhookDestination("https://dual.example/hook", {
        dnsLookup: mixedIpv4Lookup,
      }),
    ).rejects.toThrow(WebhookSecurityError);

    const mixedIpv6Lookup: WebhookDnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "::1", family: 6 },
    ];
    await expect(
      validateWebhookDestination("https://dual6.example/hook", {
        dnsLookup: mixedIpv6Lookup,
      }),
    ).rejects.toThrow(WebhookSecurityError);

    const emptyLookup: WebhookDnsLookup = async () => [];
    await expect(
      validateWebhookDestination("https://nx.example/hook", {
        dnsLookup: emptyLookup,
      }),
    ).rejects.toThrow(WebhookSecurityError);
  });

  it("permits legitimate public HTTP(S) IPv4, IPv6, and domain webhooks", async () => {
    const v4Target = await validateWebhookDestination(
      "http://93.184.216.34/kulgo",
    );
    expect(v4Target.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);

    const v6Target = await validateWebhookDestination(
      "https://[2606:2800:220:1:248:1893:25c8:1946]/kulgo",
    );
    expect(v6Target.addresses).toEqual([
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    const domainTarget = await validateWebhookDestination(
      "https://hooks.company.eu/kulgo",
      {
        dnsLookup: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        ],
      },
    );
    expect(domainTarget.addresses).toHaveLength(2);
  });

  it("pins DNS lookup callback to pre-validated addresses for both single and all-address modes", async () => {
    const pinned = createPinnedLookup([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    const single = await new Promise<{
      address: string;
      family: number | undefined;
    }>((resolve, reject) => {
      pinned("hooks.company.eu", {}, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address: String(address), family });
      });
    });
    expect(single).toEqual({ address: "93.184.216.34", family: 4 });

    const all = await new Promise<Array<{ address: string; family: number }>>(
      (resolve, reject) => {
        pinned("hooks.company.eu", { all: true }, (err, addresses) => {
          if (err) reject(err);
          else
            resolve(
              addresses as unknown as Array<{ address: string; family: number }>,
            );
        });
      },
    );
    expect(all).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });
});

describe("PATCH /api/v1/alerts/preferences SSRF validation", () => {
  it("rejects internal IPv4, IPv6, metadata, non-HTTP(S), and private-DNS URLs with HTTP 400", async () => {
    const app = createTestApp(
      {},
      {
        webhookDnsLookup: async (hostname) => {
          if (hostname === "rebind-private.example") {
            return [{ address: "10.0.0.42", family: 4 }];
          }
          if (hostname === "ipv6-loopback.example") {
            return [{ address: "::1", family: 6 }];
          }
          return [{ address: "93.184.216.34", family: 4 }];
        },
      },
    );
    const cookie = await registerOwnerAndGetCookie(app);

    for (const badUrl of [
      "http://127.0.0.1:2480/private-target",
      "http://[::1]:2480/private-target",
      "http://[::ffff:127.0.0.1]:2480/private-target",
      "http://169.254.169.254/latest/meta-data/",
      "http://arcadedb:2480/api/v1/query",
      "ftp://hooks.company.eu/kulgo",
      "https://rebind-private.example/kulgo",
      "https://ipv6-loopback.example/kulgo",
    ]) {
      const res = await app.request("/api/v1/alerts/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ webhookUrl: badUrl }),
      });
      expect(res.status, `expected 400 for ${badUrl}`).toBe(400);
    }

    // Verify rejected URLs were never persisted
    const getRes = await app.request("/api/v1/alerts/preferences", {
      headers: { Cookie: cookie },
    });
    expect(getRes.status).toBe(200);
    const pref = (await getRes.json()) as { webhookUrl: string | null };
    expect(pref.webhookUrl).toBeNull();

    // Legitimate public IPv6 webhook succeeds
    const okV6 = await app.request("/api/v1/alerts/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        webhookUrl: "https://[2606:2800:220:1:248:1893:25c8:1946]/kulgo",
      }),
    });
    expect(okV6.status).toBe(200);

    // Clearing webhook URL with null still succeeds
    const clearRes = await app.request("/api/v1/alerts/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ webhookUrl: null }),
    });
    expect(clearRes.status).toBe(200);
  });
});

describe("dispatchInstantRedAlerts webhook SSRF, redirect, DNS-change & timeout protection", () => {
  it("blocks direct internal URLs stored in preferences without invoking fetch", async () => {
    const alertRepo = new InMemoryAlertRepository();
    const orgId = "11111111-1111-4111-8111-111111111111";
    const signal = makeConfirmedRedSignal();

    await alertRepo.upsertNotificationPreference({
      orgId,
      instantRedEmailEnabled: false,
      webhookUrl: "http://127.0.0.1:2480/private-target",
    });

    let fetchCalls = 0;
    const captureFetch: typeof fetch = async () => {
      fetchCalls++;
      return new Response("ok", { status: 200 });
    };

    const summary = await dispatchInstantRedAlerts(
      [
        {
          orgId,
          signal,
          facilityMatches: [],
          laneMatches: [],
          partnerRegionAlerts: [],
        },
      ],
      {
        alertRepo,
        fromEmail: "alerts@kulgo.eu",
        fetchFn: captureFetch,
      },
    );

    expect(summary.webhooksSent).toBe(0);
    expect(fetchCalls).toBe(0);

    const deliveries = await alertRepo.listDeliveries(orgId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("FAILED");
    expect(deliveries[0]!.errorMessage).toContain("not a public IPv4");
  });

  it("blocks public-to-private HTTP redirects and never contacts the redirect target", async () => {
    const alertRepo = new InMemoryAlertRepository();
    const orgId = "22222222-2222-4222-8222-222222222222";
    const signal = makeConfirmedRedSignal();

    await alertRepo.upsertNotificationPreference({
      orgId,
      instantRedEmailEnabled: false,
      webhookUrl: "https://hooks.public.example/redirect-to-internal",
    });

    const seenCalls: Array<{ url: string; redirect?: string }> = [];
    const redirectFetch: typeof fetch = async (input, init) => {
      seenCalls.push({ url: String(input), redirect: init?.redirect });
      return new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1:2480/private-target" },
      });
    };

    const summary = await dispatchInstantRedAlerts(
      [
        {
          orgId,
          signal,
          facilityMatches: [],
          laneMatches: [],
          partnerRegionAlerts: [],
        },
      ],
      {
        alertRepo,
        fromEmail: "alerts@kulgo.eu",
        fetchFn: redirectFetch,
        webhookDnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    );

    expect(summary.webhooksSent).toBe(0);
    expect(seenCalls).toHaveLength(1);
    expect(seenCalls[0]!.redirect).toBe("manual");

    const deliveries = await alertRepo.listDeliveries(orgId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("FAILED");
    expect(deliveries[0]!.errorMessage).toContain("redirect blocked");
  });

  it("blocks DNS rebinding when a hostname changes from public at config time to private at dispatch time", async () => {
    let resolvedAddress = "93.184.216.34";
    const dynamicDnsLookup: WebhookDnsLookup = async () => [
      { address: resolvedAddress, family: 4 },
    ];

    // Step 1: Hostname resolves to a public IP when configured
    const validated = await validateWebhookDestination(
      "https://rebind.attacker.example/kulgo",
      { dnsLookup: dynamicDnsLookup },
    );
    expect(validated.addresses[0]!.address).toBe("93.184.216.34");

    const alertRepo = new InMemoryAlertRepository();
    const orgId = "33333333-3333-4333-8333-333333333333";
    await alertRepo.upsertNotificationPreference({
      orgId,
      instantRedEmailEnabled: false,
      webhookUrl: "https://rebind.attacker.example/kulgo",
    });

    // Step 2: DNS record changes to loopback before dispatch
    resolvedAddress = "127.0.0.1";

    let fetchCalls = 0;
    const captureFetch: typeof fetch = async () => {
      fetchCalls++;
      return new Response("ok", { status: 200 });
    };

    const summary = await dispatchInstantRedAlerts(
      [
        {
          orgId,
          signal: makeConfirmedRedSignal(),
          facilityMatches: [],
          laneMatches: [],
          partnerRegionAlerts: [],
        },
      ],
      {
        alertRepo,
        fromEmail: "alerts@kulgo.eu",
        fetchFn: captureFetch,
        webhookDnsLookup: dynamicDnsLookup,
      },
    );

    expect(summary.webhooksSent).toBe(0);
    expect(fetchCalls).toBe(0);

    const deliveries = await alertRepo.listDeliveries(orgId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("FAILED");
    expect(deliveries[0]!.errorMessage).toContain("non-public IP");
  });

  it("bounds request duration with AbortSignal timeout and cancels response bodies", async () => {
    const alertRepo = new InMemoryAlertRepository();
    const orgId = "44444444-4444-4444-8444-444444444444";
    await alertRepo.upsertNotificationPreference({
      orgId,
      instantRedEmailEnabled: false,
      webhookUrl: "https://slow.public.example/kulgo",
    });

    let aborted = false;
    const hangingFetch: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(init.signal?.reason ?? new Error("Aborted"));
        });
      });

    const summary = await dispatchInstantRedAlerts(
      [
        {
          orgId,
          signal: makeConfirmedRedSignal(),
          facilityMatches: [],
          laneMatches: [],
          partnerRegionAlerts: [],
        },
      ],
      {
        alertRepo,
        fromEmail: "alerts@kulgo.eu",
        fetchFn: hangingFetch,
        webhookDnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        webhookTimeoutMs: 40,
      },
    );

    expect(aborted).toBe(true);
    expect(summary.webhooksSent).toBe(0);
    const deliveries = await alertRepo.listDeliveries(orgId);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("FAILED");
    expect(deliveries[0]!.errorMessage).toContain("timed out");

    // Verify response body stream is cancelled immediately without buffering
    let cancelled = false;
    const stream = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    await deliverSafeWebhook({
      url: "https://hooks.public.example/kulgo",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchFn: async () => new Response(stream, { status: 200 }),
    });
    expect(cancelled).toBe(true);
  });

  it("delivers signed payloads to legitimate public IPv6 webhooks", async () => {
    const alertRepo = new InMemoryAlertRepository();
    const orgId = "55555555-5555-4555-8555-555555555555";
    const secret = "ipv6-public-webhook-secret-2026";
    await alertRepo.upsertNotificationPreference({
      orgId,
      instantRedEmailEnabled: false,
      webhookUrl: "https://[2606:2800:220:1:248:1893:25c8:1946]/kulgo",
      webhookSecret: secret,
    });

    const captured: Array<{
      url: string;
      sig: string | null;
      body: string;
      redirect?: string;
      hasSignal: boolean;
    }> = [];

    const summary = await dispatchInstantRedAlerts(
      [
        {
          orgId,
          signal: makeConfirmedRedSignal(),
          facilityMatches: [],
          laneMatches: [],
          partnerRegionAlerts: [],
        },
      ],
      {
        alertRepo,
        fromEmail: "alerts@kulgo.eu",
        fetchFn: async (input, init) => {
          const headers = init?.headers as Record<string, string>;
          captured.push({
            url: String(input),
            sig: headers["X-Kulgo-Signature-256"] ?? null,
            body: String(init?.body ?? ""),
            redirect: init?.redirect,
            hasSignal: init?.signal instanceof AbortSignal,
          });
          return new Response("ok", { status: 200 });
        },
      },
    );

    expect(summary.webhooksSent).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.redirect).toBe("manual");
    expect(captured[0]!.hasSignal).toBe(true);
    expect(captured[0]!.sig).toBe(signWebhookPayload(captured[0]!.body, secret));
  });
});
