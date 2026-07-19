// Story 10.3 — контракт daily-submissions на фронте.
//
// РУКОПИСНОЕ ЗЕРКАЛО `DailySubmissionSerializer` / `DailySubmissionCreateSerializer`.
// Схема этих путей типов НЕ несёт: `DailySubmissionViewSet` — голый `ViewSet`
// без `@extend_schema`, spectacular эмитит «No response body» (`requestBody?:
// never`, 201 `content?: never`) — индексировать нечего. Поэтому ARCH-FE-011
// («рукописные типы при наличии схемы = MUST NOT») здесь не нарушен: схемы нет
// (Решение №3 стори). Прецедент формы — `statusTypes.ts` (10.2).
// Заменяется схемными типами в стори **10.1c** (`@extend_schema` + regen);
// `parseSubmissionList` после этого остаётся санитайзером.
//
// Источник истины:
//   Backend/VAPS/apps/operations/submissions/api/serializers.py:12-72
//   Backend/VAPS/apps/operations/submissions/models/daily_submission.py (Event)
//
// Цена Решения №3, названная честно: `tsc` здесь контракт-тестом НЕ работает
// (в 10.2 работал — там тело было схемным type alias). Единственная защита от
// дрейфа бэкенда — рантайм-разбор ниже, поэтому он тотальный.
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { ApiFailure } from '../../shared/api/errors'

/** Три значения `DailySubmission.Event` — других бэк не эмитит. */
export type DaySubmissionEvent = 'CONFIRMED_NO_CHANGES' | 'CHANGED' | 'AMENDED'

/** 9-полевая проекция `DailySubmissionSerializer.Meta.fields` (без snapshot). */
export interface DaySubmission {
  /** Ловушка №8: обычный Django-pk (ЧИСЛО); UUID здесь только division_id. */
  id: number
  division_id: string
  business_date: string
  version: number
  is_current: boolean
  event: DaySubmissionEvent
  submitted_by: string
  submitted_at: string
  late: boolean
}

/**
 * Тело `DailySubmissionCreateSerializer` — РОВНО два поля. `submitted_by` бэк
 * игнорирует (ARCH-SEC-030: actor из auth-контракта) — не отправляем, иначе UI
 * обещал бы влияние, которого нет.
 *
 * ⚠️ `type`, а НЕ `interface` (Ловушка №10): `useApiMutation<TData, TVariables
 * extends Record<string, unknown>>` требует присваиваемости к индекс-сигнатуре,
 * а `interface` неявной индекс-сигнатуры не получает — `tsc` покраснел бы
 * «Index signature for type 'string' is missing», и ошибка выглядела бы как
 * проблема хука, а не объявления.
 */
export type DaySubmissionCreateBody = {
  division_id: string
  business_date: string
}

/** Подписи событий — ДОСЛОВНО из `DailySubmission.Event` (бэк, models). */
export const EVENT_LABELS: Record<DaySubmissionEvent, string> = {
  CONFIRMED_NO_CHANGES: 'Подтверждено без изменений',
  CHANGED: 'Изменено',
  AMENDED: 'Исправлено',
}

/**
 * 403 на сдаче: текст ФИКСИРОВАННЫЙ, не из конверта. `scope_gate.py:41-43`
 * бросает `DomainError` БЕЗ kwarg `message`, а `errors.ts:132` подставляет в
 * `message` сам `error_code` — рендер `error.message` показал бы оператору
 * «PERMISSION_DENIED».
 */
export const PERMISSION_MESSAGE =
  'Недостаточно прав на сдачу дня. Требуется право daily_report.mark_update.'

