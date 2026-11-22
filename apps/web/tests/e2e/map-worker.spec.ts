import { expect, test } from "@playwright/test";

test("SupplyMap starts a JavaScript worker and renders worker-processed GeoJSON", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (/maplibre.*worker/i.test(request.url())) {
      errors.push(`${request.url()}: ${request.failure()?.errorText}`);
    }
  });

  await page.route("https://basemaps.cartocdn.com/**", (route) => route.fulfill({
    json: {
      version: 8,
      sources: {
        fixture: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [{
              type: "Feature", properties: { name: "Worker-rendered Tallinn" },
              geometry: { type: "Point", coordinates: [24.7536, 59.437] },
            }],
          },
        },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#000000" } },
        { id: "fixture", type: "circle", source: "fixture", paint: { "circle-radius": 20, "circle-color": "#ff0080" } },
      ],
    },
  }));

  const workerResponse = page.waitForResponse((response) =>
    /maplibre.*worker/i.test(response.url()) && !new URL(response.url()).searchParams.has("worker"),
  );
  const workerStarted = page.waitForEvent("worker");
  await page.goto("/tests/e2e/fixtures/map.html");
  const response = await workerResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/javascript/);
  expect(await response.text()).not.toMatch(/^\s*<!doctype html/i);
  await workerStarted;

  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  // Query the real rendered source, not just a canvas or a worker being constructed.
  await expect.poll(() => page.evaluate(() => {
    const map = window.testMap;
    if (!map?.isStyleLoaded() || !map.isSourceLoaded("fixture")) return [];
    return map.queryRenderedFeatures({ layers: ["fixture"] })
      .map((feature) => feature.properties.name);
  })).toContain("Worker-rendered Tallinn");
  expect(errors).toEqual([]);
});
