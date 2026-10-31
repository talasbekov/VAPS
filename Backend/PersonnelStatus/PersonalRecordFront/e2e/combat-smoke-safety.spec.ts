import { expect, test } from '@playwright/test';
import { nativeCombatSmokeDatabase } from './native-combat-smoke';

for (const [name, override] of [
  ['live database', { PR_DB_NAME: 'sj_redesign' }],
  ['another PostgreSQL port', { PR_DB_PORT: '5434' }],
  ['missing backend executable', { SMOKE_PURGE_PYTHON: '' }],
  ['mixed Docker target', { SMOKE_DOCKER_CONTAINER: 'some-backend' }],
] as const) {
  test(`smoke safety rejects ${name} before running fixture commands`, () => {
    const values = Object.assign({ PR_DB_HOST: '127.0.0.1', PR_DB_PORT: '15434', PR_DB_NAME: 'sj_combat_smoke',
      DJANGO_SETTINGS_MODULE: 'combat_smoke_settings', SMOKE_PURGE_PYTHON: 'not-executed', SMOKE_DOCKER_CONTAINER: '' }, override);
    const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, values);
      expect(() => nativeCombatSmokeDatabase('http://127.0.0.1:8312', 'http://127.0.0.1:3318')).toThrow('complete isolated');
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
}

test('smoke safety does not admit a mixed API/UI pair or remote host', () => {
  expect(nativeCombatSmokeDatabase('http://127.0.0.1:8312', 'http://localhost:3316')).toBeNull();
  expect(nativeCombatSmokeDatabase('https://remote.invalid:8312', 'http://127.0.0.1:3318')).toBeNull();
});
