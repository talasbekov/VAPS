import { expect, test } from '@playwright/test'
import { moduleOpenFor } from '../entities/portal-access'

type ModuleOpenFor = (
  href: string,
  hasPermission: (code: string) => boolean,
  hasRole?: (code: string) => boolean,
) => boolean

// Plane №1223 (решение заказчика 12.09.2026): экран — оперативному дежурному;
// ответственному за сбор сил — свой «Свод департамента». До этого гейт держала
// роль FORCES_GATHERING_OFFICER (№1115).
test('«Свод по Службе» требует роль оперативного дежурного', () => {
  const openFor = moduleOpenFor as ModuleOpenFor

  expect(
    openFor(
      '/security-ops/service-summary',
      (code) => code === 'status.view',
      (code) => code === 'DUTY_OFFICER',
    ),
  ).toBe(true)
  expect(
    openFor(
      '/security-ops/service-summary',
      (code) => code === 'status.view',
      (code) => code !== 'DUTY_OFFICER',
    ),
  ).toBe(false)
  expect(
    openFor('/security-ops/service-summary', (code) => code === '*', () => false),
  ).toBe(true)
})
