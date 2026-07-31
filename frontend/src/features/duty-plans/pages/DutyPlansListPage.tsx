// Story 14.11j: список планов дежурств + создание. Буквальный образец —
// security-events/pages/SecurityEventsListPage.tsx (isLoading/isError/isEmpty
// -ветки, dialog-триггер). Без грида смен и approve/cancel/replan-кнопок —
// 14.11k/l.
// Story 14.11k: строки теперь Link на деталь-страницу плана (14.11j's
// комментарий "нет Link на строку, деталь-страницы ещё нет" устарел).
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ROUTES } from '../../../shared/routes'
import { useDutyPlans } from '../api/queries'
import type { DutyPlansListResponse } from '../api/queries'
import { CreateDutyPlanDialog } from './CreateDutyPlanDialog'

const MONTH_LABEL = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  APPROVED: 'Утверждён',
}

export function DutyPlansListPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const query = useDutyPlans()

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
            Служба
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Планы дежурств</h1>
          <span className="text-sm text-muted-foreground">
            Месячные планы дежурств по объектам
          </span>
        </div>
        <Button onClick={() => setDialogOpen(true)}>+ Создать план</Button>
      </header>

      <ResultsTable
        isLoading={query.isLoading}
        isError={query.isError}
        plans={query.data?.results ?? []}
        isEmpty={query.data !== undefined && query.data.results.length === 0}
      />

      <CreateDutyPlanDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}

function ResultsTable({
  isLoading,
  isError,
  plans,
  isEmpty,
}: {
  isLoading: boolean
  isError: boolean
  plans: DutyPlansListResponse['results']
  isEmpty: boolean
}) {
  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Загрузка планов…
      </section>
    )
  }
  if (isError) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-destructive">
        Не удалось загрузить планы дежурств. Попробуйте обновить страницу.
      </section>
    )
  }
  if (isEmpty) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Планы дежурств не найдены
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-muted/40">
            <Th>Объект</Th>
            <Th>Год</Th>
            <Th>Месяц</Th>
            <Th>Статус</Th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id} className="border-t hover:bg-muted/30">
              <td className="p-3.5 text-sm font-semibold text-foreground">
                <Link to={ROUTES.dutyPlanDetailTo(plan.id)} className="block">
                  {plan.object}
                </Link>
              </td>
              <td className="p-3.5 text-sm tabular-nums">{plan.year}</td>
              <td className="p-3.5 text-sm">{MONTH_LABEL[plan.month - 1] ?? plan.month}</td>
              <td className="p-3.5 text-sm">
                {STATUS_LABEL[plan.status_code] ?? plan.status_code}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Th({ children }: { children?: ReactNode }) {
  return (
    <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">{children}</th>
  )
}
