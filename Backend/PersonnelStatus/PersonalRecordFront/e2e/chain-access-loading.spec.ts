/**
 * Plane №1008. `useChainAccess` — единая клиентская граница для действий
 * цепочки «Сбор сил на ОМ». Пока список прав ещё неизвестен, открыть кнопку
 * значило дать человеку ложное обещание, которое заканчивается 403. Этот
 * сторож читает сам контракт helper-а: живой браузер всегда дождётся прав и
 * не увидит короткое состояние загрузки.
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAIN_ACCESS = join(
  __dirname,
  '..',
  'features',
  'forces-split',
  'ui',
  'chain-access.ts',
)

test('загрузка прав закрывает действие цепочки с понятной причиной (Plane №1008)', () => {
  const source = readFileSync(CHAIN_ACCESS, 'utf8')
  const hook = source.slice(source.indexOf('export function useChainAccess'))

  expect(hook).toContain('can: (code) => !isLoading && hasPermission(code)')
  expect(hook).toMatch(/isLoading\s*\?\s*"Права загружаются…"/)
  expect(hook).not.toContain('isLoading || hasPermission(code)')
})
