// Реестр объектов (§21.6): поиск, таблица. KPI-агрегаты/переключатель
// таблица-карточки/экспорт из прототипа — Not started (нет серверных
// агрегатов в этом mock-срезе, §21.7 запрещает считать их по текущей
// странице таблицы — честнее не показывать, чем придумать).
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Input } from '../../../shared/ui/Input'
import { ROUTES } from '../../../shared/routes'
import { useObjectsList } from '../api/queries'
import type { PassportState, SecurityObject } from '../model/types'

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

  const filtered = useMemo(() => {
    const all = query.data?.results ?? []
    const q = search.trim().toLowerCase()
    if (q === '') return all
    return all.filter((o) =>
      `${o.name} ${o.code} ${o.address} ${o.type}`.toLowerCase().includes(q),
    )
  }, [query.data, search])

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
      />
    </div>
  )
}

function ResultsTable({
  isLoading,
  isError,
  objects,
}: {
  isLoading: boolean
  isError: boolean
  objects: SecurityObject[]
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
