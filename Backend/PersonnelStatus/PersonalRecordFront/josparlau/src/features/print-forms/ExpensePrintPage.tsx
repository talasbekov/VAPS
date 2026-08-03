// Стори 10.7 — печатная форма расхода (`/print/expense`), КОНТРОЛЬНАЯ копия
// официального документа. Официальным документом остаётся .docx с бэка
// (генератор 6.3); эта страница зеркалит его вёрстку, чтобы контрольная печать
// занимала секунды и не зависела от выпуска.
//
// Печатный канон 8.8 (ARCH-FE-014 / architecture L255), block-scoped eslint по
// пути `src/features/print-forms/**`: голый семантический HTML + print.css,
// className — ТОЛЬКО строковые литералы `print-*`, импорты `shared/ui/*` и
// `lucide-react` запрещены. Кнопки «Печать» нет (Д6 8.8 — Ctrl+P).
//
// ⚠️ Членов ячеек (ФИО/звание/период под числом, которые .docx рисует 8pt) тут
// НЕТ: `/period/` отдаёт «numbers only, read-only», а `snapshot` в схеме
// отсутствует. Преемник — стори 10.7a (JSON-поверхность тела расхода поверх
// готового `build_expense_document`). Без неё epic-AC «вывод соответствует
// контракту» закрыт частично: числовая таблица соответствует, ячейки — без
// членов. НЕ дорисовывать это на клиенте: потребовало бы переписать
// `resolve_status` и таблицу приоритетов (прямой запрет 10.6 / 10.1b).
import { usePrintDocumentIsolation } from '../../shared/lib/usePrintDocumentIsolation'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import type { paths } from '../../shared/api/schema'
import './print.css'
import {
  ATTACHED_KEY,
  FIXED_HEAD,
  PRINT_COLUMNS,
  PRINT_COLUMN_LABELS,
  PRINT_EMPTY_MESSAGE,
  TOTALS_LABEL,
  describePrintFailure,
  expenseTitle,
  formatAttached,
  formatDocDate,
  parseExpensePage,
} from './expensePrint'
import type { PrintColumnKey } from './expensePrint'

type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']

// URL API — не маршрут портала: ARCH-FE-012 на них не распространяется.
const PERIOD_PATH = '/api/operations/expense-reports/period/'
const DIVISIONS_PATH = '/api/core/divisions/'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const LOADING_TEXT = 'Загрузка расхода…'

/**
 * Объяснение при непройденной валидации параметров (AC-2/AC-9). Заголовок
 * документа в этом состоянии НЕ рендерится: «{uuid} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ
 * ТІЗІМІ  ЖЫЛҒЫ» с дырой вместо даты — испорченный юридический артефакт.
 */
const MISSING_PARAMS_TEXT =
  'Не хватает параметров печати: нужны подразделение (division_id) и дата в формате ГГГГ-ММ-ДД (business_date).'

const SCREEN_HINT_TEXT =
  'Экранная подсказка: этот блок на бумагу не выводится. Печать — Ctrl+P; ориентацию (альбомная) выберите в диалоге печати.'

/**
 * Число ячейки. `ATTACHED` — единственный ключ, читаемый НЕ из `columns` (его
 * нет в `REPORT_COLUMNS`, он приезжает полем `attached`) и единственный, что
 * рендерится как `+N`: префикс — часть контракта документа
 * [Source: expense_docx.py#L166-169]. Отсутствующий ключ → `0`, а не пропуск
 * колонки и не падение (AC-5).
 */
function cellText(
  source: { attached: number; columns: Record<string, number> },
  key: PrintColumnKey,
): string {
  if (key === ATTACHED_KEY) return formatAttached(source.attached)
  return String(source.columns[key] ?? 0)
}

