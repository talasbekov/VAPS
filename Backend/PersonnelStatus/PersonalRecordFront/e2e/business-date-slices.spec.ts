import { expect, test } from '@playwright/test'
import { businessDateForWorker } from './business-date'
import { fixtureRangeSize } from './global-setup'

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
