// Story 10.5c — журнал выпусков подразделения (`GET .../expense-reports/
// journal/`, 10.5b): ВСЕ документы (ISSUED и SUPERSEDED), цепочка «взамен
// исх.№ N/YYYY».
//
// Division-scoped, НЕ date-scoped (AC-1): собственный `useQuery` с ключом
// `['expense-journal', divisionId]`, монтируется с `key={divisionId}`
// ОТДЕЛЬНО от `ExpenseReportPanel`'s `key={divisionId}-{businessDate}` —
// смена даты НЕ должна перезапрашивать журнал (роут его вовсе не принимает).
//
// Чего здесь осознанно НЕТ:
// - UI-пагинации (AC-5): читается ПЕРВАЯ страница (дефолт бэка limit=50);
//   при `hasMore` — честный текст «последние N из count», без кнопки
//   «Показать ещё»/infinite scroll. Реальные подразделения не превысят 50
//   выпусков в первые месяцы — полноценная пагинация UI ждёт спроса.
// - независимость от карточки выпуска (AC-4): журнал — обогащение, не
//   первичный сигнал (тот же принцип, что серверный drift 10.3b); ошибка
//   журнала не блокирует ExpenseReportPanel.
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import { Card, CardContent, CardHeader } from '../../shared/ui/Card'
import { STATUS_LABELS, parseExpenseJournal } from './expense'

export interface ExpenseJournalPanelProps {
  divisionId: string
}

const JOURNAL_HEADING = 'Журнал выпусков'
const EMPTY_TEXT = 'Выпусков ещё не было'
const READ_ERROR_TEXT = 'Не удалось загрузить журнал выпусков.'

export function ExpenseJournalPanel({ divisionId }: ExpenseJournalPanelProps) {
  const journalQuery = useQuery<unknown, ApiFailure>({
    queryKey: ['expense-journal', divisionId],
    queryFn: () =>
      apiClient.get<unknown>(
        `/api/operations/expense-reports/journal/?division_id=${encodeURIComponent(divisionId)}`,
      ),
  })

  const page = parseExpenseJournal(journalQuery.data)

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold leading-none tracking-tight">
          {JOURNAL_HEADING}
        </h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {journalQuery.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка журнала…
          </p>
        ) : null}

        {/* AC-4: 5xx/сеть молчат (уже в тосте useApiMutation-эквивалента
            useQuery не проходит, но журнал — обогащение, не первичный
            сигнал — дубль сообщения хуже тишины); 403/404 — конкретный текст. */}
        {journalQuery.isError &&
        (journalQuery.error.kind === 'network' || journalQuery.error.status >= 500) ? null : journalQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {READ_ERROR_TEXT}
          </p>
        ) : null}

        {!journalQuery.isLoading && !journalQuery.isError && page.results.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {EMPTY_TEXT}
          </p>
        ) : null}

        {page.results.length > 0 ? (
          <ul data-testid="expense-journal-list" className="flex flex-col gap-2">
            {page.results.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-col gap-1 rounded-md border border-input p-2 text-sm"
              >
                <span className="font-medium">
                  Исх.№ {doc.number}/{doc.year} · {doc.business_date} ·{' '}
                  {STATUS_LABELS[doc.status]}
                </span>
                {doc.supersedes_number !== null ? (
                  <span className="text-muted-foreground">
                    взамен исх.№ {doc.supersedes_number}/{doc.supersedes_year}
                  </span>
                ) : null}
                {doc.reason !== '' ? (
                  <span className="text-muted-foreground">{doc.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Ревью-фикс: условие — НЕ только `hasMore` (страниц больше одной).
            Мусорный элемент внутри ПОСЛЕДНЕЙ страницы (`parseIssuedReport`
            отбросил его) даёт `results.length < count` при `hasMore: false` —
            без второй половины условия строка молча пропала бы, а вместе с
            ней и единственный сигнал, что что-то не показано (AC-5). */}
        {page.hasMore || page.results.length < page.count ? (
          <p className="text-sm text-muted-foreground">
            Показаны последние {page.results.length} из {page.count}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
