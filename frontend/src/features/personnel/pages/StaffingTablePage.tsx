// Story 20.5c — единственный НОВЫЙ роут Epic 20's frontend-среза
// (`/staffing-table`, `personnel.view`): у «штатного расписания» нет
// permission-совместимого хозяина-экрана (ни одна существующая страница
// не гейтится `personnel.view` — 20.5c's Scope Decision, research-агент
// подтвердил обход всего сайта).
//
// division-picker ОПЦИОНАЛЕН (в отличие от `ExpenseReportPage.tsx`/
// `OverloadPanel.tsx`, где выбор обязателен до отправки) — дефолт
// «— весь орган —», запрос уходит СРАЗУ при монтировании без division_id
// (зеркалит AC-1 20.5b, `compute_staffing_table(date, None)`).
//
// business-date — ОДНА дата (не диапазон), структурный образец
// `ExpenseReportPage.tsx`'s picker.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../../shared/api/client'
import type { ApiFailure } from '../../../shared/api/errors'
import type { paths } from '../../../shared/api/schema'
import { Card, CardContent, CardDescription, CardHeader } from '../../../shared/ui/Card'
import { Input } from '../../../shared/ui/Input'
import { Label } from '../../../shared/ui/Label'
import { describeStaffingTableFailure, parseStaffingTable } from '../staffingTable'

type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']

const STAFFING_TABLE_PATH = '/api/core/staffing-table/'
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Канон-строки — дословно, не сочинять. */
const HEADING = 'Штатное расписание'
const CARD_DESCRIPTION = 'По штату, занято, вакансий — по должностям'
const WHOLE_ORG_OPTION = '— весь орган —'
const EMPTY_TEXT = 'Нет строк за выбранные параметры'
const READ_ERROR_TEXT = 'Не удалось загрузить штатное расписание.'

/** Сегодня в ЛОКАЛЬНОЙ зоне (тот же приём, что остальные picker-страницы). */
function todayLocalIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function StaffingTablePage() {
  const [divisionId, setDivisionId] = useState<string | null>(null)
  const [businessDate, setBusinessDate] = useState(todayLocalIso)

  const divisionsQuery = useQuery({
    queryKey: ['divisions'],
    queryFn: () => apiClient.get<DivisionsResponse>('/api/core/divisions/'),
  })
  const divisions = divisionsQuery.data?.results ?? []
  const divisionNameById: Record<string, string> = {}
  for (const division of divisions) divisionNameById[division.id] = division.name

  const dateValid = ISO_DATE_RE.test(businessDate)

  const query = useQuery<unknown, ApiFailure>({
    queryKey: ['staffing-table', divisionId, businessDate],
    queryFn: () => {
      const params = new URLSearchParams({ business_date: businessDate })
      if (divisionId !== null) params.set('division_id', divisionId)
      return apiClient.get<unknown>(`${STAFFING_TABLE_PATH}?${params.toString()}`)
    },
    enabled: dateValid,
  })

  const table = query.isSuccess ? parseStaffingTable(query.data) : null
  const failure = query.isError ? describeStaffingTableFailure(query.error) : null

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            {HEADING}
          </h1>
          <CardDescription>{CARD_DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="staffing-division-select">Подразделение</Label>
              <select
                id="staffing-division-select"
                value={divisionId ?? ''}
                disabled={divisionsQuery.isPending || divisionsQuery.isError}
                onChange={(event) =>
                  setDivisionId(event.target.value === '' ? null : event.target.value)
                }
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">{WHOLE_ORG_OPTION}</option>
                {divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="staffing-business-date">Дата</Label>
              <Input
                id="staffing-business-date"
                type="date"
                value={businessDate}
                onChange={(event) => setBusinessDate(event.target.value)}
                className="w-44"
              />
            </div>
          </div>

          {query.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Загрузка штатного расписания…
            </p>
          ) : null}

          {failure !== null && failure.kind !== 'silent' ? (
            <p role="alert" className="text-sm text-destructive">
              {READ_ERROR_TEXT} {failure.message}
            </p>
          ) : null}

          {query.isSuccess && table === null ? (
            <p role="alert" className="text-sm text-destructive">
              {READ_ERROR_TEXT}
            </p>
          ) : null}

          {table !== null ? (
            table.rows.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                {EMPTY_TEXT}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  data-testid="staffing-table-rows"
                  className="w-full min-w-[560px] text-left text-xs"
                >
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pb-1.5">Управление</th>
                      <th className="pb-1.5">Должность</th>
                      <th className="pb-1.5">По штату</th>
                      <th className="pb-1.5">Занято</th>
                      <th className="pb-1.5">Вакансий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row) => (
                      <tr
                        key={`${row.division_id}:${row.position_code}`}
                        className="border-t border-input"
                      >
                        <td className="py-1">
                          {divisionNameById[row.division_id] ?? row.division_id}
                        </td>
                        <td className="py-1">{row.position_name}</td>
                        <td className="py-1">{row.allocated}</td>
                        <td className="py-1">{row.filled}</td>
                        <td
                          className={
                            row.vacant < 0 ? 'py-1 font-semibold text-destructive' : 'py-1'
                          }
                        >
                          {row.vacant}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
