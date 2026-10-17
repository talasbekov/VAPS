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
test('«Свод по Службе» требует права рабочего места и чтения статусов', () => {
  const openFor = moduleOpenFor as ModuleOpenFor

  expect(
    openFor(
      '/security-ops/service-summary',
      (code) => code === 'status.view' || code === 'service_summary.view',
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
    openFor('/security-ops/service-summary', () => false, (code) => code === 'DUTY_OFFICER'),
  ).toBe(false)
  // useOpsPermissions.hasPermission expands '*' for every permission query.
  // A callback matching only the literal '*' would incorrectly deny status.view.
  expect(
    openFor('/security-ops/service-summary', () => true, () => false),
  ).toBe(true)
})
