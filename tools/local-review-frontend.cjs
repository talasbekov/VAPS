const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function validateReviewRuntime(settings, manifest) {
  assert(settings.PR_DB_NAME === 'smart_soak_20261007' &&
    settings.BACKEND_URL === 'http://127.0.0.1:18345', 'Unexpected local review runtime');
  const rules = Array.isArray(manifest.rewrites) ? manifest.rewrites : Object.values(manifest.rewrites ?? {}).flat();
  const api = rules.filter(rule => rule.source.startsWith('/api/'));
  assert(api.length > 10, 'Incomplete local review API routes');
  for (const rule of api) assert.equal(new URL(rule.destination).origin, settings.BACKEND_URL, 'Build API origin does not match the review runtime');
  const photos = rules.find(rule => rule.source.startsWith('/media/employees/photos/'));
  assert(photos && new URL(photos.destination).origin === 'http://127.0.0.1:18348', 'Unexpected review photo origin');
}

function startReviewFrontend() {
  const repo = path.resolve(__dirname, '..');
  const stand = path.join(repo, '.local-review');
  const front = path.join(repo, 'PersonnelStatus/PersonalRecordFront');
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const settings = readJson(path.join(stand, 'browser-env.json'));
  validateReviewRuntime(settings, readJson(path.join(front, '.next-build/routes-manifest.json')));
  if (process.argv.includes('--check')) {
    console.log('Local frontend runtime and compiled API/photo origins verified. No server started.');
    return;
  }
  for (const [name, value] of Object.entries(settings)) {
    if (/^(NEXT_|NEXTAUTH_|BACKEND_)/.test(name)) process.env[name] = String(value);
  }
  process.env.NEXT_DIST_DIR = '.next-build';
  process.env.PORT = '3346';
  process.chdir(front);
  const nextCli = path.join(front, 'node_modules/next/dist/bin/next');
  process.argv = [process.execPath, nextCli, 'start', '--hostname', '127.0.0.1', '--port', '3346'];
  fs.writeFileSync(path.join(stand, 'frontend.pid'), String(process.pid));
  require(nextCli);
}

module.exports = { validateReviewRuntime, startReviewFrontend };
if (require.main === module) startReviewFrontend();
