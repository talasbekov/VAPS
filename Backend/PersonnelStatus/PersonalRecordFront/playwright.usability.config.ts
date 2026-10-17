import { defineConfig } from "@playwright/test";
import runtimeConfig from "./playwright.runtime.config";

// Use an externally managed isolated stand and its SMOKE_* credentials.
export default defineConfig({
  ...runtimeConfig,
  testDir: ".",
  testMatch: [
    "e2e/dashboard-readable-tree.spec.ts",
    "e2e/dashboard-origin-recovery.spec.ts",
    "e2e/org-scene3d.spec.ts",
    "tests/statuses-focus.spec.ts",
  ],
  timeout: 90_000,
  outputDir: "test-results/usability",
  use: {
    ...runtimeConfig.use,
    baseURL: process.env.SMOKE_APP ?? process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3350",
  },
});