const EVENTS: ReadonlySet<string> = new Set<DaySubmissionEvent>([
  'CONFIRMED_NO_CHANGES',
  'CHANGED',
  'AMENDED',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

/** Одна строка проекции или null, если хоть одно несущее поле не того типа. */
function parseSubmission(raw: unknown): DaySubmission | null {
  const row = asRecord(raw)
  if (row === null) return null
  // Все девять полей — несущие: панель показывает версию, событие, автора и
  // время, а решение «день сдан» принимает по is_current. Частичная строка
  // дала бы «День сдан: vundefined» вместо честного «день не сдан».
  if (typeof row.id !== 'number') return null
  if (typeof row.division_id !== 'string') return null
  if (typeof row.business_date !== 'string') return null
  if (typeof row.version !== 'number') return null
  if (typeof row.is_current !== 'boolean') return null
  if (typeof row.event !== 'string' || !EVENTS.has(row.event)) return null
  if (typeof row.submitted_by !== 'string') return null
  if (typeof row.submitted_at !== 'string') return null
  if (typeof row.late !== 'boolean') return null
  return {
    id: row.id,
    division_id: row.division_id,
    business_date: row.business_date,
    version: row.version,
    is_current: row.is_current,
    event: row.event as DaySubmissionEvent,
    submitted_by: row.submitted_by,
    submitted_at: row.submitted_at,
    late: row.late,
  }
}

/**
 * Конверт LimitOffsetPagination (`{count, next, previous, results}` — `limit`/
 * `offset`, НЕ `page`: у `/api/core/employees/` пагинация другая, Ловушка №3).
 * Читаем ЗАЩИТНО: не объект / нет `results`-массива / кривые элементы —
 * отбрасываются без исключений. Пустой результат = «сдач по этому дню нет»,
 * а не «ошибка» (ошибку чтения панель узнаёт из `isError` query).
 */
export function parseSubmissionList(payload: unknown): DaySubmission[] {
  const envelope = asRecord(payload)
  if (envelope === null) return []
  if (!Array.isArray(envelope.results)) return []
  const parsed: DaySubmission[] = []
  for (const raw of envelope.results) {
    const submission = parseSubmission(raw)
    if (submission !== null) parsed.push(submission)
  }
  return parsed
}

/**
 * Текущая версия дня. Селектор бэка по `is_current` НЕ фильтрует — приходят ВСЕ
 * версии (порядок `-business_date, -version, id`), поэтому «день сдан»
 * решается по ФЛАГУ, а не по `results.length`: список из одних исторических
 * версий (после amendment-цепочки) — это «день не сдан» в терминах текущей.
 */
export function currentSubmission(list: DaySubmission[]): DaySubmission | null {
  return list.find((submission) => submission.is_current) ?? null
}

/**
 * Зеркало `DailySubmissionSelector.previous_for` на клиенте: последняя ТЕКУЩАЯ
 * сдача СТРОГО раньше `businessDate`.
 *
 * ⚠️ Это НЕ «календарное вчера» (Ловушка №4): после выходных предыдущая сдача
 * — пятничная, и любой текст про «вчера» на экране солгал бы. Список приходит
 * уже упорядоченным бэком (`-business_date, -version, id`), поэтому первое
 * совпадение и есть самое свежее — своей сортировки не заводим.
 *
 * Нужно предпросмотру (AC-3): серверный `_compute_event` при `previous is None`
 * отдаёт CHANGED — без этого знания предсказание «Подтверждено без изменений»
 * было бы заведомо неверным на первой сдаче подразделения.
 */
export function previousSubmission(
  list: DaySubmission[],
  businessDate: string,
): DaySubmission | null {
  return (
    list.find(
      (submission) =>
        submission.is_current && submission.business_date < businessDate,
    ) ?? null
  )
}

/** Сегодня в ЛОКАЛЬНОЙ зоне браузера: UTC-срез уехал бы на сутки вечером. */
export function todayLocalIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Окно первичной сдачи — `{сегодня, сегодня+1}`, зеркало `_default_window()`.
 * UTC-математика (приём `prefill.ts`): локальный парсер сдвинул бы дату на
 * границе суток.
 *
 * ⚠️ Считает БРАУЗЕР, а решает СЕРВЕР (`Clock.today_local()` в
 * `VAPS_LOCAL_TIMEZONE`). Вечером на границе суток зоны разойдутся — поэтому
 * это удобство (не отправлять заведомо мимо), а истина при 422 —
 * `details.allowed` из ответа (AC-5).
 */
export function submitWindow(today: string): [string, string] {
  const tomorrow = new Date(`${today}T00:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return [today, tomorrow.toISOString().slice(0, 10)]
}

export function isWithinSubmitWindow(
  businessDate: string,
  today: string,
): boolean {
  return submitWindow(today).includes(businessDate)
}

/**
 * Канал отображения отказа сдачи (AC-8, AC-9).
 * `other` — тотальный catch-all (прецедент `bulkErrors.ts` с его `rows`):
 * неучтённый статус попадает в инлайн с текстом конверта, а не в тишину.
 */
export type SubmitFailureKind =
  | 'already-submitted'
  | 'out-of-window'
  | 'permission'
  | 'not-found'
  | 'validation'
  | 'other'
  | 'silent'

export interface SubmitFailureDescription {
  kind: SubmitFailureKind
  /** Текст для инлайна; для `silent` — пустой (панель ничего не рисует). */
  message: string
  /** Только для `out-of-window`: даты ИЗ ОТВЕТА (AC-5), не своё предположение. */
  allowed?: string[]
}

/** `details.allowed` — список ISO-дат; всё прочее (в т.ч. смесь типов) → undefined. */
function parseAllowed(details: Record<string, unknown>): string[] | undefined {
  const allowed = details.allowed
  if (!Array.isArray(allowed)) return undefined
  if (!allowed.every((item) => typeof item === 'string')) return undefined
  if (allowed.length === 0) return undefined
  return allowed as string[]
}

/**
 * ⚠️ Порядок ветвления — как в `bulkErrors.ts:79-86`, а НЕ «по `kind`».
 * `ApiError.kind` различает только validation(400)/business_rule(422)/
 * conflict(409)/server(5xx), а **401, 403 и 404 схлопнуты в один `'api'`** — по
 * `kind` их не развести. Поэтому: сначала `kind === 'network'` (единственная
 * ветка, где `status` не существует вовсе — `NetworkError` живёт ВНЕ иерархии
 * `ApiError`, Ловушка №6), дальше по `status`, и внутри 409/422 — по
 * `errorCode`. 405/406/415/429 идут без конверта §36 ⇒ `errorCode === null` —
 * ветвление обязано это переживать, а не считать код гарантированным.
 */
export function describeSubmitFailure(error: ApiFailure): SubmitFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  // 5xx и 401 уже обслужены: тост useApiMutation и цепь logout providers.tsx.
  // Экран своего сообщения не добавляет — дублирование хуже молчания.
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 403) return { kind: 'permission', message: PERMISSION_MESSAGE }
  if (error.status === 404) {
    return { kind: 'not-found', message: 'Подразделение не найдено.' }
  }
  if (error.status === 400) return { kind: 'validation', message: error.message }
  if (error.status === 409 && error.errorCode === 'DAY_ALREADY_SUBMITTED') {
    return {
      kind: 'already-submitted',
      // 10.6: путь пересдачи теперь не только НАЗВАН, но и ПРОХОДИМ — кнопка
      // «Исправить сдачу» есть в панели (при праве daily_report.correct).
      // Префикс «День уже сдан» сохранён намеренно: текст запинен тремя
      // ассертами (DaySubmissionPanel.test.tsx:309,362 — дословно;
      // daySubmission.test.ts:262 — toContain).
      message: 'День уже сдан. Исправить его можно кнопкой «Исправить сдачу».',
    }
  }
  if (error.status === 422 && error.errorCode === 'BUSINESS_DATE_OUT_OF_WINDOW') {
    return {
      kind: 'out-of-window',
      message: 'Сдать можно только за сегодня или завтра.',
      allowed: parseAllowed(error.details),
    }
  }
  return { kind: 'other', message: error.message }
}
