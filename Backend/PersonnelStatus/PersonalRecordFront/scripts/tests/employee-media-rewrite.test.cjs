const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const configSource = fs.readFileSync(path.join(__dirname, '../../next.config.js'), 'utf8');
const photoRoute = '/media/employees/photos/:path*';
async function rewrites(env) {
  const context = { module: { exports: {} }, process: { env }, console: { log() {} } };
  vm.runInNewContext(configSource, context, { filename: 'next.config.js' });
  return JSON.parse(JSON.stringify(await context.module.exports.rewrites()));
}

test('employee photos default to the existing backend media origin', async () => {
  const rules = await rewrites({ BACKEND_URL: 'http://backend.test:8100' });
  assert.equal(rules.find(rule => rule.source === photoRoute)?.destination,
    'http://backend.test:8100/media/employees/photos/:path*');
});

test('dedicated employee media route precedes generic media without moving other media or APIs', async () => {
  const baseline = await rewrites({ BACKEND_URL: 'http://backend.test:8100' });
  const dedicated = await rewrites({ BACKEND_URL: 'http://backend.test:8100', BACKEND_EMPLOYEE_MEDIA_URL: 'http://photos.test:18348' });
  const photoIndex = dedicated.findIndex(rule => rule.source === photoRoute);
  assert.ok(photoIndex >= 0, 'Employee-specific rewrite is required');
  assert.ok(photoIndex < dedicated.findIndex(rule => rule.source === '/media/:path*'), 'Specific employee route must match first');
  assert.equal(dedicated[photoIndex].destination, 'http://photos.test:18348/media/employees/photos/:path*');
  assert.deepEqual(dedicated.filter(rule => rule.source !== photoRoute), baseline.filter(rule => rule.source !== photoRoute));
  for (const rule of dedicated.filter(rule => rule.source !== photoRoute)) {
    assert.ok(rule.destination.startsWith('http://backend.test:8100/'), `${rule.source} must keep its backend`);
  }
});

test('trailing slash and whitespace in dedicated media setting do not create broken file URLs', async () => {
  const rules = await rewrites({ BACKEND_URL: 'http://backend.test:8100', BACKEND_EMPLOYEE_MEDIA_URL: ' http://photos.test:18348/// ' });
  assert.equal(rules.find(rule => rule.source === photoRoute)?.destination,
    'http://photos.test:18348/media/employees/photos/:path*');
});

test('empty media setting preserves backend and public API/default fallbacks', async () => {
  for (const [env, origin] of [
    [{ BACKEND_URL: 'http://backend.test:8100', BACKEND_EMPLOYEE_MEDIA_URL: '  ' }, 'http://backend.test:8100'],
    [{ NEXT_PUBLIC_API_URL: 'http://public-api.test:8100' }, 'http://public-api.test:8100'],
    [{}, 'http://localhost:8100'],
  ]) {
    const rules = await rewrites(env);
    assert.equal(rules.find(rule => rule.source === photoRoute)?.destination, `${origin}/media/employees/photos/:path*`);
    assert.equal(rules.find(rule => rule.source === '/media/:path*')?.destination, `${origin}/media/:path*`);
  }
});
