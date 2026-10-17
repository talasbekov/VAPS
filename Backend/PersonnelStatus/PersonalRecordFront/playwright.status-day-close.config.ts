import { defineConfig } from "@playwright/test";
import runtimeConfig from "./playwright.runtime.config";

export default defineConfig({
  ...runtimeConfig,
  testMatch: "status-day-close-permissions.spec.ts",
  outputDir: "test-results/status-day-close-permissions",
});
