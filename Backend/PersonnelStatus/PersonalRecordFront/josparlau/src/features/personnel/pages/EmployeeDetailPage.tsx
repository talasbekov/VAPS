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
import { useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { useDivisions, usePersonnelEntry, usePositions, useRanks } from '../api/queries'
import { EMPLOYMENT_STATUS_LABEL } from '../model/types'
import { IdentitySection } from './IdentitySection'

const OPERATIONAL_TABS = [
  { key: 'availability', label: 'Доступность' },
  { key: 'assignments', label: 'Назначения' },
  { key: 'clearances', label: 'Подготовка и допуски' },
  { key: 'workload', label: 'Нагрузка' },
  { key: 'rating', label: 'Рейтинг' },
  { key: 'documents', label: 'Документы' },
] as const

type OperationalTabKey = (typeof OPERATIONAL_TABS)[number]['key']
type ProfileTabKey = 'summary' | OperationalTabKey

const PROFILE_TABS: { key: ProfileTabKey; label: string }[] = [
  { key: 'summary', label: 'Сводка' },
  ...OPERATIONAL_TABS,
]

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
  const employeeQuery = usePersonnelEntry(id ?? '')
  const divisionsQuery = useDivisions()
  const positionsQuery = usePositions()
  const ranksQuery = useRanks()
  const [activeTab, setActiveTab] = useState<ProfileTabKey>('summary')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function focusTab(index: number): void {
    const wrapped = (index + PROFILE_TABS.length) % PROFILE_TABS.length
    const tab = PROFILE_TABS[wrapped]
    setActiveTab(tab.key)
    tabRefs.current[tab.key]?.focus()
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        focusTab(index + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusTab(index - 1)
        break
      case 'Home':
        event.preventDefault()
        focusTab(0)
        break
      case 'End':
        event.preventDefault()
        focusTab(PROFILE_TABS.length - 1)
        break
    }
  }

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
  const rank = ranksQuery.data?.results.find((r) => r.code === employee.rankCode)
  const position = positionsQuery.data?.results.find((p) => p.code === employee.positionCode)
  const division = divisionsQuery.data?.results.find((d) => d.id === employee.divisionId)

  return (
    <div>
      <Link to={ROUTES.employees} className="mb-3 inline-block text-xs font-semibold text-primary">
        ← Назад к списку
      </Link>

      <section className="mb-4 flex items-center gap-4 rounded-xl border bg-card p-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground">
          {employee.fullName
            .split(' ')
            .slice(0, 2)
            .map((part) => part.charAt(0))
            .join('')}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{employee.fullName}</h1>
            <span
              className={
                employee.employmentStatus === 'WORKING'
                  ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800'
                  : 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-slate-600'
              }
            >
              {EMPLOYMENT_STATUS_LABEL[employee.employmentStatus]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {rank?.name ?? employee.rankCode} · {position?.name ?? employee.positionCode}
          </p>
        </div>
      </section>

      {/* §20.27: идентификационные данные — отдельный блок с собственным
          протоколом раскрытия, а не строка в кадровой принадлежности. */}
      <div className="mb-3.5">
        <IdentitySection employee={employee} />
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Кадровая принадлежность</div>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Табельный номер" value={employee.personnelNumber ?? '—'} />
            <Row label="Подразделение" value={division?.name ?? '—'} />
            <Row label="Дата приёма" value={employee.hireDate ?? '—'} />
            {employee.dismissalDate !== null && (
              <Row label="Дата увольнения" value={employee.dismissalDate} />
            )}
          </dl>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Источник: внешний кадровый сервис, только для чтения (§20.3).
          </p>
        </section>

        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Оперативный профиль (Smart Josparlau)</div>
          <div role="tablist" aria-label="Оперативный профиль" className="mb-3 flex flex-wrap gap-1 border-b">
            {PROFILE_TABS.map((tab, index) => (
              <button
                key={tab.key}
                ref={(el) => {
                  tabRefs.current[tab.key] = el
                }}
                type="button"
                role="tab"
                id={`profile-tab-${tab.key}`}
                aria-selected={activeTab === tab.key}
                aria-controls={`profile-tabpanel-${tab.key}`}
                tabIndex={activeTab === tab.key ? 0 : -1}
                className={
                  activeTab === tab.key
                    ? 'rounded-t-md border-b-2 border-primary px-2.5 py-1.5 text-xs font-semibold text-primary'
                    : 'rounded-t-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground'
                }
                onClick={() => setActiveTab(tab.key)}
                onKeyDown={(e) => handleTabKeyDown(e, index)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'summary' ? (
            <div
              role="tabpanel"
              id="profile-tabpanel-summary"
              aria-labelledby="profile-tab-summary"
              tabIndex={0}
            >
              <p className="text-sm text-muted-foreground">
                Доступность, назначения, подготовка и допуски, нагрузка, рейтинг и документы —
                Not started в текущем срезе: честно не показываем без реального read model (§35).
                Причина см. на соответствующих вкладках.
              </p>
            </div>
          ) : (
            <div
              role="tabpanel"
              id={`profile-tabpanel-${activeTab}`}
              aria-labelledby={`profile-tab-${activeTab}`}
              tabIndex={0}
            >
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
