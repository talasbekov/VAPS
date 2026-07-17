// Story 10.7 — чистый парсер/вью-модель печатной формы расхода (зеркало
// expenseReport.ts 10.5 / dayState.ts 10.3: страница рендерит ГОТОВУЮ модель).
//
// Канон колонок — ОСОЗНАННЫЙ литеральный дубль backend-канона
// apps/documents/generators/expense_docx.py:32-62 (_FIXED_HEAD L72,
// _TOTALS_LABEL L73, _DATE_FORMAT L74): бэк сам дублирует REPORT_COLUMNS ↔
// DOCX_COLUMNS с sync-тестом, кросс-язычного sync-теста фронт↔бэк НЕТ —
// дрейф-риск закрыт частично STOP-парсером ниже (исчезнувший ключ бэка
// краснеет в рантайме контракт-ошибкой, НЕ молчаливым нулём).
//
// Схема ответа GET /api/operations/expense-reports/period/ в OpenAPI слабая
// (ExpensePeriodResponse.pages: DictField → Record<string, unknown>[] в
// schema.d.ts), поэтому defensive-разбор по фактической форме
// _serialize_report (expense_read_service.py:77-101); типы руками НЕ
// дублируются сверх необходимого разбора.

/** 12 ключей статусных колонок в каноническом порядке DOCX_COLUMNS. */
export const DOCX_COLUMNS = [
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

export type DocxColumnKey = (typeof DOCX_COLUMNS)[number]

/** Русские лейблы шапки — литеральная копия DOCX_COLUMN_LABELS. */
export const DOCX_COLUMN_LABELS: Record<DocxColumnKey, string> = {
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

/** Фикс-шапка таблицы — зеркало _FIXED_HEAD. */
export const FIXED_HEAD = [
  '№',
  'Управление',
  'По штату',
  'По списку',
  'Вакансии',
] as const

/** Подпись итоговой строки — зеркало _TOTALS_LABEL (заглавными). */
export const TOTALS_LABEL = 'ИТОГО'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Валидация query-параметра date (ISO YYYY-MM-DD) + календарная
 * существуемость: '2026-13-99' прошла бы regex и дала бы «99.13.2026» в
 * заголовке ДОКУМЕНТА (ревью 10.7 ECH#3) — календарно невозможная дата =
 * «не ISO-дата» по смыслу контракта.
 */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

/** Валидация query-параметра division_id (канонический uuid). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** ISO YYYY-MM-DD → ДД.ММ.ГГГГ (зеркало _DATE_FORMAT "%d.%m.%Y"). */
export function formatPrintDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

export interface PrintRowVM {
  /** division_id строки — стабильный key рендера. */
  key: string
  name: string
  staffTotal: number
  listTotal: number
  vacancies: number
  /** 12 отображаемых значений в порядке DOCX_COLUMNS; ATTACHED — «+N». */
  cells: string[]
}

export interface PrintTotalsVM {
  staffTotal: number
  listTotal: number
  vacancies: number
  cells: string[]
}

export interface ExpensePrintModel {
  /** `{Подразделение} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ {ДД.ММ.ГГГГ} ЖЫЛҒЫ`. */
  title: string
  /** Имя подразделения НЕ выведено в заголовок (rows пусты ИЛИ name="") —
   *  экранная пометка, имя не выдумывается. */
  divisionNameMissing: boolean
  rows: PrintRowVM[]
  totals: PrintTotalsVM
}

export type ExpensePrintParse =
  | { kind: 'ok'; model: ExpensePrintModel }
  | { kind: 'contract-error'; reason: string }

function contractError(reason: string): ExpensePrintParse {
  return { kind: 'contract-error', reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// derive отдаёт ТОЛЬКО неотрицательные целые (+=1 / max(0,…),
// strength_report.py) — отрицательное/дробное/экспоненциальное значение =
// дрейф контракта, а не число документа (ревью 10.7 BH#2/ECH#2: «+-1» и
// «2.5» на бумаге вместо STOP).
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

// 11 ключей REPORT_COLUMNS = канон МИНУС ATTACHED (он живёт отдельным полем).
const REPORT_KEYS: ReadonlySet<string> = new Set(
  DOCX_COLUMNS.filter((key) => key !== 'ATTACHED'),
)

/**
 * 12 ячеек в порядке DOCX_COLUMNS из columns + attached; ATTACHED живёт
 * отдельным полем attached (вне «По списку», рендер «+N» — fill_status_cell).
 * Отсутствующий/нечисловой ключ канона → null (STOP-семантика, НЕ ноль).
 */
function buildCells(columns: unknown, attached: unknown): string[] | null {
  if (!isRecord(columns) || !isCount(attached)) return null
  // Дрейф-STOP в ОБЕ стороны (ревью 10.7 ECH#1): лишний ключ columns = новая
  // колонка бэка, которой нет в каноне печати → Σ видимых колонок ≠
  // «По списку», формула ломается В ДОКУМЕНТЕ (канон expense_docx.py:28-30);
  // бэковский sync-тест (бэк↔бэк) этот дрейф не поймает.
  for (const key of Object.keys(columns)) {
    if (!REPORT_KEYS.has(key)) return null
  }
  const cells: string[] = []
  for (const key of DOCX_COLUMNS) {
    if (key === 'ATTACHED') {
      cells.push(`+${attached}`)
      continue
    }
    const value = columns[key]
    if (!isCount(value)) return null
    cells.push(String(value))
  }
  return cells
}

/**
 * Defensive-разбор ответа `GET /period/` (single-date → ровно одна страница)
 * во вью-модель печати. Любой дрейф формы — контракт-ошибка (AC-5): страница
 * покажет ошибку данных, НЕ молчаливые нули/частичную таблицу.
 */
export function buildExpensePrintModel(
  response: unknown,
  divisionId: string,
  /** Запрошенная дата (query `date`): страница за ДРУГУЮ дату — дрейф → STOP
   *  (ревью 10.7 ECH#7). Не передана — сверка пропускается (юнит-фикстуры). */
  requestedDate?: string,
): ExpensePrintParse {
  if (!isRecord(response) || !Array.isArray(response.pages)) {
    return contractError('ответ period без массива pages')
  }
  if (response.pages.length !== 1) {
    return contractError(
      `single-date запрос обязан дать ровно одну страницу, получено ${response.pages.length}`,
    )
  }
  const page: unknown = response.pages[0]
  if (!isRecord(page)) return contractError('страница period — не объект')

  const businessDate = page.business_date
  if (typeof businessDate !== 'string' || !isIsoDate(businessDate)) {
    return contractError('business_date страницы не ISO-дата')
  }
  if (requestedDate !== undefined && businessDate !== requestedDate) {
    return contractError(
      `business_date страницы (${businessDate}) не совпадает с запрошенной датой (${requestedDate})`,
    )
  }

  if (!Array.isArray(page.rows)) {
    return contractError('rows страницы — не массив')
  }
  const rows: PrintRowVM[] = []
  const seenDivisionIds = new Set<string>()
  for (const raw of page.rows) {
    if (!isRecord(raw)) return contractError('строка rows — не объект')
    const cells = buildCells(raw.columns, raw.attached)
    if (
      typeof raw.division_id !== 'string' ||
      typeof raw.name !== 'string' ||
      !isCount(raw.staff_total) ||
      !isCount(raw.list_total) ||
      !isCount(raw.vacancies) ||
      cells === null
    ) {
      return contractError('строка rows не соответствует контракту derive')
    }
    // Дубликат division_id — дрейф (derive строит строки из set'а поддерева,
    // дубль невозможен штатно) и сломанные React-key (ревью 10.7 BH#6/ECH#8).
    if (seenDivisionIds.has(raw.division_id)) {
      return contractError('дубликат division_id в rows')
    }
    seenDivisionIds.add(raw.division_id)
    rows.push({
      key: raw.division_id,
      name: raw.name,
      staffTotal: raw.staff_total,
      listTotal: raw.list_total,
      vacancies: raw.vacancies,
      cells,
    })
  }

  // ИТОГО — ЛИТЕРАЛЬНО из totals ответа (числа документа = derive, фронт не
  // считает — урок ретро E5 №2, зеркало канона 6.3). Никаких Σ строк.
  const totalsRaw = page.totals
  if (!isRecord(totalsRaw)) return contractError('totals страницы — не объект')
  const totalsCells = buildCells(totalsRaw.columns, totalsRaw.attached)
  if (
    !isCount(totalsRaw.staff_total) ||
    !isCount(totalsRaw.list_total) ||
    !isCount(totalsRaw.vacancies) ||
    totalsCells === null
  ) {
    return contractError('totals не соответствуют контракту derive')
  }

  // Имя подразделения — строка поддерева с division_id == query-параметр;
  // корень может отсутствовать (rows = set(employees) ∪ set(staff_map),
  // strength_report.py:329) → fallback: первая строка; пустые rows → без
  // имени + экранная пометка (имя НЕ выдумывается).
  const rootRow =
    rows.find((row) => row.key.toLowerCase() === divisionId.toLowerCase()) ??
    rows[0]
  const divisionName = rootRow?.name ?? ''
  const title = [
    divisionName,
    'ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ',
    `${formatPrintDate(businessDate)} ЖЫЛҒЫ`,
  ]
    .filter((part) => part !== '')
    .join(' ')

  return {
    kind: 'ok',
    model: {
      title,
      // Пометка честности заголовка: не только пустые rows, но и штатный
      // выход бэка name:"" (names.get(id, ""), strength_report.py) — заголовок
      // без имени обязан получить экранную пометку (ревью 10.7 ECH#5).
      divisionNameMissing: divisionName === '',
      rows,
      totals: {
        staffTotal: totalsRaw.staff_total,
        listTotal: totalsRaw.list_total,
        vacancies: totalsRaw.vacancies,
        cells: totalsCells,
      },
    },
  }
}
