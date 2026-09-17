import { test, expect } from '@playwright/test'
import { parseOpsErrorResponse, OpsValidationError } from '../lib/ops-errors'

test('DRF dictionary field errors survive parsing', async () => {
  const error = await parseOpsErrorResponse(new Response(JSON.stringify({name: ['Обязательное поле.'], code: ['Обязательное поле.']}), {status: 400}))
  expect(error).toBeInstanceOf(OpsValidationError)
  expect(error.details).toEqual({name: ['Обязательное поле.'], code: ['Обязательное поле.']})
  expect(error.message).not.toContain('HTTP')
})

import { matchesProtectedPerson } from '../entities/protected-person/model/types'

test('renaming a person preserves links carrying the stable person id', () => {
  const person = { id: '42', name: 'Новое имя' }
  expect(matchesProtectedPerson(person, {personId: '42', name: 'Старое имя'})).toBe(true)
  expect(matchesProtectedPerson(person, {personId: '43', name: 'Новое имя'})).toBe(false)
  expect(matchesProtectedPerson(person, {name: ' Новое имя '})).toBe(true)
})

test('native DRF detail and server errors keep their meaning', async () => {
  const detail = await parseOpsErrorResponse(new Response(JSON.stringify({detail: 'Значение используется.'}), {status: 400}))
  expect(detail.message).toBe('Значение используется.')
  expect(detail.details).toEqual({})
  const server = await parseOpsErrorResponse(new Response(JSON.stringify({name: ['Ошибка']}), {status: 500}))
  expect(server.kind).toBe('server')
  expect(server.details).toEqual({})
})
