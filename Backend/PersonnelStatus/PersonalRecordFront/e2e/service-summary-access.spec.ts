import { expect, test } from '@playwright/test'
import { moduleOpenFor } from '../entities/portal-access'

type ModuleOpenFor = (
  href: string,
  hasPermission: (code: string) => boolean,
  hasRole?: (code: string) => boolean,
) => boolean

test('«Свод по Службе» требует роль ответственного за сбор сил', () => {
  const openFor = moduleOpenFor as ModuleOpenFor

  expect(
    openFor(
      '/security-ops/service-summary',
      (code) => code === 'status.view',
      (code) => code === 'FORCES_GATHERING_OFFICER',
    ),
  ).toBe(true)
  expect(
    openFor(
      '/security-ops/service-summary',
      (code) => code === 'status.view',
      (code) => code !== 'FORCES_GATHERING_OFFICER',
    ),
  ).toBe(false)
  expect(
    openFor('/security-ops/service-summary', (code) => code === '*', () => false),
  ).toBe(true)
})
