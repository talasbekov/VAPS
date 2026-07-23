// Реестр ОМ (прототип Smart Josparlau.dc.html:229-291 «Реестр ОМ»): поиск,
// фильтр по этапу, таблица, создание. Фильтры — в URL search params (§5.3:
// «поиск, фильтры... должны переживать переход между страницами»), а не
// useState — обновление страницы не должно сбрасывать фильтр.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { ROUTES } from '../../../shared/routes'
import { useSecurityEventsList } from '../api/queries'
import type { ListSecurityEventsParams } from '../api/pending-contracts'
import { SECURITY_EVENT_STAGES } from '../model/types'
import type { SecurityEvent, SecurityEventStage } from '../model/types'
import { STAGE_LABEL, stageBadgeVariants } from '../lib/stageMeta'
import { CreateSecurityEventDialog } from './CreateSecurityEventDialog'

const PAGE_SIZE = 20

function isStage(value: string | null): value is SecurityEventStage {
  return (SECURITY_EVENT_STAGES as readonly string[]).includes(value ?? '')
}

export function SecurityEventsListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)

  const stageParam = searchParams.get('stage')
  const params: ListSecurityEventsParams = {
    search: searchParams.get('search') ?? '',
    stage: isStage(stageParam) ? stageParam : 'ALL',
    page: Number(searchParams.get('page') ?? '1') || 1,
    pageSize: PAGE_SIZE,
  }

  const query = useSecurityEventsList(params)

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams)
    if (value === '') {
      next.delete(key)
    } else {
      next.set(key, value)
    }
    next.delete('page') // фильтр меняется — начинаем с первой страницы
    setSearchParams(next)
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
            Охранные мероприятия
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Реестр ОМ</h1>
          <span className="text-sm text-muted-foreground">
            Полный цикл: от бюллетеня и рекогносцировки до закрытия и архива
          </span>
        </div>
        <Button onClick={() => setDialogOpen(true)}>+ Создать ОМ</Button>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="min-w-56 flex-1"
          placeholder="Поиск по названию, объекту или ответственному"
          value={params.search}
          onChange={(e) => updateParam('search', e.target.value)}
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Этап"
          value={params.stage}
          onChange={(e) => updateParam('stage', e.target.value === 'ALL' ? '' : e.target.value)}
        >
          <option value="ALL">Все этапы</option>
          {SECURITY_EVENT_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABEL[stage]}
            </option>
          ))}
        </select>
        {(params.search !== '' || params.stage !== 'ALL') && (
          <Button variant="outline" size="sm" onClick={() => setSearchParams({})}>
            Сбросить фильтры
          </Button>
        )}
      </div>

      <ResultsTable
        isLoading={query.isLoading}
        isError={query.isError}
        events={query.data?.results ?? []}
        isEmpty={query.data !== undefined && query.data.results.length === 0}
      />

      <CreateSecurityEventDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  )
}

function ResultsTable({
  isLoading,
  isError,
  events,
  isEmpty,
}: {
  isLoading: boolean
  isError: boolean
  events: SecurityEvent[]
  isEmpty: boolean
}) {
  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Загрузка реестра…
      </section>
    )
  }
  if (isError) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-destructive">
        Не удалось загрузить реестр ОМ. Попробуйте обновить страницу.
      </section>
    )
  }
  if (isEmpty) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Мероприятия не найдены
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-muted/40">
            <Th>ОМ</Th>
            <Th>Дата и объект</Th>
            <Th>Этап</Th>
            <Th>Готовность</Th>
            <Th>Потребность</Th>
            <Th>Конфликты</Th>
            <Th>Ответственный</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t hover:bg-muted/30">
              <td className="p-3.5 text-sm">
                <Link
                  to={ROUTES.securityEventDetailTo(event.id)}
                  className="block"
                >
                  <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800">
                    {event.code}
                  </span>
                  <span className="mt-1 block font-semibold text-foreground">
                    {event.title}
                  </span>
                </Link>
              </td>
              <td className="p-3.5 text-sm text-muted-foreground">
                {event.businessDate} · {event.objectName}
              </td>
              <td className="p-3.5">
                <span className={stageBadgeVariants({ stage: event.stage })}>
                  {STAGE_LABEL[event.stage]}
                </span>
              </td>
              <td className="p-3.5 text-sm tabular-nums">
                {event.readinessPercent}%
              </td>
              <td className="p-3.5 text-sm tabular-nums">{event.forceNeed}</td>
              <td className="p-3.5">
                <span
                  className={
                    event.conflictsCount > 0
                      ? 'inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800'
                      : 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800'
                  }
                >
                  {event.conflictsCount}
                </span>
              </td>
              <td className="p-3.5 text-sm">{event.ownerName}</td>
              <td className="p-3.5 text-center text-muted-foreground">
                <Link to={ROUTES.securityEventDetailTo(event.id)}>›</Link>
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
    <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">
      {children}
    </th>
  )
}
