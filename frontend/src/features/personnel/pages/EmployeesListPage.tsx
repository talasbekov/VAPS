// Сотрудники (мастер-промпт §20.2): переименовано с «Кадровый фундамент /
// Сотрудники и штат» на «Личный состав / Сотрудники» — оперативный
// read-only профиль, НЕ кадровая система. §20.2 удалено относительно
// прототипа: полный ИИН из таблицы, интерактивный Select статуса, кнопка
// «Редактировать», кадровые операции/ставки/вакансии, локальный рейтинг,
// частота найма как сортировка — источника для них нет и придумывать
// запрещено (§35). Поиск/фильтр — в URL (переживает переход между
// страницами, как в security-events).
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { Input } from '../../../shared/ui/Input'
import { useDivisions, useEmployees, usePositions, useRanks } from '../api/queries'
import { EMPLOYMENT_STATUS_LABEL } from '../model/types'
import type { Division, Employee, Position, Rank } from '../model/types'

function maskIin(iin: string): string {
  return iin.length <= 4 ? iin : `••••••••${iin.slice(-4)}`
}

function byCode<T extends { code: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.code, item]))
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

export function EmployeesListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const divisionId = searchParams.get('division') ?? ''

  const employeesQuery = useEmployees()
  const divisionsQuery = useDivisions()
  const positionsQuery = usePositions()
  const ranksQuery = useRanks()

  const isLoading =
    employeesQuery.isLoading ||
    divisionsQuery.isLoading ||
    positionsQuery.isLoading ||
    ranksQuery.isLoading
  const isError =
    employeesQuery.isError || divisionsQuery.isError || positionsQuery.isError || ranksQuery.isError

  const divisionsById = useMemo(
    () => byId<Division>(divisionsQuery.data?.results ?? []),
    [divisionsQuery.data],
  )
  const positionsByCode = useMemo(
    () => byCode<Position>(positionsQuery.data?.results ?? []),
    [positionsQuery.data],
  )
  const ranksByCode = useMemo(() => byCode<Rank>(ranksQuery.data?.results ?? []), [ranksQuery.data])

  const filtered = useMemo(() => {
    const all = employeesQuery.data?.results ?? []
    const query = search.trim().toLowerCase()
    return all.filter((employee) => {
      if (divisionId !== '' && employee.division !== divisionId) return false
      if (query === '') return true
      const division = divisionsById.get(employee.division)
      const position = positionsByCode.get(employee.position_code)
      const haystack = `${employee.full_name} ${position?.name ?? ''} ${division?.name ?? ''}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [employeesQuery.data, search, divisionId, divisionsById, positionsByCode])

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams)
    if (value === '') {
      next.delete(key)
    } else {
      next.set(key, value)
    }
    setSearchParams(next)
  }

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Личный состав
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Сотрудники</h1>
        <span className="text-sm text-muted-foreground">
          Оперативная доступность, назначения и служебная нагрузка сотрудников
        </span>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="min-w-56 flex-1"
          placeholder="Поиск по ФИО, должности, подразделению…"
          value={search}
          onChange={(e) => updateParam('search', e.target.value)}
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Подразделение"
          value={divisionId}
          onChange={(e) => updateParam('division', e.target.value)}
        >
          <option value="">Все подразделения</option>
          {(divisionsQuery.data?.results ?? []).map((division) => (
            <option key={division.id} value={division.id}>
              {division.name}
            </option>
          ))}
        </select>
      </div>

      <ResultsTable
        isLoading={isLoading}
        isError={isError}
        employees={filtered}
        divisionsById={divisionsById}
        positionsByCode={positionsByCode}
        ranksByCode={ranksByCode}
      />
    </div>
  )
}

function ResultsTable({
  isLoading,
  isError,
  employees,
  divisionsById,
  positionsByCode,
  ranksByCode,
}: {
  isLoading: boolean
  isError: boolean
  employees: Employee[]
  divisionsById: Map<string, Division>
  positionsByCode: Map<string, Position>
  ranksByCode: Map<string, Rank>
}) {
  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Загрузка личного состава…
      </section>
    )
  }
  if (isError) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-destructive">
        Не удалось загрузить личный состав. Попробуйте обновить страницу.
      </section>
    )
  }
  if (employees.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Сотрудники не найдены
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-muted/40">
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">ФИО</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Должность</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Подразделение</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Статус</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => {
            const rank = ranksByCode.get(employee.rank_code)
            const position = positionsByCode.get(employee.position_code)
            const division = divisionsById.get(employee.division)
            return (
              <tr key={employee.id} className="border-t hover:bg-muted/30">
                <td className="p-3.5 text-sm">
                  <Link to={ROUTES.employeeDetailTo(employee.id)} className="block">
                    <span className="block font-semibold text-foreground">
                      {employee.full_name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {rank?.name ?? employee.rank_code} · ИИН {maskIin(employee.iin)}
                    </span>
                  </Link>
                </td>
                <td className="p-3.5 text-sm">{position?.name ?? employee.position_code}</td>
                <td className="p-3.5 text-sm">{division?.name ?? '—'}</td>
                <td className="p-3.5">
                  <span
                    className={
                      employee.employment_status === 'WORKING'
                        ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800'
                        : 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-slate-600'
                    }
                  >
                    {employee.employment_status !== undefined
                      ? EMPLOYMENT_STATUS_LABEL[employee.employment_status]
                      : '—'}
                  </span>
                </td>
                <td className="p-3.5 text-center text-muted-foreground">
                  <Link to={ROUTES.employeeDetailTo(employee.id)}>›</Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
