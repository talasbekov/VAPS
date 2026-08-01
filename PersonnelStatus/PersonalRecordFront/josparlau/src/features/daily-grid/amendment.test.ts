// Story 10.6 — контракт amendment-флоу на фронте. Окружение node (дефолт
// vite.config): функции чистые, DOM не нужен.
//
// Почему рантайм-проверки так плотны: типы здесь РУКОПИСНЫЕ (схема этого пути
// пуста — см. шапку `amendment.ts`), поэтому `tsc` контракт-тестом НЕ работает.
// Фикстуры кириллические намеренно: латиница даёт зелень на коде, который
// ломается на реальных строках.
import { describe, expect, it } from 'vitest'

import {
  ApiError,
  ConflictError,
  NetworkError,
  ServerError,
  ValidationError,
} from '../../shared/api/errors'
import type { ApiErrorInit } from '../../shared/api/errors'
import {
  AMEND_CONFLICT_MESSAGE,
  AMEND_NOT_FOUND_MESSAGE,
  AMEND_PERMISSION_MESSAGE,
  describeAmendFailure,
  isAmendmentComplete,
  SANCTION_MAX,
} from './amendment'

function init(over: Partial<ApiErrorInit> = {}): ApiErrorInit {
  return {
    status: 409,
    errorCode: 'DAY_ALREADY_SUBMITTED',
    message: 'Подразделение уже сдало этот день.',
    details: {},
    requestId: 'req-10-6',
    ...over,
  }
}

describe('isAmendmentComplete — оба поля обязательны, меряем ПОСЛЕ trim()', () => {
  it('оба поля заполнены → true', () => {
    expect(isAmendmentComplete('Ошибка в ростере', 'Выговор')).toBe(true)
  })

  it('пустая причина → false', () => {
    expect(isAmendmentComplete('', 'Выговор')).toBe(false)
  })

  it('причина из одних пробелов → false (бэк trim_whitespace=True)', () => {
    expect(isAmendmentComplete('   \t\n  ', 'Выговор')).toBe(false)
  })

  it('пустая санкция → false', () => {
    expect(isAmendmentComplete('Ошибка в ростере', '')).toBe(false)
  })

  it('санкция из одних пробелов → false', () => {
    expect(isAmendmentComplete('Ошибка в ростере', '  \n ')).toBe(false)
  })

  it(`санкция ровно ${SANCTION_MAX} символов → true (граница CharField)`, () => {
    expect(isAmendmentComplete('Причина', 'я'.repeat(SANCTION_MAX))).toBe(true)
  })

  it(`санкция ${SANCTION_MAX + 1} символов → false`, () => {
    expect(isAmendmentComplete('Причина', 'я'.repeat(SANCTION_MAX + 1))).toBe(false)
  })

  it('санкция 255 значимых + хвостовые пробелы → true: DRF trim_whitespace отрабатывает ДО MaxLengthValidator, наивная проверка сырой длины отбила бы законное значение', () => {
    const padded = `${'я'.repeat(SANCTION_MAX)}          `
    expect(padded.length).toBeGreaterThan(SANCTION_MAX)
    expect(isAmendmentComplete('Причина', padded)).toBe(true)
  })
})

