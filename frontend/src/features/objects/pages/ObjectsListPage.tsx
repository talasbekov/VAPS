// Реестр объектов (§21.6-21.7): KPI-полоса, поиск, таблица.
//
// §21.7 задаёт два прямых запрета, и оба соблюдены СТРУКТУРНО, а не обещанием:
//   • «Не считай KPI по текущей странице таблицы» — числа приходят из ответа
//     (`kpi`), посчитанные по ВСЕМУ реестру; фильтр и поиск на них не влияют,
//     и тест подсовывает KPI, ЗАВЕДОМО расходящийся с числом строк;
//   • «Не используй фиксированный frontend-период (Паспорт старше 90 дней)» —
//     срок и состояние актуальности приходят готовыми (`freshness`), а версия
//     политики, по которой они посчитаны, показана рядом.
// Оставшиеся два KPI прототипа модель не даёт — приходят с причиной (§35).
//
// «Клик по KPI может активировать соответствующий фильтр» (§21.7) — фильтр
// живёт в URL рядом с поиском: состояние экрана обязано переживать перезагрузку
// и делиться ссылкой.
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Input } from '../../../shared/ui/Input'
import { ROUTES } from '../../../shared/routes'
import { Button } from '../../../shared/ui/Button'
import { useObjectsList } from '../api/queries'
import { FRESHNESS_LABEL } from '../lib/passportFreshness'
import type { ObjectsRegistryKpi } from '../lib/passportFreshness'
import type { PassportFreshness, PassportState, SecurityObject } from '../model/types'

/** Значение фильтра в URL → предикат по объекту и его актуальности. §21.7
 * «клик по KPI активирует соответствующий фильтр»: у каждого выводимого KPI
 * есть ровно один фильтр, иначе клик обещал бы больше, чем делает. */
const KPI_FILTERS = {
  green: { label: 'Паспорта актуальны', kpi: 'passportGreen' },
  yellow: { label: 'Требуют актуализации', kpi: 'passportYellow' },
  red: { label: 'Красный статус паспорта', kpi: 'passportRed' },
  overdue: { label: 'Проверка просрочена', kpi: 'verificationOverdue' },
  'never-published': { label: 'Паспорт не публиковался', kpi: 'neverPublished' },
} as const satisfies Record<string, { label: string; kpi: keyof ObjectsRegistryKpi }>

type KpiFilter = keyof typeof KPI_FILTERS

function matchesFilter(
  filter: KpiFilter,
  object: SecurityObject,
  freshness: PassportFreshness | undefined,
): boolean {
  switch (filter) {
    case 'green':
      return object.passportState === 'GREEN'
    case 'yellow':
      return object.passportState === 'YELLOW'
    case 'red':
      return object.passportState === 'RED'
    case 'overdue':
      return freshness?.state === 'OVERDUE'
    case 'never-published':
      return freshness?.state === 'NO_PUBLISHED_VERSION'
  }
}

const PASSPORT_LABEL: Record<PassportState, string> = {
  GREEN: 'Актуален',
  YELLOW: 'Требует проверки',
  RED: 'Требует внимания',
}

const PASSPORT_CLASS: Record<PassportState, string> = {
  GREEN: 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800',
  YELLOW: 'inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800',
  RED: 'inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800',
}

