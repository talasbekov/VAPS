// Стори 10.5 — чистая модель экрана расхода (`/reports`).
//
// Типы ответа берутся ТОЛЬКО из `schema.d.ts` (ARCH-FE-011): в отличие от 10.3
// здесь `@extend_schema` стоит на всех действиях `ExpenseReportViewSet`, и
// схема несёт непустые `IssuedExpenseReport` / `ExpenseReportIssueRequest` —
// рукописного зеркала быть не должно, `tsc` работает контракт-тестом.
//
// ⚠️ Гарантия схемы — КОМПИЛЯЦИОННАЯ, не рантайм: `openapi-typescript` не
// валидирует байты на проводе (тот же вывод, что `trafficLight.ts:18-20`).
// Поэтому `parseIssuedReport` тотален.
//
// Исключение из «типы только из схемы»: конверт ошибки §36 в схеме НЕ описан
// вовсе (ни один 4xx не типизирован) — он приходит из `errors.ts`, а
// `details.laggards` типизируется руками с обязательным рантайм-разбором.
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { ApiFailure } from '../../shared/api/errors'
import type { components } from '../../shared/api/schema'

/** 14 полей `IssuedExpenseReportSerializer` (11 + `reason`/`supersedes_number`/
 * `supersedes_year`, стори 10.5b). */
export type IssuedExpenseReport = components['schemas']['IssuedExpenseReport']

/**
 * Подписи `IssuedExpenseReportStatusEnum` — дословно из схемы. Живёт здесь
 * (не в `ExpenseReportPage.tsx`), т.к. `ExpenseJournalPanel` (10.5c) тоже
 * его использует — импорт словаря из соседнего КОМПОНЕНТА дал бы
 * циклическую зависимость между двумя файлами страницы.
 */
export const STATUS_LABELS: Record<IssuedExpenseReport['status'], string> = {
  ISSUED: 'Выпущен',
  SUPERSEDED: 'Заменён',
}

/**
 * Тело выпуска — РОВНО два поля (`ExpenseReportIssueRequest`). Номер выдаёт
 * `DocumentSequence.allocate_number` под row-локом на бэке: клиент его не
 * подаёт и не может (фантом №3 — поля «Исх. №» и тумблера ФИНАЛ не существует).
 *
 * ⚠️ `type`, а НЕ `interface`: `useApiMutation<TData, TVariables extends
 * Record<string, unknown>>` требует присваиваемости к индекс-сигнатуре, а
 * `interface` неявной индекс-сигнатуры не получает — `tsc` покраснел бы
 * «Index signature ... is missing», и ошибка выглядела бы как проблема хука
 * (ловушка `daySubmission.ts:44-51`).
 */
export type ExpenseIssueBody = {
  division_id: string
  business_date: string
}

/**
 * 403 на ВЫПУСКЕ: текст ФИКСИРОВАННЫЙ, не из конверта. `scope_gate` бросает
 * `DomainError` БЕЗ kwarg `message`, а `errors.ts:132` подставляет в `message`
 * сам `error_code` — рендер `error.message` показал бы «PERMISSION_DENIED».
 */
export const ISSUE_PERMISSION_MESSAGE =
  'Подразделение вне вашей зоны ответственности.'

/**
 * 403 на СКАЧИВАНИИ — другой разрыв и другой текст. Скачивание гейтится
 * `document.view` (`documents/api/views.py:42`), а роль `OMD` имеет
 * `daily_report.generate` БЕЗ `document.view` (`seed_operations.py:51-55`):
 * актор выпускает документ и не может его скачать. Кнопку по праву НЕ прячем —
 * документ выпущен и лежит, «функции нет» было бы ложью (открытый вопрос №1).
 */
export const DOWNLOAD_PERMISSION_MESSAGE =
  'Нет права на скачивание документов. Требуется право document.view.'

/** Префикс «уже выпущен» — номер подклеивается ТОЛЬКО если он есть в details. */
export const ALREADY_ISSUED_PREFIX = 'Расход уже выпущен:'

/** Канон-строка успеха — `EXPERIENCE.md#L115`, дословно. */
export function issueSuccessMessage(number: number): string {
  return `Расход готов. Исх.№ ${number}.`
}

