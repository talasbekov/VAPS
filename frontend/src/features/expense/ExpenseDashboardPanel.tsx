// Story 20.2c — org-wide дашборд расхода + отстающие управления С ИМЕНАМИ
// (`GET .../expense-reports/dashboard/`, 20.2b). Закрывает деферред-пункт
// №5 шапки `ExpenseReportPage.tsx`: донор-макет предвидел эту работу
// («отв.: кап. Дамир», per-лист светофора — контракт Q4/Q7), но `laggards`
// тогда были org-wide UUID БЕЗ имён (`tomorrow_gate.py:31-32`). 20.2b's
// эндпоинт разрешает имена — эта панель наконец их показывает.
//
// Org-wide, БЕЗ division-скоупа (в отличие от ExpenseJournalPanel/
// ExpensePeriodPanel) — рендерится СРАЗУ, до выбора управления. Читает
// ТОЛЬКО page-level `businessDate` (проп), не заводит свою дату.
//
// Чего здесь осознанно НЕТ: кнопки «Напомнить»/назначения ответственного
// (контракт §5.2 не открыт этой стори); детализации `violations`/`warnings`
// (данные не теряются, просто не рендерятся — будущий UI-элемент при
// явном запросе).
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import { Card, CardContent, CardHeader } from '../../shared/ui/Card'
import { describeExpenseDashboardFailure, parseExpenseDashboard } from './expense'

export interface ExpenseDashboardPanelProps {
  businessDate: string
}

const HEADING = 'Дашборд расхода'
const ALL_SUBMITTED_TEXT = 'Все управления сдали'
const READ_ERROR_TEXT = 'Не удалось загрузить дашборд расхода.'

export function ExpenseDashboardPanel({ businessDate }: ExpenseDashboardPanelProps) {
  const query = useQuery<unknown, ApiFailure>({
    queryKey: ['expense-dashboard', businessDate],
    queryFn: () =>
      apiClient.get<unknown>(
        `/api/operations/expense-reports/dashboard/?business_date=${encodeURIComponent(businessDate)}`,
      ),
  })

  const dashboard = query.isSuccess ? parseExpenseDashboard(query.data) : null
  const failure = query.isError ? describeExpenseDashboardFailure(query.error) : null

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold leading-none tracking-tight">
          {HEADING}
        </h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка дашборда…
          </p>
        ) : null}

        {failure !== null && failure.kind !== 'silent' ? (
          <p role="alert" className="text-sm text-destructive">
            {READ_ERROR_TEXT} {failure.message}
          </p>
        ) : null}

        {query.isSuccess && dashboard === null ? (
          <p role="alert" className="text-sm text-destructive">
            {READ_ERROR_TEXT}
          </p>
        ) : null}

        {dashboard !== null ? (
          <>
            <div className="grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-4">
              <div className="rounded-md border border-input p-2">
                <div className="text-xs text-muted-foreground">По штату</div>
                <div className="font-semibold">{dashboard.totals.staffTotal}</div>
              </div>
              <div className="rounded-md border border-input p-2">
                <div className="text-xs text-muted-foreground">По списку</div>
                <div className="font-semibold">{dashboard.totals.listTotal}</div>
              </div>
              <div className="rounded-md border border-input p-2">
                <div className="text-xs text-muted-foreground">Вакансии</div>
                <div className="font-semibold">{dashboard.totals.vacancies}</div>
              </div>
              <div className="rounded-md border border-input p-2">
                <div className="text-xs text-muted-foreground">Прикомандировано</div>
                <div className="font-semibold">{dashboard.totals.attached}</div>
              </div>
            </div>

            <div>
              <h3 className="mb-1.5 text-sm font-medium">Отстающие управления</h3>
              {dashboard.laggards.length === 0 ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {ALL_SUBMITTED_TEXT}
                </p>
              ) : (
                <ul data-testid="expense-dashboard-laggards" className="flex flex-col gap-1">
                  {dashboard.laggards.map((laggard) => (
                    <li
                      key={laggard.division_id}
                      className="rounded-md border border-input p-2 text-sm text-destructive"
                    >
                      {laggard.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {dashboard.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table
                  data-testid="expense-dashboard-rows"
                  className="w-full min-w-[480px] text-left text-xs"
                >
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pb-1.5">Управление</th>
                      <th className="pb-1.5">По штату</th>
                      <th className="pb-1.5">По списку</th>
                      <th className="pb-1.5">Вакансии</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.rows.map((row) => (
                      <tr key={row.division_id} className="border-t border-input">
                        <td className="py-1">{row.name}</td>
                        <td className="py-1">{row.staff_total}</td>
                        <td className="py-1">{row.list_total}</td>
                        <td className="py-1">{row.vacancies}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
