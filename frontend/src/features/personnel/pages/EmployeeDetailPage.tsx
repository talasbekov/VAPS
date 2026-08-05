// Карточка сотрудника (§20.5 EmployeeOperationalProfile — упрощённая
// проекция, идентичность+кадровая принадлежность read-only из донора).
// Оперативные Smart Josparlau поля (availability/nextAssignment/
// workloadSummary/ratingSummary) — Not started в этом срезе: честная
// секция "не подключено" вместо придуманных цифр (§35).
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { useDivisions, useEmployee, usePositions, useRanks } from '../api/queries'
import { EMPLOYMENT_STATUS_LABEL, type Employee } from '../model/types'

export function EmployeeDetailPage({
  renderExtra,
}: {
  // Story 19.4d: cross-feature composition slot — ARCH-FE-013 forbids
  // features importing each other directly (personnel ↛ status-calendar);
  // `app/` (allowed to import from any feature) supplies this render prop.
  renderExtra?: (employee: Employee) => ReactNode
}) {
  const { id } = useParams<{ id: string }>()
  const employeeQuery = useEmployee(id ?? '')
  const divisionsQuery = useDivisions()
  const positionsQuery = usePositions()
  const ranksQuery = useRanks()

  if (employeeQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка сотрудника…</p>
  }
  if (employeeQuery.isError || employeeQuery.data === undefined) {
    return (
      <div>
        <p className="text-sm text-destructive">Сотрудник не найден или недоступен.</p>
        <Link to={ROUTES.employees} className="mt-2 inline-block text-sm font-semibold text-primary">
          ← Назад к списку
        </Link>
      </div>
    )
  }

  const employee = employeeQuery.data
  const rank = ranksQuery.data?.results.find((r) => r.code === employee.rank_code)
  const position = positionsQuery.data?.results.find((p) => p.code === employee.position_code)
  const division = divisionsQuery.data?.results.find((d) => d.id === employee.division)

  return (
    <div>
      <Link to={ROUTES.employees} className="mb-3 inline-block text-xs font-semibold text-primary">
        ← Назад к списку
      </Link>

      <section className="mb-4 flex items-center gap-4 rounded-xl border bg-card p-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground">
          {employee.full_name
            .split(' ')
            .slice(0, 2)
            .map((part) => part.charAt(0))
            .join('')}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{employee.full_name}</h1>
            {employee.employment_status !== undefined && (
              <span
                className={
                  employee.employment_status === 'WORKING'
                    ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800'
                    : 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground'
                }
              >
                {EMPLOYMENT_STATUS_LABEL[employee.employment_status]}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {rank?.name ?? employee.rank_code} · {position?.name ?? employee.position_code}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Кадровая принадлежность</div>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Табельный номер" value={employee.personnel_number ?? '—'} />
            <Row label="Подразделение" value={division?.name ?? '—'} />
            <Row
              label="Дата приёма"
              value={employee.hire_date ?? '—'}
            />
            {employee.dismissal_date !== null && employee.dismissal_date !== undefined && (
              <Row label="Дата увольнения" value={employee.dismissal_date} />
            )}
          </dl>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Источник: внешний кадровый сервис, только для чтения (§20.3).
          </p>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Оперативные данные Smart Josparlau</div>
          <p className="text-sm text-muted-foreground">
            Дежурства, участие в ОМ, назначения, ознакомление и оперативный рейтинг — Not
            started в текущем срезе: честно не показываем без реального read model (§35).
          </p>
        </section>
      </div>

      {renderExtra !== undefined && <div className="mt-3.5">{renderExtra(employee)}</div>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
