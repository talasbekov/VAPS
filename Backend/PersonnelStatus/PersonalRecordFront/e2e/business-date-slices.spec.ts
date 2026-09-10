import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { businessDateForWorker } from './business-date'
import { fixtureRangeSize, resolveFixtureDateCommandTarget } from './global-setup'

test('17 workers receive distinct dates without a hidden modulo limit', () => {
  const rangeDays = fixtureRangeSize(17)
  const dates = new Set(
    Array.from({ length: 17 }, (_, parallelIndex) =>
      businessDateForWorker('2027-02-01', rangeDays, parallelIndex, 17, 0),
    ),
  )

  expect(dates.size).toBe(17)
})

test('worker cannot read beyond its allocated slice', () => {
  expect(() => businessDateForWorker('2027-02-01', 256, 0, 1, 256)).toThrow(
    /исчерпал свой диапазон/,
  )
})

test('one worker reserves only its own 256 dates', () => {
  expect(fixtureRangeSize(1)).toBe(256)
})

test('global setup rejects a worker count beyond the reservation boundary', () => {
  expect(() => fixtureRangeSize(65)).toThrow(/от 1 до 64/)
})

test('fixture date command always uses manage.py from this worktree', async () => {
  const backendRoot = path.resolve(__dirname, '../../Personnel-Records')
  const command = path.join(
    backendRoot,
    'organization_management/apps/operations/management/commands/reserve_e2e_fixture_dates.py',
  )

  expect(existsSync(path.join(backendRoot, 'manage.py'))).toBe(true)
  expect(existsSync(command)).toBe(true)
  await expect(resolveFixtureDateCommandTarget()).resolves.toMatchObject({ backendRoot })
})
