// Story 10.5e — read-only расход за период (`GET .../expense-reports/
// period/`, 6.10a, типизировано этой стори): страница-на-дату, без выпуска
// и без номера. Division-scoped, отложенный запрос по клику «Показать» —
// НЕ автозапрос на каждое изменение поля даты (наполовину введённая дата
// дала бы штатный 400, а не переходный UX-шум).
//
// Чего здесь осознанно НЕТ:
// - `rows` (детализация по дочерним подразделениям) — экран показывает
//   ТОЛЬКО `totals` (динамика ПО ВЫБРАННОМУ подразделению за диапазон дат);
//   per-division обзор ЗА ОДНУ дату уже есть на дереве `/organization` (10.4).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import { Button } from '../../shared/ui/Button'
import { Card, CardContent, CardHeader } from '../../shared/ui/Card'
import { Input } from '../../shared/ui/Input'
import { Label } from '../../shared/ui/Label'
import { describeExpensePeriodFailure, parseExpensePeriod } from './expense'

export interface ExpensePeriodPanelProps {
  divisionId: string
}

const HEADING = 'Чтение за период'
const SHOW_LABEL = 'Показать'

export function ExpensePeriodPanel({ divisionId }: ExpensePeriodPanelProps) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const periodQuery = useQuery<unknown, ApiFailure>({
    queryKey: ['expense-period', divisionId, dateFrom, dateTo],
    queryFn: () =>
      apiClient.get<unknown>(
        `/api/operations/expense-reports/period/?division_id=${encodeURIComponent(
          divisionId,
        )}&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`,
      ),
    // Отложенный запрос: НЕ уходит на маунте/на смену полей — только по
    // явному клику «Показать» (handleShow вызывает refetch()).
    enabled: false,
  })

  const pages = parseExpensePeriod(periodQuery.data)
  const failure =
    periodQuery.error === null ? null : describeExpensePeriodFailure(periodQuery.error)

  function handleShow() {
    if (dateFrom === '' || dateTo === '') return
    void periodQuery.refetch()
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold leading-none tracking-tight">{HEADING}</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="period-date-from">С</Label>
            <Input
              id="period-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-44"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="period-date-to">По</Label>
            <Input
              id="period-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-44"
            />
          </div>
          <Button type="button" size="sm" onClick={handleShow}>
            {SHOW_LABEL}
          </Button>
        </div>

        {periodQuery.isFetching ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка периода…
          </p>
        ) : null}

        {failure !== null && failure.kind !== 'silent' ? (
          <p role="alert" className="text-sm text-destructive">
            {failure.message}
          </p>
        ) : null}

        {!periodQuery.isFetching && pages.length > 0 ? (
          <table data-testid="expense-period-table" className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th>Дата</th>
                <th>По штату</th>
                <th>По списку</th>
                <th>Вакансии</th>
                <th>Прикоманд.</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.business_date}>
                  <td>{page.business_date}</td>
                  <td>{page.totals.staff_total}</td>
                  <td>{page.totals.list_total}</td>
                  <td>{page.totals.vacancies}</td>
                  <td>{page.totals.attached}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </CardContent>
    </Card>
  )
}