export function ExpensePrintPage() {
  usePrintDocumentIsolation()
  const [searchParams] = useSearchParams()
  const divisionId = searchParams.get('division_id') ?? ''
  const businessDate = searchParams.get('business_date') ?? ''
  // «Сегодня» по умолчанию НЕ подставляется: `todayLocalIso` — уже четвёртая
  // копия в репозитории, а ARCH-FE-013 запрещает импорт соседней фичи ⇒ пятая
  // копия ради дефолта не заводится. Дату всегда даёт вызывающий.
  const paramsValid = divisionId !== '' && ISO_DATE_RE.test(businessDate)

  /**
   * Один запрос на страницу-дату: `date_from == date_to`, потому что
   * `derive_period` отдаёт страницу на КАЖДУЮ дату диапазона.
   *
   * ⚠️ `retry: false` обязателен: `providers.tsx:34-38` гасит ретраи только у
   * МУТАЦИЙ, у `useQuery` остаётся дефолтный `retry: 3` — тест отказа висел бы
   * ~7 с и выглядел зависшим (ловушка 10.4 №1b, 10.5).
   */
  const reportQuery = useQuery<unknown, ApiFailure>({
    queryKey: ['expense-print', divisionId, businessDate],
    queryFn: () =>
      apiClient.get<unknown>(
        `${PERIOD_PATH}?division_id=${encodeURIComponent(divisionId)}&date_from=${encodeURIComponent(businessDate)}&date_to=${encodeURIComponent(businessDate)}`,
      ),
    enabled: paramsValid,
    retry: false,
  })

  const divisionsQuery = useQuery({
    queryKey: ['divisions'],
    queryFn: () => apiClient.get<DivisionsResponse>(DIVISIONS_PATH),
    // При невалидных параметрах страница не рендерит ни заголовок, ни имя —
    // справочнику нечего обслуживать, запрос не уходит (дух AC-2). Смена
    // query-параметров на валидные снимает гард без ремаунта.
    enabled: paramsValid,
  })

  // Фолбэк на сам UUID ОБЯЗАТЕЛЕН: справочник постраничный, и дивизион легально
  // может быть вне страницы 1 — рендер UUID это корректное поведение, не баг
  // (прецедент AC-6 стори 10.5).
  const divisions = divisionsQuery.data?.results ?? []
  const divisionName =
    divisions.find((division) => division.id === divisionId)?.name ?? divisionId

  if (!paramsValid) {
    return (
      <main className="print-root">
        <p className="print-screen-hint">{SCREEN_HINT_TEXT}</p>
        <p className="print-status">{MISSING_PARAMS_TEXT}</p>
      </main>
    )
  }

  const page = reportQuery.isSuccess ? parseExpensePage(reportQuery.data) : null

  return (
    <main className="print-root">
      <p className="print-screen-hint">{SCREEN_HINT_TEXT}</p>
      {/* Заголовок документа — ВНЕ лестницы загрузки данных (AC-9): дефолтный
          хендлер справочника подразделений это HttpResponse.error(), и шапка
          обязана быть видна даже при упавшем справочнике (зеркало решения
          ExpenseReportPage.tsx:290-295). */}
      <header>
        <h1>{expenseTitle({ divisionName, businessDate })}</h1>
      </header>
      <ExpenseBody page={page} query={reportQuery} />
      <p className="print-note">
        Подразделение: {divisionName}. Дата: {formatDocDate(businessDate)}.
      </p>
    </main>
  )
}

/**
 * Лестница состояний тела документа. Тоста здесь нет и быть не должно: тост —
 * UI-слой, он отрендерился бы в портал ВНЕ `.print-root` и покрасил бы DOM-скан
 * печатного канона (AC-8). Поэтому 5xx и сеть получают текст, а не тишину —
 * см. `describePrintFailure`.
 */
function ExpenseBody({
  page,
  query,
}: {
  page: ReturnType<typeof parseExpensePage>
  query: { isPending: boolean; isError: boolean; error: ApiFailure | null }
}) {
  if (query.isPending) return <p className="print-status">{LOADING_TEXT}</p>
  if (query.isError && query.error !== null) {
    const described = describePrintFailure(query.error)
    // 'silent' — 401: handle401 уже чистит credential, RequireAuth уводит на
    // /login; текст успел бы только мигнуть поверх редиректа.
    if (described.kind === 'silent') return null
    return <p className="print-status">{described.message}</p>
  }
  // 200 с телом, которое не разобрать (не-объект / pages не массив / pages: [])
  // — НЕ ошибка и НЕ пустая таблица: объясняющий текст, таблицы нет вовсе.
  if (page === null) return <p className="print-status">{PRINT_EMPTY_MESSAGE}</p>
  return <ExpenseTable page={page} />
}

function ExpenseTable({
  page,
}: {
  page: NonNullable<ReturnType<typeof parseExpensePage>>
}) {
  return (
    <table className="print-wide">
      <thead>
        <tr>
          {FIXED_HEAD.map((label) => (
            <th key={label}>{label}</th>
          ))}
          {/* Итерация ТОЛЬКО по PRINT_COLUMNS (порядок документа); порядок
              ключей `columns` в ответе — случайность сериализации (AC-0в). */}
          {PRINT_COLUMNS.map((key) => (
            <th key={key}>{PRINT_COLUMN_LABELS[key]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {page.rows.map((row, index) => (
          <tr key={`${row.name}-${index}`}>
            {/* № — ПОЗИЦИОННЫЙ (зеркало `enumerate(..., start=1)` эталона),
                не из данных: в ответе поля номера строки нет вовсе. */}
            <td className="print-num">{index + 1}</td>
            <td>{row.name}</td>
            <td className="print-num">{row.staff_total}</td>
            <td className="print-num">{row.list_total}</td>
            <td className="print-num">{row.vacancies}</td>
            {PRINT_COLUMNS.map((key) => (
              <td className="print-num" key={key}>
                {cellText(row, key)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        {/* Жирность даёт существующее правило `.print-root tfoot td`
            (print.css:136-138) — своего класса не заводим. */}
        <tr>
          <td></td>
          <td>{TOTALS_LABEL}</td>
          <td className="print-num">{page.totals.staff_total}</td>
          <td className="print-num">{page.totals.list_total}</td>
          <td className="print-num">{page.totals.vacancies}</td>
          {PRINT_COLUMNS.map((key) => (
            <td className="print-num" key={key}>
              {cellText(page.totals, key)}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  )
}
