// Карточка сотрудника (§20.5 EmployeeOperationalProfile — упрощённая
// проекция, идентичность+кадровая принадлежность read-only из донора).
// Оперативные Smart Josparlau поля (availability/nextAssignment/
// workloadSummary/ratingSummary) — Not started в этом срезе, но структура
// вкладок §20.15 реализована: каждая вкладка честно объясняет, ПОЧЕМУ данных
// нет (§35 запрет придумывать цифры), а не одна общая заглушка-абзац.
// Причина, ПОЧЕМУ нельзя честно вычислить доступность/назначения из уже
// существующих features/duties и features/security-events: у этих фич нет
// общего стабильного employeeId с features/personnel (разные ID-схемы,
// намеренно раздельные bounded context, см. FRONTEND_DECISIONS A44-A46/A28) —
// тот же вывод, что уже был сделан для календаря "по сотруднику".
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { useDivisions, useEmployee, usePositions, useRanks } from '../api/queries'
import { EMPLOYMENT_STATUS_LABEL } from '../model/types'

const OPERATIONAL_TABS = [
  { key: 'availability', label: 'Доступность' },
  { key: 'assignments', label: 'Назначения' },
  { key: 'clearances', label: 'Подготовка и допуски' },
  { key: 'workload', label: 'Нагрузка' },
  { key: 'rating', label: 'Рейтинг' },
  { key: 'documents', label: 'Документы' },
] as const

type OperationalTabKey = (typeof OPERATIONAL_TABS)[number]['key']

const OPERATIONAL_TAB_NOT_CONNECTED: Record<OperationalTabKey, { message: string; source: string }> = {
  availability: {
    message: 'Доступность сотрудника не подключена.',
    source:
      'Источник: Smart Josparlau. Repository доступности недоступен в этом срезе — не показываем расчётное состояние без него (§35).',
  },
  assignments: {
    message:
      'Предстоящие, активные, завершённые и отменённые назначения не подключены к карточке.',
    source:
      'Источник: features/duties и features/security-events не имеют общего стабильного employeeId с личным составом в этом демо-срезе — честнее не собирать историю по ФИО (см. A44-A46).',
  },
  clearances: {
    message: 'Сведения о подготовке и допусках пока недоступны.',
    source: 'Источник учёта допусков не подключён (§20.22).',
  },
  workload: {
    message: 'Нагрузка (плановая/фактическая, дневные/ночные часы, дежурства, ОМ) не подключена.',
    source:
      'Период и методика должны приходить от API — локальный подсчёт по загруженной странице запрещён (§20.21).',
  },
  rating: {
    message: 'Оперативный рейтинг не реализован в этом проекте.',
    source:
      'Сознательный scope cut: оценки участников/hidden-score требуют отдельной честной реализации (Epic 18.3/19, см. FRONTEND_DECISIONS A24).',
  },
  documents: {
    message: 'Документы, связанные с назначением, допуском или обучением, не подключены.',
    source: 'Карточка сотрудника не является произвольным файловым хранилищем (§20.24).',
  },
}

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const employeeQuery = useEmployee(id ?? '')
  const divisionsQuery = useDivisions()
  const positionsQuery = usePositions()
  const ranksQuery = useRanks()
  const [activeTab, setActiveTab] = useState<'summary' | OperationalTabKey>('summary')

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
          <div className="mb-3 text-sm font-semibold">Оперативный профиль (Smart Josparlau)</div>
          <div role="tablist" aria-label="Оперативный профиль" className="mb-3 flex flex-wrap gap-1 border-b">
            <TabButton tabKey="summary" activeTab={activeTab} onSelect={setActiveTab} label="Сводка" />
            {OPERATIONAL_TABS.map((tab) => (
              <TabButton key={tab.key} tabKey={tab.key} activeTab={activeTab} onSelect={setActiveTab} label={tab.label} />
            ))}
          </div>

          {activeTab === 'summary' ? (
            <div role="tabpanel" aria-label="Сводка">
              <p className="text-sm text-muted-foreground">
                Доступность, назначения, подготовка и допуски, нагрузка, рейтинг и документы —
                Not started в текущем срезе: честно не показываем без реального read model (§35).
                Причина см. на соответствующих вкладках.
              </p>
            </div>
          ) : (
            <div role="tabpanel" aria-label={OPERATIONAL_TABS.find((t) => t.key === activeTab)?.label}>
              <p className="text-sm text-muted-foreground">
                {OPERATIONAL_TAB_NOT_CONNECTED[activeTab].message}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {OPERATIONAL_TAB_NOT_CONNECTED[activeTab].source}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function TabButton({
  tabKey,
  activeTab,
  onSelect,
  label,
}: {
  tabKey: 'summary' | OperationalTabKey
  activeTab: 'summary' | OperationalTabKey
  onSelect: (tab: 'summary' | OperationalTabKey) => void
  label: string
}) {
  const isActive = activeTab === tabKey
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      className={
        isActive
          ? 'rounded-t-md border-b-2 border-primary px-2.5 py-1.5 text-xs font-semibold text-primary'
          : 'rounded-t-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground'
      }
      onClick={() => onSelect(tabKey)}
    >
      {label}
    </button>
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