/** Сегодня в ЛОКАЛЬНОЙ зоне браузера: UTC-срез уехал бы на сутки вечером.
 *
 * ⚠️ ЧЕТВЁРТАЯ копия в репозитории (`daySubmission.ts:167`,
 * `DailyUpdatePage.tsx:74`, `TrafficLightTreePage.tsx:71`). Не импорт соседа:
 * ARCH-FE-013 запрещает `features/A → features/B`. Подъём в `shared/` —
 * отдельная стори-уборка (открытый вопрос №4).
 */
export function todayLocalIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Клиентское имя файла — ТОЛЬКО фолбэк к `Content-Disposition`.
 *
 * Зеркало формата `document_release_service.py:288`, а НЕ истина: если бэк
 * поменяет шаблон, истиной останется заголовок сервера, и расхождение увидят
 * только те скачивания, где заголовок не приехал.
 */
export function expenseFileName(report: {
  business_date: string
  number: number
}): string {
  return `расход_${report.business_date}_исх-${report.number}.docx`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const STATUSES: ReadonlySet<string> = new Set<
  components['schemas']['IssuedExpenseReportStatusEnum']
>(['ISSUED', 'SUPERSEDED'])

/**
 * Тотальный разбор проекции выпуска. Все 14 полей несущие: карточка показывает
 * номер, год, дату, статус и версию сдачи, а кнопку скачивания вообще нельзя
 * нарисовать без `attachment_id` — частичная строка дала бы «Исх.№ undefined»
 * и ссылку на `/attachments//download/` (AC-9).
 */
export function parseIssuedReport(raw: unknown): IssuedExpenseReport | null {
  const row = asRecord(raw)
  if (row === null) return null
  if (typeof row.id !== 'string' || row.id === '') return null
  if (typeof row.doc_type !== 'string') return null
  if (typeof row.number !== 'number') return null
  if (typeof row.year !== 'number') return null
  if (typeof row.business_date !== 'string') return null
  if (typeof row.division_id !== 'string') return null
  if (typeof row.submission_id !== 'number') return null
  if (typeof row.submission_version !== 'number') return null
  if (typeof row.status !== 'string' || !STATUSES.has(row.status)) return null
  if (typeof row.attachment_id !== 'string' || row.attachment_id === '') {
    return null
  }
  if (typeof row.sha256 !== 'string') return null
  // Story 10.5b (бэк): три новых поля — reason ("" у v1, непустой у amended),
  // supersedes_number/supersedes_year (number | null — null при первом
  // выпуске дня). Разбор — той же тотальной дисциплины, что остальные 11 полей.
  if (typeof row.reason !== 'string') return null
  if (typeof row.supersedes_number !== 'number' && row.supersedes_number !== null) {
    return null
  }
  if (typeof row.supersedes_year !== 'number' && row.supersedes_year !== null) {
    return null
  }
  return {
    id: row.id,
    doc_type: row.doc_type,
    number: row.number,
    year: row.year,
    business_date: row.business_date,
    division_id: row.division_id,
    submission_id: row.submission_id,
    submission_version: row.submission_version,
    status: row.status as components['schemas']['IssuedExpenseReportStatusEnum'],
    attachment_id: row.attachment_id,
    sha256: row.sha256,
    reason: row.reason,
    supersedes_number: row.supersedes_number,
    supersedes_year: row.supersedes_year,
  }
}

/**
 * Story 10.5c — разобранный конверт журнала выпусков (`GET .../journal/`,
 * 10.5b). `count`/`hasMore` — ИЗ КОНВЕРТА вербатим (AC-5 текст «из N»
 * обязан быть серверным числом), не пересчитываются по длине
 * `results` — невалидный элемент внутри страницы отбрасывается, но
 * не уменьшает заявленный сервером total.
 */
export interface ExpenseJournalPage {
  results: IssuedExpenseReport[]
  count: number
  hasMore: boolean
}

/**
 * Тотальный разбор конверта `{count, next, previous, results}` (10.5b,
 * зеркало `DailySubmissionListResponse`-конверта 10.1c). Каждый элемент
 * `results` проходит через `parseIssuedReport` — переиспользование, не
 * копия его логики (AC-7); мусорный элемент отбрасывается, остальные
 * строки не страдают (тот же приём, что `parseLaggards` ниже).
 */
export function parseExpenseJournal(raw: unknown): ExpenseJournalPage {
  const envelope = asRecord(raw)
  if (envelope === null || !Array.isArray(envelope.results)) {
    return { results: [], count: 0, hasMore: false }
  }
  const results: IssuedExpenseReport[] = []
  for (const item of envelope.results) {
    const parsed = parseIssuedReport(item)
    if (parsed !== null) results.push(parsed)
  }
  const count = typeof envelope.count === 'number' ? envelope.count : results.length
  const hasMore = typeof envelope.next === 'string' && envelope.next !== ''
  return { results, count, hasMore }
}

/**
 * `details.laggards` — ПЛОСКИЙ список UUID-строк, org-wide, БЕЗ имён
 * (`tomorrow_gate.py:31-32,45-50` — помечено как решение ревью D4).
 *
 * Значения ВЕРБАТИМ: ни сортировки, ни нормализации на клиенте — бэк уже отдаёт
 * `sorted(str(uuid))`, а своя сортировка сделала бы вид, что клиент что-то знает
 * о порядке. Частичному списку доверия нет: один не-строковый элемент означает,
 * что форма ответа не та, которую мы разбираем.
 */
export function parseLaggards(details: unknown): string[] {
  const record = asRecord(details)
  if (record === null) return []
  const laggards = record.laggards
  if (!Array.isArray(laggards)) return []
  if (!laggards.every((item) => typeof item === 'string')) return []
  return laggards as string[]
}

/** `details.violations` — массив финдингов (`_json_safe_findings`), не число. */
function violationCount(details: Record<string, unknown>): number | undefined {
  const violations = details.violations
  if (!Array.isArray(violations)) return undefined
  return violations.length
}

/** `details.number` — номер уже выпущенного (`document_release_service.py:266`). */
function issuedNumber(details: Record<string, unknown>): number | undefined {
  return typeof details.number === 'number' ? details.number : undefined
}

export type IssueFailureKind =
  | 'permission'
  | 'not-found'
  | 'not-ready'
  | 'already-issued'
  | 'not-convergent'
  | 'snapshot-unsupported'
  | 'tomorrow-blocked'
  | 'validation'
  | 'other'
  | 'silent'

export interface IssueFailureDescription {
  kind: IssueFailureKind
  /** Текст для инлайна; для `silent` — пустой (экран ничего не рисует). */
  message: string
  /** Только `already-issued`: документ существует, скачать его — не ошибка. */
  offerDownload?: boolean
  /** Только `not-convergent`: ЧИСЛО нарушений из ответа; деталей не сочиняем. */
  violationCount?: number
  /** Только `tomorrow-blocked`: список ИЗ ОТВЕТА, дословно (AC-6). */
  laggards?: string[]
}

/**
 * Тотальная карта отказов выпуска (AC-5).
 *
 * ⚠️ Порядок ветвления обязателен: `network → 5xx → 401 → 403 → 404 → 400 →
 * по errorCode`. `ApiError.kind` различает только validation(400)/
 * business_rule(422)/conflict(409)/server(5xx), а **401, 403 и 404 схлопнуты в
 * один `'api'`** — по `kind` их не развести (`daySubmission.ts:188-197`).
 * `NetworkError` живёт ВНЕ иерархии `ApiError`: у него нет `.status` вовсе,
 * поэтому его ветка идёт ПЕРВОЙ.
 *
 * 405/406/415/429 идут без конверта §36 ⇒ `errorCode === null` — ветвление
 * обязано это переживать, а не считать код гарантированным.
 *
 * `other` — тотальный catch-all: неучтённый статус попадает в инлайн с текстом
 * конверта, а НЕ в тишину. Живой пример — 422 `DATE_BEFORE_DATA_START`
 * (`expense_read_service.py:52`), которого в таблице AC-5 нет.
 */
export function describeIssueFailure(
  error: ApiFailure,
): IssueFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  // 5xx и 401 уже обслужены: тост useApiMutation и цепь logout providers.tsx.
  // Второе сообщение здесь было бы дублем, а дубль хуже молчания.
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 403) {
    return { kind: 'permission', message: ISSUE_PERMISSION_MESSAGE }
  }
  if (error.status === 404) {
    // На POST 404 = фантомный division_id (`_ensure_division_exists`);
    // «расход не выпущен» тем же кодом приходит только на GET.
    return { kind: 'not-found', message: 'Подразделение не найдено.' }
  }
  if (error.status === 400) {
    return { kind: 'validation', message: error.message }
  }
  if (error.status === 409 && error.errorCode === 'REPORT_NOT_READY_FOR_DATE') {
    // ⚠️ ЭТО и есть per-division гейт готовности. `MARKS_INCOMPLETE` — фантом
    // (0 raise-сайтов в бэке, живёт донор-константой в error-codes.yaml).
    return { kind: 'not-ready', message: 'День не сдан — выпускать нечего.' }
  }
  if (error.status === 409 && error.errorCode === 'DOCUMENT_ALREADY_ISSUED') {
    const number = issuedNumber(error.details)
    return {
      kind: 'already-issued',
      message:
        number === undefined
          ? ALREADY_ISSUED_PREFIX
          : `${ALREADY_ISSUED_PREFIX} исх.№ ${number}`,
      // Повторная выдача файла — операция СКАЧИВАНИЯ, не ошибка (контракт §4).
      offerDownload: true,
    }
  }
  if (error.status === 422 && error.errorCode === 'REPORT_NOT_CONVERGENT') {
    return {
      kind: 'not-convergent',
      message: 'Расход не сходится — выпуск отказан.',
      violationCount: violationCount(error.details),
    }
  }
  if (error.status === 422 && error.errorCode === 'SNAPSHOT_SCHEMA_UNSUPPORTED') {
    return {
      kind: 'snapshot-unsupported',
      message:
        'Снапшот сдачи имеет неподдерживаемую версию схемы — выпуск невозможен.',
    }
  }
  if (error.status === 422 && error.errorCode === 'TOMORROW_BLOCKED') {
    return {
      kind: 'tomorrow-blocked',
      message: 'Не готово: расход на завтра заблокирован.',
      laggards: parseLaggards(error.details),
    }
  }
  return { kind: 'other', message: error.message }
}

