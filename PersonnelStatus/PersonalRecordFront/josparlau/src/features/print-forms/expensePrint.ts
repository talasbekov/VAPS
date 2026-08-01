// Стори 10.7 — чистая модель печатной формы расхода (`/print/expense`).
//
// ⚠️ РУКОПИСНОЕ ЗЕРКАЛО ТИПОВ — легально и обязано объяснить себя (ARCH-FE-011).
// `ExpensePeriodResponse` в `schema.d.ts:1310-1315` типизирован как
// `{ pages: { [key: string]: unknown }[] }` — тело страницы В СХЕМЕ НЕ ОПИСАНО
// (у роута `/period/` нет `@extend_schema` на теле). Схема непрозрачна ⇒
// `tsc` контракт-тестом здесь НЕ работает, и рукописные типы + тотальный
// рантайм-разбор — единственный способ не рендерить `undefined` в юридический
// артефакт. Прецеденты: `daySubmission.ts:1-20`, `amendment.ts` (10.6).
// Зеркало ЗАМЕЩАЕТСЯ схемными типами, когда бэк добавит `@extend_schema` и
// схема будет перегенерирована — это стори **10.7a**.
//
// ⚠️ Членов ячеек (ФИО/звание/период под числом, 8pt в .docx) здесь НЕТ и быть
// не может: `/period/` отдаёт «numbers only, read-only»
// (`expense_read_service.py:78`), а `snapshot` в `schema.d.ts` встречается
// 0 раз. Собрать их на фронте = переписать `resolve_status` и таблицу
// приоритетов на клиенте (прямой запрет 10.6/10.1b). Преемник — 10.7a.
//
// Чистые функции: ни React, ни apiClient (тестируются в env node).
import type { ApiFailure } from '../../shared/api/errors'

/**
 * Порядок статусных колонок ДОКУМЕНТА — дословное зеркало `DOCX_COLUMNS`
 * [Source: Backend/VAPS/apps/documents/generators/expense_docx.py#L32-47].
 *
 * ⚠️ Это НЕ порядок JSON: `REPORT_COLUMNS` (`strength_report.py:65-77`)
 * начинается с `SICK` и вообще не содержит `ATTACHED`. Итерировать по ключам
 * ответа нельзя — порядок ключей сериализации это случайность, а порядок
 * колонок документа это контракт. Дубль ключей с бэком ОСОЗНАННЫЙ — зеркало
 * того же решения 6.3 (границу не пересекаем, `features → Backend` невозможен).
 */
export const PRINT_COLUMNS = [
  'IN_SERVICE',
  'ON_DUTY',
  'AFTER_DUTY',
  'COMMAND',
  'TRAINING',
  'VACATION',
  'SICK',
  'ATTACHED',
  'DETACHED',
  'BEFORE_DUTY',
  'OTHER',
  'PENDING',
] as const

export type PrintColumnKey = (typeof PRINT_COLUMNS)[number]

/**
 * Лейблы шапки — литеральная копия `DOCX_COLUMN_LABELS`
 * [Source: expense_docx.py#L49-62]. Канон — addendum §8; хвост
 * «Перед дежурством»/«Иное» — выжимка §77.3, «Уточняется» — стори 3.9.
 */
export const PRINT_COLUMN_LABELS: Record<PrintColumnKey, string> = {
  IN_SERVICE: 'В строю',
  ON_DUTY: 'На дежурстве',
  AFTER_DUTY: 'После дежурства',
  COMMAND: 'В командировке',
  TRAINING: 'Учёба/соревнования/конференция',
  VACATION: 'В отпуске',
  SICK: 'На больничном',
  ATTACHED: 'Прикомандирован',
  DETACHED: 'Откомандирован',
  BEFORE_DUTY: 'Перед дежурством',
  OTHER: 'Иное',
  PENDING: 'Уточняется',
}

/** Зеркало `_FIXED_HEAD` [Source: expense_docx.py#L72]. */
export const FIXED_HEAD = [
  '№',
  'Управление',
  'По штату',
  'По списку',
  'Вакансии',
] as const

/**
 * Зеркало `_TOTALS_LABEL` [Source: expense_docx.py#L73].
 *
 * ⚠️ «ИТОГО», а НЕ «Общее». `DESIGN.md:145,310` и каркас 8.8 говорят «Общее»,
 * но каркас был демо-эталоном без данных, а печатная форма — контрольная копия
 * СГЕНЕРИРОВАННОГО документа и обязана совпадать с ним. Расхождение осознанное,
 * вынесено Открытым вопросом №1; кодом оно не «примиряется».
 */
