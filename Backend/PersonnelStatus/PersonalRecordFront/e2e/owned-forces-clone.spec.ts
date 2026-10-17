import { expect, test } from '@playwright/test'
import { requireIsolatedForcesClone } from './owned-forces-fixture'

const keys = ['SMOKE_API', 'SMOKE_APP', 'PR_DB_NAME', 'SMOKE_DOCKER_CONTAINER'] as const
type Binding = Partial<Record<(typeof keys)[number], string>>
const legacy: Binding = {
  SMOKE_API: 'http://127.0.0.1:18349', SMOKE_APP: 'http://127.0.0.1:3350',
  PR_DB_NAME: 'smart_refine_20261008', SMOKE_DOCKER_CONTAINER: 'smart-refine-20261008-backend-1',
}
const current: Binding = {
  SMOKE_API: 'http://127.0.0.1:18351', SMOKE_APP: 'http://localhost:3354',
  PR_DB_NAME: 'smart_eight_hours_20261009', SMOKE_DOCKER_CONTAINER: 'smart-eight-hours-20261009-backend-1',
}

// The synchronous guard runs before authentication or fixture requests.
// Restore every changed field even when the guard rejects the binding.
function atBinding(binding: Binding, check: () => void) {
  const changed = ['SMOKE_ISOLATED_CLONE', ...keys]
  const before = Object.fromEntries(changed.map(key => [key, process.env[key]]))
  try {
    for (const key of changed) delete process.env[key]
    process.env.SMOKE_ISOLATED_CLONE = '1'
    Object.assign(process.env, binding)
    check()
  } finally {
    for (const key of changed) {
      if (before[key] === undefined) delete process.env[key]
      else process.env[key] = before[key]
    }
  }
}

for (const [label, binding, other] of [['legacy', legacy, current], ['current', current, legacy]] as const) {
  test(`owned forces guard accepts the complete ${label} clone binding`, () => {
    atBinding(binding, () => expect(() => requireIsolatedForcesClone()).not.toThrow())
  })
  for (const key of keys) {
    test(`owned forces guard rejects ${label} with missing or empty ${key}`, () => {
      const missing = { ...binding }
      delete missing[key]
      atBinding(missing, () => expect(() => requireIsolatedForcesClone()).toThrow())
      atBinding({ ...binding, [key]: '' }, () => expect(() => requireIsolatedForcesClone()).toThrow())
    })
    test(`owned forces guard rejects crossed ${label} ${key}`, () => {
      atBinding({ ...binding, [key]: other[key] }, () => expect(() => requireIsolatedForcesClone()).toThrow())
    })
  }
}

test('owned forces guard rejects the primary portal even with the isolation flag', () => {
  atBinding({ SMOKE_API: 'http://127.0.0.1:18345', SMOKE_APP: 'http://localhost:3346',
    PR_DB_NAME: 'smart_soak_20261007', SMOKE_DOCKER_CONTAINER: 'smart-soak-20261007-backend-1' },
  () => expect(() => requireIsolatedForcesClone()).toThrow())
})

for (const key of ['SMOKE_API', 'SMOKE_APP'] as const) {
  for (const alteration of ['foreign-host', 'credentials', 'path', 'query', 'fragment']) {
    test(`owned forces guard rejects ${key} with ${alteration}`, () => {
      const url = new URL(current[key]!)
      if (alteration === 'foreign-host') url.hostname = 'example.invalid'
      if (alteration === 'credentials') url.username = 'actor'
      if (alteration === 'path') url.pathname = '/api'
      if (alteration === 'query') url.search = '?target=primary'
      if (alteration === 'fragment') url.hash = '#primary'
      atBinding({ ...current, [key]: url.toString() }, () => expect(() => requireIsolatedForcesClone()).toThrow())
    })
  }
}