/**
 * Отказ СКАЧИВАНИЯ (AC-7) — отдельная функция, а не ветка карты выпуска: у
 * скачивания свой разрыв прав и свои коды.
 *
 * Пустая строка = «сообщение уже показано другим каналом»: скачивание идёт
 * через `useApiMutation`, и 5xx/сеть он сам отправляет в глобальный тост
 * (`useApiMutation.ts:80-82`). Инлайн-дубль поверх тоста хуже молчания — тот же
 * приём, что ветка `'silent'` карты выпуска.
 *
 * 403 молчать НЕ ИМЕЕТ ПРАВА: это живой разрыв (`OMD` выпускает, но не
 * скачивает), и тоста на 403 `useApiMutation` не показывает — без явного текста
 * нажатие кнопки выглядело бы как «ничего не произошло».
 */
export function describeDownloadFailure(error: ApiFailure): string {
  if (error.kind === 'network') return ''
  if (error.status >= 500) return ''
  // 401 глушится по той же причине, что в карте выпуска: handle401 providers
  // висит на ОБОИХ кэшах (query и mutation) и уже увёл на logout — инлайн
  // успел бы только мигнуть дублем поверх редиректа.
  if (error.status === 401) return ''
  if (error.status === 403) return DOWNLOAD_PERMISSION_MESSAGE
  if (error.status === 404) return 'Файл документа не найден.'
  return `Не удалось скачать файл: ${error.message}`
}

