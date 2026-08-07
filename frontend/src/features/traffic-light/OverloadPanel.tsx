// Story 20.3c — дашборд перегрузки на `/organization`, ПОД существующим
// деревом (`TrafficLightTreePage.tsx`, НЕ трогается этой стори). Тот же
// гейт `status.view`, что у нового эндпоинта (permission-совпадение с
// роутом — доп. `RequirePermission` не нужен).
//
// Самодостаточный блок: свой division-picker + date-range picker
// (структурный образец `ExpenseReportPage.tsx:448-506`, дата УДВОЕНА на
// `dateFrom`/`dateTo` — эндпоинт 20.3b требует ОБА). Employee-имена —
// структурный образец `DailyUpdatePage.tsx`'s пагинации `next`.
//
// Чего здесь осознанно НЕТ (Out of Scope стори):
// - контрола `threshold_hours` — дефолт бэкенда (8), держатель другого
//   порога не идентифицирован по контракту;
// - roll-up-счётчика на дереве — дерево не меняется;
// - remount-`key` на панели — ревью 20.2c нашло и исправило ту же ошибку
//   (лишний loading-флеш), `queryKey` уже рефетчит без ремонта.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import type { paths } from '../../shared/api/schema'
import { Card, CardContent, CardDescription, CardHeader } from '../../shared/ui/Card'
import { Input } from '../../shared/ui/Input'
import { Label } from '../../shared/ui/Label'
import { daysWord, describeOverloadFailure, parseOverloadSummary } from './overload'

type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']
type EmployeesResponse =
  paths['/api/core/employees/']['get']['responses']['200']['content']['application/json']

const OVERLOAD_PATH = '/api/operations/load/summary/'
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Бэкенд игнорирует `page_size` (нет `page_size_query_param` у
 * `DefaultPagination`, `Backend/VAPS/apps/core/api/views.py`) — реальный
 * размер страницы 50, не запрошенные 100. Параметр оставлен явным (не
 * молчаливо опущен), но лимит ниже посчитан от РЕАЛЬНОГО размера. */
const EMPLOYEES_PAGE_SIZE = 100
/** Cap против бесконечной дочитки на битом `next` (тот же класс защиты, что
 * `DailyUpdatePage.tsx`'s `truncated`-гард — здесь без видимого сообщения,
 * т.к. усечённые имена деградируют к UUID, не к потере строк перегрузки).
 * 50 страниц × реальные 50/страницу (см. выше) = 2500 сотрудников — с
 * запасом для любого реального управления в этой предметной области. */
const EMPLOYEES_MAX_PAGES = 50

/** Канон-строки — дословно, не сочинять. */
const HEADING = 'Перегрузка'
const CARD_DESCRIPTION = 'Кто был перегружен за выбранный период'
const NO_OVERLOAD_TEXT = 'Перегруженных нет за выбранный период'
const RANGE_INVALID_TEXT = 'Дата начала позже даты окончания.'
const READ_ERROR_TEXT = 'Не удалось загрузить дашборд перегрузки.'

/** Сегодня в ЛОКАЛЬНОЙ зоне (тот же приём, что `TrafficLightTreePage.tsx`). */
function todayLocalIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** UTC-математика дат (тот же приём, что `DailyUpdatePage.tsx`'s `addDaysIso`). */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function toSameOriginPath(next: string): string {
  const url = new URL(next, window.location.origin)
  return `${url.pathname}${url.search}`
}

async function fetchDivisionEmployeeNames(
  divisionId: string,
): Promise<Record<string, string>> {
  let path = `/api/core/employees/?division_id=${encodeURIComponent(divisionId)}&page_size=${EMPLOYEES_PAGE_SIZE}`
  const names: Record<string, string> = {}
  for (let page = 0; page < EMPLOYEES_MAX_PAGES; page += 1) {
    const response = await apiClient.get<EmployeesResponse>(path)
    for (const employee of response.results) {
      names[employee.id] = employee.full_name
    }
    if (!response.next || response.results.length === 0) break
    path = toSameOriginPath(response.next)
  }
  return names
}

export function OverloadPanel() {
  const [divisionId, setDivisionId] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState(() => addDaysIso(todayLocalIso(), -6))
  const [dateTo, setDateTo] = useState(todayLocalIso)

  const divisionsQuery = useQuery({
    queryKey: ['divisions'],
    queryFn: () => apiClient.get<DivisionsResponse>('/api/core/divisions/'),
  })
  const divisions = divisionsQuery.data?.results ?? []

  const datesValid = ISO_DATE_RE.test(dateFrom) && ISO_DATE_RE.test(dateTo)
  const rangeValid = datesValid && dateFrom <= dateTo
  const canQuery = divisionId !== null && rangeValid

  const namesQuery = useQuery({
    queryKey: ['overload-employee-names', divisionId],
    queryFn: () => fetchDivisionEmployeeNames(divisionId as string),
    enabled: divisionId !== null,
  })

  const overloadQuery = useQuery<unknown, ApiFailure>({
    queryKey: ['overload-summary', divisionId, dateFrom, dateTo],
    queryFn: () =>
      apiClient.get<unknown>(
        `${OVERLOAD_PATH}?division_id=${encodeURIComponent(divisionId as string)}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
      ),
    enabled: canQuery,
  })

  const summary = overloadQuery.isSuccess ? parseOverloadSummary(overloadQuery.data) : null
  const failure = overloadQuery.isError
    ? describeOverloadFailure(overloadQuery.error)
    : null
  const employeeNames = namesQuery.data ?? {}

  const overloaded = summary === null
    ? []
    : summary.employees.filter((employee) => employee.overload_days.length > 0)

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
            <Label htmlFor="overload-division-select">Подразделение</Label>
            <select
              id="overload-division-select"
              value={divisionId ?? ''}
              disabled={divisionsQuery.isPending || divisionsQuery.isError}
              onChange={(event) =>
                setDivisionId(event.target.value === '' ? null : event.target.value)
              }
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">— выберите —</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="overload-date-from">С</Label>
            <Input
              id="overload-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-44"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="overload-date-to">По</Label>
            <Input
              id="overload-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-44"
            />
          </div>
        </div>

        {datesValid && !rangeValid ? (
          <p role="alert" className="text-sm text-destructive">
            {RANGE_INVALID_TEXT}
          </p>
        ) : null}

        {canQuery && overloadQuery.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка дашборда перегрузки…
          </p>
        ) : null}

        {failure !== null && failure.kind !== 'silent' ? (
          <p role="alert" className="text-sm text-destructive">
            {READ_ERROR_TEXT} {failure.message}
          </p>
        ) : null}

        {overloadQuery.isSuccess && summary === null ? (
          <p role="alert" className="text-sm text-destructive">
            {READ_ERROR_TEXT}
          </p>
        ) : null}

        {summary !== null ? (
          overloaded.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {NO_OVERLOAD_TEXT}
            </p>
          ) : (
            <ul data-testid="overload-employees" className="flex flex-col gap-1">
              {overloaded.map((employee) => (
                <li
                  key={employee.employee_id}
                  className="rounded-md border border-input p-2 text-sm text-destructive"
                >
                  {employeeNames[employee.employee_id] ?? employee.employee_id}
                  {' — '}
                  {employee.overload_days.length}{' '}
                  {daysWord(employee.overload_days.length)}{' '}
                  перегрузки ({employee.overload_days.join(', ')})
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </Card>
  )
}
