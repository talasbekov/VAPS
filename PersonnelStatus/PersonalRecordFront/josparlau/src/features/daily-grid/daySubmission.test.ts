// Story 10.3 — контракт daily-submissions на фронте. Окружение node (дефолт
// vite.config): функции чистые, DOM не нужен.
//
// Почему рантайм-гард тестируется так плотно: типы здесь РУКОПИСНЫЕ (Решение
// №3 — схема для этих путей типов не несёт), поэтому `tsc` контракт-тестом НЕ
// работает. Всё, что защищает экран от кривого тела, — только эти функции.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  BusinessRuleError,
  ConflictError,
  NetworkError,
  ServerError,
  ValidationError,
} from '../../shared/api/errors'
import type { ApiErrorInit } from '../../shared/api/errors'
import {
  currentSubmission,
  describeSubmitFailure,
  EVENT_LABELS,
  isWithinSubmitWindow,
  parseSubmissionList,
  PERMISSION_MESSAGE,
  previousSubmission,
  submitWindow,
  todayLocalIso,
} from './daySubmission'
import type { DaySubmission } from './daySubmission'

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'

/** Валидная строка проекции (9 полей DailySubmissionSerializer.Meta.fields). */
function row(over: Partial<DaySubmission> = {}): Record<string, unknown> {
  return {
    id: 12,
    division_id: DIVISION_ID,
    business_date: '2026-07-19',
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: 'operator-1',
    submitted_at: '2026-07-19T08:15:00+05:00',
    late: false,
    ...over,
  }
}

function envelope(count: number, results: unknown[]): unknown {
  return { count, next: null, previous: null, results }
}

function init(over: Partial<ApiErrorInit> = {}): ApiErrorInit {
  return {
    status: 409,
    errorCode: 'DAY_ALREADY_SUBMITTED',
    message: 'Подразделение уже сдало этот день (пересдача — amendment 5.4).',
    details: {},
    requestId: 'req-10-3',
    ...over,
  }
}

describe('parseSubmissionList — защитное чтение конверта', () => {
  it('годный LimitOffset-конверт → строки', () => {
    const parsed = parseSubmissionList(envelope(1, [row()]))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual({
      id: 12,
      division_id: DIVISION_ID,
      business_date: '2026-07-19',
      version: 1,
      is_current: true,
      event: 'CHANGED',
      submitted_by: 'operator-1',
      submitted_at: '2026-07-19T08:15:00+05:00',
      late: false,
    })
  })

  it.each([
    ['null', null],
    ['строка', 'x'],
    ['число', 7],
    ['объект без results', {}],
    ['results не массив', { results: 'x' }],
    ['results = null', { results: null }],
  ])('мусор (%s) → [] без исключения', (_label, payload) => {
    expect(() => parseSubmissionList(payload)).not.toThrow()
    expect(parseSubmissionList(payload)).toEqual([])
  })

  it('элементы-не-объекты отбраковываются построчно, годные остаются', () => {
    const parsed = parseSubmissionList(envelope(3, [1, null, row({ id: 5 })]))
    expect(parsed.map((s) => s.id)).toEqual([5])
  })

  it.each([
    ['id', 'id'],
    ['division_id', 'division_id'],
    ['business_date', 'business_date'],
    ['version', 'version'],
    ['is_current', 'is_current'],
    ['event', 'event'],
    ['submitted_by', 'submitted_by'],
    ['submitted_at', 'submitted_at'],
    ['late', 'late'],
  ])('строка без несущего поля %s отбрасывается', (_label, field) => {
    const broken = row()
    delete broken[field]
    expect(parseSubmissionList(envelope(1, [broken]))).toEqual([])
  })

  it('чужой event вне трёх значений модели отбрасывается', () => {
    expect(parseSubmissionList(envelope(1, [row({ event: 'WAT' as never })]))).toEqual(
      [],
    )
  })

  it('id — ЧИСЛО (Ловушка №8: обычный pk, не UUID); строковый id отбраковывается', () => {
    expect(parseSubmissionList(envelope(1, [row({ id: '12' as never })]))).toEqual([])
  })
})

describe('currentSubmission', () => {
  it('первая строка с is_current === true', () => {
    const list = parseSubmissionList(
      envelope(2, [row({ id: 2, version: 2, is_current: false }), row({ id: 1 })]),
    )
    expect(currentSubmission(list)?.id).toBe(1)
  })

  it('строки ЕСТЬ, но is_current нет ни у одной → null (AC-2: три состояния, не два)', () => {
    const list = parseSubmissionList(envelope(1, [row({ is_current: false })]))
    expect(list).toHaveLength(1)
    expect(currentSubmission(list)).toBeNull()
  })

  it('пустой список → null', () => {
    expect(currentSubmission([])).toBeNull()
  })
})