export const TOTALS_LABEL = 'ИТОГО'

/**
 * Единственный ключ, читаемый НЕ из `columns`: `ATTACHED` есть в
 * `DOCX_COLUMNS`, но отсутствует в `REPORT_COLUMNS` — на проводе он приезжает
 * отдельным полем `attached`, и рендерится как `+N`
 * [Source: expense_docx.py#L166-169]. В `Σ == По списку` он НЕ входит:
 * прикомандированные вне списка (`list_total = len(members) - attached`).
 */
export const ATTACHED_KEY = 'ATTACHED'

/** Префикс `+` — часть контракта документа, не украшение вёрстки. */
export function formatAttached(count: number): string {
  return `+${count}`
}

export interface ExpensePrintRow {
  name: string
  staff_total: number
  list_total: number
  vacancies: number
  attached: number
  /** Только числовые значения; отсутствующий ключ читается как 0 (AC-5). */
  columns: Record<string, number>
}

export interface ExpensePrintTotals {
  staff_total: number
  list_total: number
  vacancies: number
  attached: number
  columns: Record<string, number>
}

export interface ExpensePrintPage {
  business_date: string
  totals: ExpensePrintTotals
  rows: ExpensePrintRow[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Не-число → 0: дыра в числовой ячейке документа хуже нуля. */
function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Не-числовые значения выбрасываются; читатель подставляет 0 (AC-5). */
function asColumns(value: unknown): Record<string, number> {
  const record = asRecord(value)
  if (record === null) return {}
  const columns: Record<string, number> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) columns[key] = raw
  }
  return columns
}

function parseTotals(value: unknown): ExpensePrintTotals {
  const record = asRecord(value)
  return {
    staff_total: asNumber(record?.staff_total),
    list_total: asNumber(record?.list_total),
    vacancies: asNumber(record?.vacancies),
    attached: asNumber(record?.attached),
    columns: asColumns(record?.columns),
  }
}

function parseRow(value: unknown): ExpensePrintRow | null {
  const record = asRecord(value)
  if (record === null) return null
  return {
    name: typeof record.name === 'string' ? record.name : '',
    staff_total: asNumber(record.staff_total),
    list_total: asNumber(record.list_total),
    vacancies: asNumber(record.vacancies),
    attached: asNumber(record.attached),
    columns: asColumns(record.columns),
  }
}

/**
 * Тотальный рантайм-разбор ответа `/period/`.
 *
 * Гарантия `openapi-typescript` — КОМПИЛЯЦИОННАЯ, не рантайм (тот же вывод, что
 * `trafficLight.ts:18-20`), а здесь схема к тому же пуста. Берётся ПЕРВАЯ
 * страница: запрос всегда однодневный (`date_from == date_to` ⇒ `derive_period`
 * отдаёт ровно одну страницу).
 *
 * `null` = «разобрать нечем». Это НЕ ошибка и НЕ пустая таблица: страница
 * показывает объясняющий текст и не рендерит таблицу вовсе (AC-9).
 */