/**
 * Story 10.5a — тело обхода блокировки «на завтра». РОВНО `{business_date,
 * reason}` — БЕЗ `division_id` (обход day-level, не per-division:
 * `override_tomorrow_block` его не принимает, `views.py:458-518`) и без
 * актора (сервер берёт `request.actor_id`).
 *
 * `type`, а НЕ `interface` — тот же приём, что `ExpenseIssueBody` (см. выше):
 * `useApiMutation<TData, TVariables>` требует присваиваемости к индекс-
 * сигнатуре, `interface` её неявно не получает.
 */
export type TomorrowBlockOverrideBody = {
  business_date: string
  reason: string
}

export type TomorrowBlockOverrideResponse =
  components['schemas']['TomorrowBlockOverrideResponse']

/** Причина обхода непуста после `trim()` — зеркало DRF-400 на пустой `CharField`. */
export function isOverrideReasonComplete(reason: string): boolean {
  return reason.trim().length > 0
}

export type OverrideFailureKind =
  | 'permission'
  | 'already-overridden'
  | 'validation'
  | 'other'
  | 'silent'

export interface OverrideFailureDescription {
  kind: OverrideFailureKind
  /** Текст для инлайна; для `silent` — пустой (форма ничего не рисует). */
  message: string
}

/**
 * Story 10.5a — тотальная карта отказов обхода (AC-5, AC-6, AC-7). Стиль —
 * зеркало `describeIssueFailure` (порядок ветвления `network → 5xx → 401 →
 * 403 → 400 → по errorCode`), но СВОЙ меньший набор кодов: обход не несёт
 * `not-found`/`not-ready`/`already-issued`/`not-convergent` карты выпуска —
 * это другой эндпоинт с другими отказами.
 */