describe('previousSubmission — зеркало DailySubmissionSelector.previous_for', () => {
  it('последняя ТЕКУЩАЯ сдача СТРОГО раньше даты (не «календарное вчера», Ловушка №4)', () => {
    // Выходные: пятница 17-го, дата дня — понедельник 20-го. previous_for
    // устойчив к разрыву, «вчера» (19-е) сдачи не имеет.
    const list = parseSubmissionList(
      envelope(2, [
        row({ id: 9, business_date: '2026-07-17', version: 2 }),
        row({ id: 3, business_date: '2026-07-13' }),
      ]),
    )
    expect(previousSubmission(list, '2026-07-20')?.id).toBe(9)
  })

  it('сдача САМОГО дня в предыдущие не попадает (business_date__lt — строгое)', () => {
    const list = parseSubmissionList(envelope(1, [row({ business_date: '2026-07-20' })]))
    expect(previousSubmission(list, '2026-07-20')).toBeNull()
  })

  it('будущая сдача (завтра сдали раньше сегодня) в предыдущие не попадает', () => {
    const list = parseSubmissionList(envelope(1, [row({ business_date: '2026-07-21' })]))
    expect(previousSubmission(list, '2026-07-20')).toBeNull()
  })

  it('исторические версии (is_current=false) не считаются предыдущей сдачей', () => {
    const list = parseSubmissionList(
      envelope(1, [row({ business_date: '2026-07-17', is_current: false })]),
    )
    expect(previousSubmission(list, '2026-07-20')).toBeNull()
  })

  it('пустая история → null (первая сдача: сервер даст CHANGED)', () => {
    expect(previousSubmission([], '2026-07-20')).toBeNull()
  })
})

describe('окно сдачи — {сегодня, завтра} (AC-5)', () => {
  it('submitWindow отдаёт ровно две даты, вторая = +1 день', () => {
    expect(submitWindow('2026-07-19')).toEqual(['2026-07-19', '2026-07-20'])
  })

  it('переход через конец месяца не ломает +1', () => {
    expect(submitWindow('2026-07-31')).toEqual(['2026-07-31', '2026-08-01'])
  })

  it.each([
    ['сегодня', '2026-07-19', true],
    ['завтра', '2026-07-20', true],
    ['послезавтра', '2026-07-21', false],
    ['вчера', '2026-07-18', false],
  ])('%s → %s', (_l, date, expected) => {
    expect(isWithinSubmitWindow(date, '2026-07-19')).toBe(expected)
  })
})

// ── QA-добор покрытия (qa-generate-e2e-tests, 2026-07-19) ────────────────────
describe('todayLocalIso — ЛОКАЛЬНАЯ дата браузера, не UTC-срез (Ловушка №5)', () => {
  afterEach(() => vi.useRealTimers())

  /** Независимая реализация (Intl) — перекрёстная проверка, а не тавтология. */
  const localIso = (date: Date) =>
    new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)

  it('на границе суток отдаёт ЛОКАЛЬНУЮ дату (UTC-реализация ошиблась бы на сутки)', () => {
    vi.useFakeTimers()
    // Момент строим ОТ смещения раннера, а не от константы: тест обязан быть
    // TZ-независимым. Восточное смещение → берём 00:30 локальных (UTC ещё
    // вчера), западное → 23:30 (UTC уже завтра). Ровно тот вечерний расход
    // зон, из-за которого окно сдачи уехало бы на сутки.
    const offsetMin = -new Date('2026-07-19T12:00:00Z').getTimezoneOffset()
    const localHour = offsetMin > 0 ? 0 : 23
    const instant = new Date(
      Date.UTC(2026, 6, 19, localHour, 30) - offsetMin * 60_000,
    )
    vi.setSystemTime(instant)

    expect(todayLocalIso()).toBe('2026-07-19')
    expect(todayLocalIso()).toBe(localIso(instant))
    if (offsetMin !== 0) {
      // Дискриминатор против вакуума: при TZ=UTC расхождения не существует
      // математически, и ассерт был бы зелёным на любой реализации.
      expect(todayLocalIso()).not.toBe(instant.toISOString().slice(0, 10))
    }
  })

  it('однозначные месяц и день дополняются нулём (ISO, а не 2026-1-5)', () => {
    vi.useFakeTimers()
    // Полдень — от смещения не зависит ни в одной зоне: проверяем формат.
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0))
    expect(todayLocalIso()).toBe('2026-01-05')
  })

  it('окно сдачи считается от ЛОКАЛЬНОГО «сегодня» — сцепка todayLocalIso × submitWindow', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 19, 12, 0, 0))
    const today = todayLocalIso()
    expect(submitWindow(today)).toEqual(['2026-07-19', '2026-07-20'])
    expect(isWithinSubmitWindow('2026-07-21', today)).toBe(false)
  })
})

describe('EVENT_LABELS — подписи ДОСЛОВНО из DailySubmission.Event', () => {
  it('три значения модели', () => {
    expect(EVENT_LABELS).toEqual({
      CONFIRMED_NO_CHANGES: 'Подтверждено без изменений',
      CHANGED: 'Изменено',
      AMENDED: 'Исправлено',
    })
  })
})

