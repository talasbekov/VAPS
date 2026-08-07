// Story 20.6c — третья самодостаточная секция `/organization`, ПОСЛЕ
// `OverloadPanel` (20.3c, НЕ трогается этой стори). Тот же гейт
// `status.view`, что у роута и у эндпоинта.
//
// division-picker ОПЦИОНАЛЕН (образец `StaffingTablePage.tsx`, 20.5c) —
// дефолт «— весь орган —», запрос уходит СРАЗУ при монтировании (зеркалит
// AC-1 20.6b). business-date — ОДНА дата (не диапазон).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import type { paths } from '../../shared/api/schema'
import { Card, CardContent, CardDescription, CardHeader } from '../../shared/ui/Card'
import { Input } from '../../shared/ui/Input'
import { Label } from '../../shared/ui/Label'
import {
  REPORT_COLUMN_LABELS,
  describeStatusSummaryFailure,
  parseStatusSummary,
} from './statusSummary'

type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']

const STATUS_SUMMARY_PATH = '/api/operations/statuses/summary/'
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Канон-строки — дословно, не сочинять. */
const HEADING = 'Сводка по статусам'
const CARD_DESCRIPTION = 'По штату, списку, вакансиям и 11 отчётным колонкам'
const WHOLE_ORG_OPTION = '— весь орган —'
const READ_ERROR_TEXT = 'Не удалось загрузить сводку по статусам.'

/** Сегодня в ЛОКАЛЬНОЙ зоне (тот же приём, что остальные picker-панели). */
function todayLocalIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function StatusSummaryPanel() {
  const [divisionId, setDivisionId] = useState<string | null>(null)
  const [businessDate, setBusinessDate] = useState(todayLocalIso)

  const divisionsQuery = useQuery({
    queryKey: ['divisions'],
    queryFn: () => apiClient.get<DivisionsResponse>('/api/core/divisions/'),
  })
  const divisions = divisionsQuery.data?.results ?? []

  const dateValid = ISO_DATE_RE.test(businessDate)

  const query = useQuery<unknown, ApiFailure>({
    queryKey: ['status-summary', divisionId, businessDate],
    queryFn: () => {
      const params = new URLSearchParams({ business_date: businessDate })
      if (divisionId !== null) params.set('division_id', divisionId)
      return apiClient.get<unknown>(`${STATUS_SUMMARY_PATH}?${params.toString()}`)
    },
    enabled: dateValid,
  })

  const summary = query.isSuccess ? parseStatusSummary(query.data) : null
  const failure = query.isError ? describeStatusSummaryFailure(query.error) : null

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold leading-none tracking-tight">
          {HEADING}
        </h2>
        <CardDescription>{CARD_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="status-summary-division-select">Подразделение</Label>
            <select
              id="status-summary-division-select"
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
            <Label htmlFor="status-summary-business-date">Дата</Label>
            <Input
              id="status-summary-business-date"
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
              className="w-44"
            />
          </div>
        </div>

        {query.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка сводки по статусам…
          </p>
        ) : null}

        {failure !== null && failure.kind !== 'silent' ? (
          <p role="alert" className="text-sm text-destructive">
            {READ_ERROR_TEXT} {failure.message}
          </p>
        ) : null}

        {query.isSuccess && summary === null ? (
          <p role="alert" className="text-sm text-destructive">
            {READ_ERROR_TEXT}
          </p>
        ) : null}

        {summary !== null ? (
          <>
            <div className="grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-4">
              <div className="rounded-md border border-input p-2">
                <div className="text-xs text-muted-foreground">По штату</div>
                <div className="font-semibold">{summary.staffTotal}</div>
              </div>
              <div className="rounded-md border border-input p-2">
                <div className="text-xs text-muted-foreground">По списку</div>
                <div className="font-semibold">{summary.listTotal}</div>
              </div>
              <div className="rounded-md border border-input p-2">
                <div className="text-xs text-muted-foreground">Вакансии</div>
                <div className="font-semibold">{summary.vacancies}</div>
              </div>
              <div className="rounded-md border border-input p-2">
                <div className="text-xs text-muted-foreground">Прикомандировано</div>
                <div className="font-semibold">{summary.attached}</div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table
                data-testid="status-summary-columns"
                className="w-full min-w-[560px] text-left text-xs"
              >
                <thead>
                  <tr className="text-muted-foreground">
                    {REPORT_COLUMN_LABELS.map((column) => (
                      <th key={column.code} className="pb-1.5">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-input">
                    {REPORT_COLUMN_LABELS.map((column) => (
                      <td key={column.code} className="py-1">
                        {summary.columns[column.code] ?? 0}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
