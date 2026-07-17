// Story 10.7 — печатная форма расхода /print/expense (первая реальная форма
// в печатном каркасе 8.8). Контрольная (числовая) печать секции 77 через
// Ctrl+P; официальный документ ОСТАЁТСЯ .docx с бэка (6.3/6.5) — этот роут
// его НЕ заменяет. Печатный канон (ARCH-FE-014/L255): голый семантический
// HTML + print.css, классы — только print-* строковыми литералами; UI-слой
// (shared/ui, lucide-react) на бумагу не попадает — банит eslint-блок
// print-forms. Данные — существующий read-only GET /period/ (6.10a),
// single-date запрос date_from=date_to=date; useQuery/shared/api легальны.
import './print.css'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/errors'
import type { ApiFailure } from '../../shared/api/errors'
import {
  DOCX_COLUMNS,
  DOCX_COLUMN_LABELS,
  FIXED_HEAD,
  TOTALS_LABEL,
  buildExpensePrintModel,
  isIsoDate,
  isUuid,
} from './expensePrint'

export function ExpensePrintPage() {
  const [params] = useSearchParams()
  const divisionId = params.get('division_id') ?? ''
  const date = params.get('date') ?? ''
  const paramsValid = isUuid(divisionId) && isIsoDate(date)

  const query = useQuery<unknown, ApiFailure>({
    queryKey: ['expense-print', divisionId, date],
    queryFn: () => {
      const search = new URLSearchParams({
        division_id: divisionId,
        date_from: date,
        date_to: date,
      })
      return apiClient.get<unknown>(
        `/api/operations/expense-reports/period/?${search.toString()}`,
      )
    },
    // Битые параметры → запрос НЕ уходит (AC-4); канон L472: без авто-ретраев.
    enabled: paramsValid,
    retry: false,
    // Ctrl+P гарантированно теряет/возвращает фокус окна: дефолтный
    // фон-рефетч мог бы подменить готовую таблицу ошибкой (isError при
    // упавшем рефетче) или МОЛЧА обновить числа между просмотром и печатью
    // (ревью 10.7 BH#1/ECH#9). Свежесть — перезагрузкой страницы.
    refetchOnWindowFocus: false,
  })

  if (!paramsValid) {
    return (
      <main className="print-root">
        <p className="print-screen-hint">
          Неверные или отсутствующие параметры печати. Ожидается
          /print/expense?division_id=&lt;uuid&gt;&amp;date=&lt;ГГГГ-ММ-ДД&gt;
          — откройте форму по ссылке «Контрольная печать» с экрана «Отчёты».
        </p>
      </main>
    )
  }

  if (query.isPending) {
    return (
      <main className="print-root">
        <p className="print-screen-hint">Загрузка данных расхода…</p>
      </main>
    )
  }

  if (query.isError) {
    // Message бэка для доменных ошибок (400 будущая дата / 403 / 404 / 422
    // REPORT_NO_DATA_FOR_DATE — raise-сайты views.py/expense_read_service.py);
    // сеть/прочее — честный generic. Таблица НЕ рендерится (AC-4).
    const message =
      query.error instanceof ApiError
        ? query.error.message
        : 'Сеть недоступна — данные расхода не получены.'
    return (
      <main className="print-root">
        <p className="print-screen-hint">
          Не удалось получить данные: {message} Обновите страницу после
          устранения причины.
        </p>
      </main>
    )
  }

  const parsed = buildExpensePrintModel(query.data, divisionId, date)
  if (parsed.kind === 'contract-error') {
    // STOP на дрейфе shape (AC-5): молчаливые нули/частичная таблица запрещены.
    return (
      <main className="print-root">
        <p className="print-screen-hint">
          Ошибка контракта данных: {parsed.reason}. Печать невозможна —
          обратитесь к администратору.
        </p>
      </main>
    )
  }

  const { model } = parsed
  return (
    <main className="print-root">
      <p className="print-screen-hint">
        Контрольная печать — Ctrl+P; ориентацию (альбомная) выберите в диалоге
        печати. Печать доступна только за даты не позже сегодняшней; на
        будущую дату используйте выпущенный .docx.
      </p>
      {model.divisionNameMissing && (
        <p className="print-screen-hint">
          Имя подразделения не получено (нет строк или пустое имя) — заголовок
          выведен без имени.
        </p>
      )}
      <header>
        <h1>{model.title}</h1>
      </header>
      <table>
        <thead>
          <tr>
            {FIXED_HEAD.map((label) => (
              <th key={label}>{label}</th>
            ))}
            {DOCX_COLUMNS.map((key) => (
              <th key={key}>{DOCX_COLUMN_LABELS[key]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, index) => (
            <tr key={row.key}>
              <td>{index + 1}</td>
              <td>{row.name}</td>
              <td>{row.staffTotal}</td>
              <td>{row.listTotal}</td>
              <td>{row.vacancies}</td>
              {row.cells.map((cell, cellIndex) => (
                <td key={DOCX_COLUMNS[cellIndex]}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {/* ИТОГО — литерально из totals ответа (жирность задаёт print.css) */}
          <tr>
            <td />
            <td>{TOTALS_LABEL}</td>
            <td>{model.totals.staffTotal}</td>
            <td>{model.totals.listTotal}</td>
            <td>{model.totals.vacancies}</td>
            {model.totals.cells.map((cell, cellIndex) => (
              <td key={DOCX_COLUMNS[cellIndex]}>{cell}</td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="print-note">
        Контрольная печать (HTML) — не официальный документ; официальный
        расход — .docx с Исх.№ (выпуск на экране «Отчёты»).
      </p>
    </main>
  )
}