describe('describeSubmitFailure — ветвление по status, НЕ по kind', () => {
  it('409 DAY_ALREADY_SUBMITTED → already-submitted', () => {
    const failure = describeSubmitFailure(new ConflictError(init()))
    expect(failure.kind).toBe('already-submitted')
    expect(failure.message).toContain('День уже сдан')
  })

  it('422 BUSINESS_DATE_OUT_OF_WINDOW → out-of-window + allowed ИЗ ОТВЕТА', () => {
    const failure = describeSubmitFailure(
      new BusinessRuleError(
        init({
          status: 422,
          errorCode: 'BUSINESS_DATE_OUT_OF_WINDOW',
          message: 'business_date вне окна первичной сдачи.',
          details: { allowed: ['2026-01-05', '2026-01-06'] },
        }),
      ),
    )
    expect(failure.kind).toBe('out-of-window')
    expect(failure.allowed).toEqual(['2026-01-05', '2026-01-06'])
  })

  it.each([
    ['details пуст', {}],
    ['allowed не массив', { allowed: '2026-01-05' }],
    ['allowed с не-строками', { allowed: ['2026-01-05', 7] }],
    ['дефолтная фикстура §36 без allowed', { business_date: '2026-07-01' }],
  ])('422 c негодным allowed (%s) → allowed undefined, не throw', (_l, details) => {
    const failure = describeSubmitFailure(
      new BusinessRuleError(
        init({ status: 422, errorCode: 'BUSINESS_DATE_OUT_OF_WINDOW', details }),
      ),
    )
    expect(failure.kind).toBe('out-of-window')
    expect(failure.allowed).toBeUndefined()
  })

  it('403 → permission с ФИКСИРОВАННЫМ текстом: message конверта = сам error_code', () => {
    // scope_gate.py:41-43 бросает БЕЗ kwarg message ⇒ errors.ts:132 подставляет
    // в message сам код. Рендер error.message показал бы «PERMISSION_DENIED».
    const failure = describeSubmitFailure(
      new ApiError(init({ status: 403, errorCode: 'PERMISSION_DENIED', message: 'PERMISSION_DENIED' })),
    )
    expect(failure.kind).toBe('permission')
    expect(failure.message).toBe(PERMISSION_MESSAGE)
    expect(failure.message).toContain('daily_report.mark_update')
    expect(failure.message).not.toContain('PERMISSION_DENIED')
  })

  it('404 ENTITY_NOT_FOUND → not-found', () => {
    const failure = describeSubmitFailure(
      new ApiError(
        init({
          status: 404,
          errorCode: 'ENTITY_NOT_FOUND',
          message: 'Подразделение не найдено.',
          details: { division_id: DIVISION_ID },
        }),
      ),
    )
    expect(failure.kind).toBe('not-found')
    expect(failure.message).toContain('Подразделение не найдено')
  })

  it('400 VALIDATION_ERROR → validation', () => {
    const failure = describeSubmitFailure(
      new ValidationError(
        init({
          status: 400,
          errorCode: 'VALIDATION_ERROR',
          message: 'Проверьте заполнение формы.',
          details: { business_date: ['Неверный формат.'] },
        }),
      ),
    )
    expect(failure.kind).toBe('validation')
    expect(failure.message).toBe('Проверьте заполнение формы.')
  })

  it.each([
    ['500', 500],
    ['502', 502],
    ['503', 503],
  ])('%s → silent (тост useApiMutation уже показан, экран не дублирует)', (_l, status) => {
    const failure = describeSubmitFailure(new ServerError(init({ status })))
    expect(failure.kind).toBe('silent')
    expect(failure.message).toBe('')
  })

  it('сетевой обрыв → silent (единственная ветка БЕЗ status)', () => {
    const failure = describeSubmitFailure(new NetworkError('Сеть недоступна'))
    expect(failure.kind).toBe('silent')
  })

  it('401 → silent (цепь logout providers.tsx уже увела пользователя)', () => {
    const failure = describeSubmitFailure(
      new ApiError(init({ status: 401, errorCode: 'AUTH_REQUIRED' })),
    )
    expect(failure.kind).toBe('silent')
  })

  it.each([
    ['405', 405],
    ['406', 406],
    ['415', 415],
    ['429', 429],
  ])('%s БЕЗ конверта (errorCode null) не роняет разбор', (_l, status) => {
    const error = new ApiError(
      init({ status, errorCode: null, message: `HTTP ${status}` }),
    )
    expect(() => describeSubmitFailure(error)).not.toThrow()
    const failure = describeSubmitFailure(error)
    // Молчаливой дыры «отказ был, экран пуст» быть не должно.
    expect(failure.kind).not.toBe('silent')
    expect(failure.message).not.toBe('')
  })

  it('409 БЕЗ error_code не выдаётся за DAY_ALREADY_SUBMITTED', () => {
    const failure = describeSubmitFailure(
      new ApiError(init({ status: 409, errorCode: null, message: 'HTTP 409' })),
    )
    expect(failure.kind).not.toBe('already-submitted')
    expect(failure.kind).not.toBe('silent')
  })
})
