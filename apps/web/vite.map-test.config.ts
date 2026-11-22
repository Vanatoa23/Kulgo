import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import config from "./vite.config";

// Build the real application and a test-only SupplyMap entry with the same pipeline.
export default mergeConfig(config, defineConfig({
  build: {
    outDir: "dist-map-test",
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        map: fileURLToPath(new URL("./tests/e2e/fixtures/map.html", import.meta.url)),
      },
    },
  },
}));