export function describeOverrideFailure(
  error: ApiFailure,
): OverrideFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 403) {
    return { kind: 'permission', message: 'Нет права на обход блокировки.' }
  }
  if (error.status === 409 && error.errorCode === 'TOMORROW_BLOCK_ALREADY_OVERRIDDEN') {
    return {
      kind: 'already-overridden',
      message: 'Обход на эту дату уже существует.',
    }
  }
  if (error.status === 400) {
    return { kind: 'validation', message: error.message }
  }
  return { kind: 'other', message: error.message }
}

/**
 * Story 10.5e — страница «расход за дату» из read-only периода
 * (`GET .../period/`, 6.10a, типизировано 10.5e). Тип — из схемы, домен
 * (`derive_period`/`_serialize_report`) НЕ менялся этой стори.
 */
export type ExpensePeriodPage = components['schemas']['ExpensePeriodPage']

/**
 * Тотальный разбор конверта `{pages: [...]}`. Мусорный элемент внутри
 * `pages` ОТБРАСЫВАЕТСЯ построчно (тот же приём, что `parseExpenseJournal`),
 * а не роняет весь список — частичная страница честнее пустого экрана.
 */
export function parseExpensePeriod(raw: unknown): ExpensePeriodPage[] {
  const envelope = asRecord(raw)
  if (envelope === null || !Array.isArray(envelope.pages)) return []
  const pages: ExpensePeriodPage[] = []
  for (const item of envelope.pages) {
    const row = asRecord(item)
    if (row === null) continue
    if (typeof row.business_date !== 'string') continue
    const totals = asRecord(row.totals)
    if (totals === null) continue
    if (
      typeof totals.staff_total !== 'number' ||
      typeof totals.list_total !== 'number' ||
      typeof totals.vacancies !== 'number' ||
      typeof totals.attached !== 'number'
    ) {
      continue
    }
    // rows/columns НЕ провалидированы построчно — экран этой стори читает
    // ТОЛЬКО totals (AC-3, `rows`-детализация вне скоупа); углублённая
    // проверка вложенной формы, которую никто не читает, — мёртвый код.
    pages.push({
      business_date: row.business_date,
      totals: {
        staff_total: totals.staff_total,
        list_total: totals.list_total,
        vacancies: totals.vacancies,
        attached: totals.attached,
        columns: (totals.columns ?? {}) as Record<string, number>,
      },
      rows: Array.isArray(row.rows) ? (row.rows as ExpensePeriodPage['rows']) : [],
    })
  }
  return pages
}

export type ExpensePeriodFailureKind = 'validation' | 'other' | 'silent'

export interface ExpensePeriodFailureDescription {
  kind: ExpensePeriodFailureKind
  /** Текст для инлайна; для `silent` — пустой. */
  message: string
}

/**
 * Отказы периода (AC-4) — 400 (инверсия/длина) и 422 (`REPORT_NO_DATA_FOR_DATE`)
 * оба несут точный текст в конверте (лимит `62` — серверная константа,
 * `data_horizon` — серверная дата), поэтому ОБА ветвятся в один и тот же
 * `validation`-исход с `error.message` дословно — свой текст не сочиняем.
 */
export function describeExpensePeriodFailure(
  error: ApiFailure,
): ExpensePeriodFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 400 || error.status === 422) {
    return { kind: 'validation', message: error.message }
  }
  return { kind: 'other', message: error.message }
}

/**
 * Story 20.2c — org-wide дашборд (`GET .../expense-reports/dashboard/`,
 * 20.2b). Тип — из схемы (`ExpenseDashboardResponse`, ARCH-FE-011).
 * `laggards` ЗДЕСЬ — {division_id, name}[] от `compute_expense_dashboard`
 * (20.2a) — НЕ путать с `parseLaggards`'s плоским `string[]` из 422
 * `TOMORROW_BLOCKED`-ошибки (другой источник, другая форма, тот же файл).
 */