export function parseExpensePage(raw: unknown): ExpensePrintPage | null {
  const body = asRecord(raw)
  if (body === null) return null
  const pages = body.pages
  if (!Array.isArray(pages) || pages.length === 0) return null
  const page = asRecord(pages[0])
  if (page === null) return null
  const rows = Array.isArray(page.rows)
    ? page.rows.map(parseRow).filter((row): row is ExpensePrintRow => row !== null)
    : []
  return {
    business_date:
      typeof page.business_date === 'string' ? page.business_date : '',
    totals: parseTotals(page.totals),
    rows,
  }
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `YYYY-MM-DD` → `ДД.ММ.ГГГГ` (зеркало `_DATE_FORMAT = "%d.%m.%Y"`).
 *
 * ⚠️ БЕЗ `new Date()`: конструктор на ISO-дате даёт UTC-полночь, и в минусовой
 * зоне `getDate()` вернул бы предыдущие сутки — в юридическом артефакте это
 * неверная дата (тот же класс ошибки, что `todayLocalIso`, `expense.ts:65-71`).
 * Перестановка строковая. Невалидный вход возвращается ДОСЛОВНО: выдумывать
 * дату документа нельзя.
 */
export function formatDocDate(iso: string): string {
  const match = ISO_DATE_RE.exec(iso)
  if (match === null) return iso
  return `${match[3]}.${match[2]}.${match[1]}`
}

/** Шаблон шапки — дословно [Source: expense_docx.py#L188-194]. */
const TITLE_SUFFIX = 'ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ'
const TITLE_TAIL = 'ЖЫЛҒЫ'

export function expenseTitle({
  divisionName,
  businessDate,
}: {
  divisionName: string
  businessDate: string
}): string {
  return `${divisionName} ${TITLE_SUFFIX} ${formatDocDate(businessDate)} ${TITLE_TAIL}`
}

/**
 * 403 на чтении расхода: текст ФИКСИРОВАННЫЙ, не из конверта — дословное
 * зеркало `ISSUE_PERMISSION_MESSAGE` (`expense.ts:44`). `scope_gate.py:41-43`
 * бросает `DomainError` БЕЗ kwarg `message`, а `errors.ts:132` подставляет в
 * `message` сам `error_code` ⇒ рендер `error.message` показал бы голое
 * «PERMISSION_DENIED».
 *
 * ⚠️ Текст про ПРАВО здесь был бы ложью: роут стоит за `RequirePermission`
 * (AC-1), актор без `daily_report.generate` до запроса не доходит вовсе.
 * Единственный достижимый 403 — «право есть, подразделение вне скоупа».
 */
export const PRINT_PERMISSION_MESSAGE =
  'Подразделение вне вашей зоны ответственности.'

export const PRINT_NOT_FOUND_MESSAGE = 'Подразделение не найдено.'

/** 422 `REPORT_NO_DATA_FOR_DATE` — дата раньше горизонта данных. */
export const PRINT_NO_DATA_MESSAGE = 'За эту дату данных ещё нет.'

/** 200 с телом, которое не разобрать: не ошибка и не пустая таблица (AC-9). */
export const PRINT_EMPTY_MESSAGE = 'Данных за эту дату нет.'

export type PrintFailureKind =
  | 'permission'
  | 'not-found'
  | 'no-data'
  | 'validation'
  | 'other'
  | 'silent'

export interface PrintFailureDescription {
  kind: PrintFailureKind
  /** Текст для страницы; для `silent` — пустой (страница ничего не рисует). */
  message: string
}

/**
 * Тотальная карта отказов печати (AC-9).
 *
 * Порядок ветвления обязателен и повторяет `daySubmission.ts:237-263`:
 * `kind === 'network'` ПЕРВЫМ (у `NetworkError` нет `.status` вовсе — он живёт
 * вне иерархии `ApiError`), затем `status`, внутри — `errorCode`, в хвосте
 * тотальный catch-all. 405/406/415/429 идут без конверта §36 ⇒
 * `errorCode === null`, и ветвление обязано это переживать.
 *
 * ⚠️ ОДНО ОСОЗНАННОЕ ОТСТУПЛЕНИЕ ОТ КАНОНА ОБРАЗЦОВ — не «чинить» обратно:
 * `describeIssueFailure`/`describeDownloadFailure` отправляют **5xx и network в
 * `silent`**, потому что там молчание оправдано глобальным тостом
 * `useApiMutation` (`useApiMutation.ts:80-82`). Здесь мутаций нет — страница
 * читает через `useQuery`, у которого тоста НЕТ, и `silent` означал бы пустой
 * лист без единого слова о том, что произошло. Поэтому 5xx и network получают
 * ТЕКСТ. Тост завести нельзя и не нужно: он отрендерился бы в портал вне
 * `.print-root` и покрасил бы DOM-скан печатного канона (AC-8).
 *
 * `401` остаётся `silent` — как в обоих образцах: `providers.tsx:27-32` вешает
 * `handle401` на `queryCache.onError`, credential чистится и `RequireAuth`
 * уводит на `/login`; текст успел бы только мигнуть поверх редиректа.
 */
export function describePrintFailure(
  error: ApiFailure,
): PrintFailureDescription {
  if (error.kind === 'network') {
    return { kind: 'other', message: `Не удалось загрузить расход: ${error.message}` }
  }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 403) {
    return { kind: 'permission', message: PRINT_PERMISSION_MESSAGE }
  }
  if (error.status === 404) {
    return { kind: 'not-found', message: PRINT_NOT_FOUND_MESSAGE }
  }
  if (error.status === 422 && error.errorCode === 'REPORT_NO_DATA_FOR_DATE') {
    return { kind: 'no-data', message: PRINT_NO_DATA_MESSAGE }
  }
  if (error.status === 400) {
    // Ветка ДОСТИЖИМА: `views.py:334-341` блокирует `date_to > today_local()`
    // текстом «Период не может уходить в будущее.», а печать «на завтра» —
    // легальный продуктовый жест. Второй путь — не-UUID `division_id`
    // (`serializers.py:115`). Текст из конверта, фикс-строки здесь нет.
    return { kind: 'validation', message: error.message }
  }
  return { kind: 'other', message: error.message }
}
