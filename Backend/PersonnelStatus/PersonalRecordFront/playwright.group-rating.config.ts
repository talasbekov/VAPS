import { defineConfig } from "@playwright/test";
import runtimeConfig from "./playwright.runtime.config";

export default defineConfig({
  ...runtimeConfig,
  testMatch: "group-rating-live.spec.ts",
  outputDir: "test-results/group-rating-live",
});