export type ExpenseDashboardRow = components['schemas']['ExpenseDashboardRow']
export type ExpenseDashboardLaggard = components['schemas']['ExpenseDashboardLaggard']

export interface ExpenseDashboard {
  businessDate: string
  rows: ExpenseDashboardRow[]
  totals: {
    staffTotal: number
    listTotal: number
    vacancies: number
    attached: number
  }
  laggards: ExpenseDashboardLaggard[]
  blocked: boolean
  overridden: boolean
}

function parseDashboardRow(raw: unknown): ExpenseDashboardRow | null {
  const row = asRecord(raw)
  if (row === null) return null
  if (typeof row.division_id !== 'string') return null
  if (typeof row.name !== 'string') return null
  if (typeof row.staff_total !== 'number') return null
  if (typeof row.list_total !== 'number') return null
  if (typeof row.vacancies !== 'number') return null
  if (typeof row.attached !== 'number') return null
  return {
    division_id: row.division_id,
    name: row.name,
    staff_total: row.staff_total,
    list_total: row.list_total,
    vacancies: row.vacancies,
    attached: row.attached,
    columns: (asRecord(row.columns) ?? {}) as Record<string, number>,
  }
}

function parseDashboardLaggard(raw: unknown): ExpenseDashboardLaggard | null {
  const row = asRecord(raw)
  if (row === null) return null
  if (typeof row.division_id !== 'string') return null
  if (typeof row.name !== 'string') return null
  return { division_id: row.division_id, name: row.name }
}

/**
 * Тотальный разбор — невалидный конверт даёт `null` (панель показывает
 * честную ошибку загрузки, не пустой/фиктивный дашборд). Мусорная строка
 * внутри `rows`/`laggards` отбрасывается построчно (тот же приём, что
 * `parseExpenseJournal`), остальные строки не страдают.
 */
export function parseExpenseDashboard(raw: unknown): ExpenseDashboard | null {
  const envelope = asRecord(raw)
  if (envelope === null) return null
  if (typeof envelope.business_date !== 'string') return null
  if (typeof envelope.blocked !== 'boolean') return null
  if (typeof envelope.overridden !== 'boolean') return null
  const expense = asRecord(envelope.expense)
  if (expense === null) return null
  const totals = asRecord(expense.totals)
  if (totals === null) return null
  if (
    typeof totals.staff_total !== 'number' ||
    typeof totals.list_total !== 'number' ||
    typeof totals.vacancies !== 'number' ||
    typeof totals.attached !== 'number'
  ) {
    return null
  }
  if (!Array.isArray(expense.rows) || !Array.isArray(envelope.laggards)) {
    return null
  }
  const rows: ExpenseDashboardRow[] = []
  for (const item of expense.rows) {
    const parsed = parseDashboardRow(item)
    if (parsed !== null) rows.push(parsed)
  }
  const laggards: ExpenseDashboardLaggard[] = []
  for (const item of envelope.laggards) {
    const parsed = parseDashboardLaggard(item)
    if (parsed !== null) laggards.push(parsed)
  }
  return {
    businessDate: envelope.business_date,
    rows,
    totals: {
      staffTotal: totals.staff_total,
      listTotal: totals.list_total,
      vacancies: totals.vacancies,
      attached: totals.attached,
    },
    laggards,
    blocked: envelope.blocked,
    overridden: envelope.overridden,
  }
}

export type ExpenseDashboardFailureKind = 'validation' | 'other' | 'silent'

export interface ExpenseDashboardFailureDescription {
  kind: ExpenseDashboardFailureKind
  /** Текст для инлайна; для `silent` — пустой. */
  message: string
}

/** Тот же класс, что `describeExpensePeriodFailure` — 400/422 несут точный
 * серверный текст, 5xx/сеть/401 молчат (панель — обогащение, не первичный
 * сигнал экрана). */
export function describeExpenseDashboardFailure(
  error: ApiFailure,
): ExpenseDashboardFailureDescription {
  if (error.kind === 'network') return { kind: 'silent', message: '' }
  if (error.status >= 500) return { kind: 'silent', message: '' }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 400 || error.status === 422) {
    return { kind: 'validation', message: error.message }
  }
  return { kind: 'other', message: error.message }
}