export function ObjectsListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') ?? ''
  const query = useObjectsList()

  const rawFilter = searchParams.get('filter') ?? ''
  const filter: KpiFilter | null = rawFilter in KPI_FILTERS ? (rawFilter as KpiFilter) : null

  const freshnessById = useMemo(() => {
    const map = new Map<string, PassportFreshness>()
    for (const item of query.data?.freshness ?? []) map.set(item.objectId, item)
    return map
  }, [query.data])

  const filtered = useMemo(() => {
    const all = query.data?.results ?? []
    const q = search.trim().toLowerCase()
    const byFilter =
      filter === null
        ? all
        : all.filter((o) => matchesFilter(filter, o, freshnessById.get(o.id)))
    if (q === '') return byFilter
    return byFilter.filter((o) =>
      `${o.name} ${o.code} ${o.address} ${o.type}`.toLowerCase().includes(q),
    )
  }, [query.data, search, filter, freshnessById])

  function toggleFilter(next: KpiFilter): void {
    const params = new URLSearchParams(searchParams)
    // Повторный клик по активному KPI снимает фильтр: иначе из него не выйти
    // иначе как правкой адреса.
    if (filter === next) params.delete('filter')
    else params.set('filter', next)
    setSearchParams(params)
  }

  function updateSearch(value: string): void {
    const next = new URLSearchParams(searchParams)
    if (value === '') {
      next.delete('search')
    } else {
      next.set('search', value)
    }
    setSearchParams(next)
  }

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Служба
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Объекты и паспорта</h1>
        <span className="text-sm text-muted-foreground">
          Реестр объектов, секторов и постоянных постов
        </span>
      </header>

      {query.data !== undefined && (
        <div className="mb-4 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div role="group" aria-label="Всего объектов" className="rounded-xl border bg-card p-3">
              <p className="text-[11px] font-semibold text-slate-600">Всего объектов</p>
              <p className="text-xl font-bold tabular-nums">{query.data.kpi.total}</p>
            </div>
            {(Object.keys(KPI_FILTERS) as KpiFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => toggleFilter(key)}
                className={
                  filter === key
                    ? 'rounded-xl border border-primary bg-primary/10 p-3 text-left'
                    : 'rounded-xl border bg-card p-3 text-left hover:bg-muted/40'
                }
              >
                <span className="block text-[11px] font-semibold text-slate-600">
                  {KPI_FILTERS[key].label}
                </span>
                <span className="block text-xl font-bold tabular-nums">
                  {query.data.kpi[KPI_FILTERS[key].kpi]}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600">
            Показатели посчитаны сервером по всему реестру, а не по отрисованной таблице
            (§21.7). Срок проверки — по политике {query.data.freshnessPolicy.version}:{' '}
            {query.data.freshnessPolicy.verificationIntervalDays} дней с даты публикации.
          </p>
          {filter !== null && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600">
                Фильтр: {KPI_FILTERS[filter].label}
              </span>
              <Button size="sm" variant="outline" onClick={() => toggleFilter(filter)}>
                Сбросить фильтр
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="mb-3">
        <Input
          className="min-w-56"
          placeholder="Поиск по наименованию, коду, адресу, типу…"
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
        />
      </div>

      <ResultsTable
        isLoading={query.isLoading}
        isError={query.isError}
        objects={filtered}
        freshnessById={freshnessById}
      />

      {query.data !== undefined && (
        <section className="mt-3.5 rounded-xl border border-dashed bg-muted/30 p-4">
          <h2 className="mb-2 text-sm font-semibold">Показатели, которых нет в модели</h2>
          <ul className="flex flex-col gap-2">
            {query.data.unavailableKpi.map((metric) => (
              <li key={metric.code} className="text-xs text-slate-600">
                <span className="font-semibold">{metric.label}</span> — {metric.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ResultsTable({
  isLoading,
  isError,
  objects,
  freshnessById,
}: {
  isLoading: boolean
  isError: boolean
  objects: SecurityObject[]
  freshnessById: Map<string, PassportFreshness>
}) {
  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Загрузка реестра объектов…
      </section>
    )
  }
  if (isError) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-destructive">
        Не удалось загрузить реестр объектов. Попробуйте обновить страницу.
      </section>
    )
  }
  if (objects.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Объекты не найдены
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-muted/40">
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Объект</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Тип</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Адрес</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Паспорт</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">
              Срок проверки
            </th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {objects.map((object) => (
            <tr key={object.id} className="border-t hover:bg-muted/30">
              <td className="p-3.5 text-sm">
                <Link to={ROUTES.objectDetailTo(object.id)} className="block">
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-foreground">
                    {object.code}
                  </span>
                  <span className="mt-1 block font-semibold text-foreground">{object.name}</span>
                </Link>
              </td>
              <td className="p-3.5 text-sm text-muted-foreground">{object.type}</td>
              <td className="p-3.5 text-sm text-muted-foreground">
                {object.region} · {object.address}
              </td>
              <td className="p-3.5">
                <span className={PASSPORT_CLASS[object.passportState]}>
                  {PASSPORT_LABEL[object.passportState]}
                </span>
              </td>
              {/* §21.5: состояние паспорта и его АКТУАЛЬНОСТЬ — разные поля,
                  не один бейдж. Срок приходит с сервера вместе с состоянием. */}
              <td className="p-3.5">
                <FreshnessCell freshness={freshnessById.get(object.id)} />
              </td>
              <td className="p-3.5 text-center text-muted-foreground">
                <Link to={ROUTES.objectDetailTo(object.id)}>›</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function FreshnessCell({ freshness }: { freshness: PassportFreshness | undefined }) {
  if (freshness === undefined) {
    // Статус не пришёл (старый кэш ответа) — не выдумываем «актуален».
    return <span className="text-xs text-slate-600">Нет данных об актуальности</span>
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm">{FRESHNESS_LABEL[freshness.state]}</span>
      {freshness.verificationDueAt !== null && (
        <span className="text-[11px] text-slate-600 tabular-nums">
          до {freshness.verificationDueAt}
        </span>
      )}
    </div>
  )
}
