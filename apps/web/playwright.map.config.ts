import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "map-worker.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {
      launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    } : {}),
    trace: "retain-on-failure",
  },
  projects: [
    { name: "map-dev", use: { baseURL: "http://127.0.0.1:5174" } },
    { name: "map-production", use: { baseURL: "http://127.0.0.1:5175" } },
  ],
  webServer: [
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
    },
    {
      command: "pnpm exec vite build --config vite.map-test.config.ts && pnpm exec vite preview --outDir dist-map-test --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      timeout: 120_000,
    },
  ],
});
