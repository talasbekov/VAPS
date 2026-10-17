const path = require('node:path');
const repo = path.resolve(__dirname, '../../..');
const { defineConfig } = require(path.join(repo, 'PersonnelStatus/PersonalRecordFront/node_modules/@playwright/test'));
for (const name of ['SMOKE_APP', 'SMOKE_API', 'SMOKE_USERNAME', 'SMOKE_PASSWORD']) {
  if (!process.env[name]) throw new Error(`${name} must identify the isolated local test stand`);
}
for (const name of ['SMOKE_APP', 'SMOKE_API']) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(process.env[name]).hostname)) {
    throw new Error(`${name} must use a loopback address`);
  }
}
const results = path.resolve(process.env.AUDIT_PROOF_RESULTS_DIR || path.join(repo, '.local-review/audit-proofs-20261015'));
module.exports = defineConfig({
  testDir: __dirname, testMatch: '*.spec.ts', workers: 1, retries: 0,
  timeout: 90000, expect: { timeout: 15000 },
  outputDir: path.join(results, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(results, 'results.json') }]],
  use: {
    baseURL: process.env.SMOKE_APP, viewport: { width: 1440, height: 1000 },
    headless: true, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
});
