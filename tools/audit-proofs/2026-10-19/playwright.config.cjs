const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const { defineConfig } = require(path.join(root, 'PersonnelStatus/PersonalRecordFront/node_modules/@playwright/test'));
for (const key of ['SMOKE_APP', 'SMOKE_API']) {
  if (!process.env[key] || !['127.0.0.1', 'localhost'].includes(new URL(process.env[key]).hostname)) {
    throw new Error(key + ' must identify a local audit stand');
  }
}
const results = process.env.AUDIT_PROOF_RESULTS_DIR || path.join(root, '.local-review/project-audit-20261015/refresh-20261019/preserved-om-browser');
module.exports = defineConfig({
  testDir: __dirname, testMatch: 'om-findings.spec.ts', workers: 1, retries: 0,
  timeout: 45000, expect: { timeout: 5000 },
  outputDir: path.join(results, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(results, 'results.json') }]],
  use: { baseURL: process.env.SMOKE_APP, viewport: { width: 1440, height: 1000 },
    headless: true, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined } },
});