describe('describeAmendFailure — порядок ветвления как в describeSubmitFailure', () => {
  it('network (у NetworkError нет .status) → silent: тост уже показал useApiMutation', () => {
    const failure = describeAmendFailure(new NetworkError('Failed to fetch'))
    expect(failure.kind).toBe('silent')
    expect(failure.message).toBe('')
  })

  it('5xx → silent (общий тост)', () => {
    const failure = describeAmendFailure(
      new ServerError(init({ status: 500, errorCode: 'INTERNAL_ERROR' })),
    )
    expect(failure.kind).toBe('silent')
  })

  it('401 → silent (цепь logout)', () => {
    const failure = describeAmendFailure(new ApiError(init({ status: 401, errorCode: null })))
    expect(failure.kind).toBe('silent')
  })

  it('403 → ФИКС-текст про daily_report.correct, НЕ error.message: бэк кладёт в message сам код', () => {
    const failure = describeAmendFailure(
      new ApiError(
        init({
          status: 403,
          errorCode: 'PERMISSION_DENIED',
          // Как на проводе: DomainError.message = message or code.
          message: 'PERMISSION_DENIED',
        }),
      ),
    )
    expect(failure.kind).toBe('permission')
    expect(failure.message).toBe(AMEND_PERMISSION_MESSAGE)
    expect(failure.message).toContain('daily_report.correct')
    expect(failure.message).not.toContain('PERMISSION_DENIED')
  })

  it('404 ENTITY_NOT_FOUND → «Сдача не найдена.»', () => {
    const failure = describeAmendFailure(
      new ApiError(
        init({
          status: 404,
          errorCode: 'ENTITY_NOT_FOUND',
          message: 'Сдача не найдена.',
          details: { submission_id: '12' },
        }),
      ),
    )
    expect(failure.kind).toBe('not-found')
    expect(failure.message).toBe(AMEND_NOT_FOUND_MESSAGE)
  })

  it('400 VALIDATION_ERROR → текст ИЗ конверта (детали по полям добавит parseValidationDetails)', () => {
    const failure = describeAmendFailure(
      new ValidationError(
        init({
          status: 400,
          errorCode: 'VALIDATION_ERROR',
          message: 'Проверьте заполнение формы.',
          details: { sanction: ['Убедитесь, что это значение содержит не более 255 символов.'] },
        }),
      ),
    )
    expect(failure.kind).toBe('validation')
    expect(failure.message).toBe('Проверьте заполнение формы.')
  })

  it('409 DAY_ALREADY_SUBMITTED → гонка версий', () => {
    const failure = describeAmendFailure(new ConflictError(init()))
    expect(failure.kind).toBe('conflict')
    expect(failure.message).toBe(AMEND_CONFLICT_MESSAGE)
  })

  it('409 DAY_ALREADY_SUBMITTED НЕ overridable ⇒ ConflictDialog по нему не откроется', () => {
    // Пин на реестр: если код когда-нибудь попадёт в OVERRIDABLE_CODES,
    // useApiMutation перехватит отказ в conflict-канал, и ветка `conflict`
    // в панели станет недостижимой молча.
    expect(new ConflictError(init()).overridable).toBe(false)
  })

  it('409 с ЧУЖИМ кодом → other (catch-all), а не conflict', () => {
    const failure = describeAmendFailure(
      new ConflictError(init({ errorCode: 'SOME_OTHER_CONFLICT', message: 'Иной конфликт.' })),
    )
    expect(failure.kind).toBe('other')
    expect(failure.message).toBe('Иной конфликт.')
  })

  it('429 без конверта (errorCode === null) → other с текстом конверта, а не тишина', () => {
    // 405/406/415/429 приходят БЕЗ конверта §36 — ветвление обязано это
    // переживать, а не считать errorCode гарантированным.
    const failure = describeAmendFailure(
      new ApiError(init({ status: 429, errorCode: null, message: 'Too Many Requests' })),
    )
    expect(failure.kind).toBe('other')
    expect(failure.message).toBe('Too Many Requests')
  })

  it('422 NO_SUBMISSION_TO_AMEND по HTTP НЕДОСТИЖИМ, но catch-all его не роняет', () => {
    // Тест НЕ утверждает, что такой ответ бывает (существующий pk гарантирует
    // цепочку — ЛОВУШКА №3 5.8b). Он утверждает лишь тотальность функции.
    const failure = describeAmendFailure(
      new ApiError(init({ status: 422, errorCode: 'NO_SUBMISSION_TO_AMEND', message: 'Нечего исправлять.' })),
    )
    expect(failure.kind).toBe('other')
  })
})
