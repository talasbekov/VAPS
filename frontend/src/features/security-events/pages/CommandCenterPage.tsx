// Командный центр (Smart Josparlau.dc.html:81-197 «Командный центр»). Этап 2
// реализует ТОЛЬКО блок «Готовность охранных мероприятий» — он один реально
// подкреплён данными (security-events). Карточки численности личного состава,
// карта готовности подразделений и график нагрузки из прототипа НЕ рисуются:
// для них нет реального read model в этом срезе (Epic 19/20, кадровый snapshot
// вне scope Smart Josparlau) — придумывать цифры запрещено (§35 «не показывай
// success раньше данных»). Статус — FRONTEND_TRACEABILITY_MATRIX.md.
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ROUTES } from '../../../shared/routes'
import { useSecurityEventsList } from '../api/queries'
import { STAGE_LABEL, stageBadgeVariants } from '../lib/stageMeta'
import { CreateSecurityEventDialog } from './CreateSecurityEventDialog'

export function CommandCenterPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const query = useSecurityEventsList({
    search: '',
    stage: 'ALL',
    page: 1,
    pageSize: 5,
  })

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
            Командный центр
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            Готовность охранных мероприятий
          </h1>
        </div>
        <div className="flex gap-2">
          <Link to={ROUTES.securityEvents}>
            <Button variant="outline">Все мероприятия</Button>
          </Link>
          <Button onClick={() => setDialogOpen(true)}>Создать ОМ</Button>
        </div>
      </header>

      <section className="rounded-xl border bg-card p-4">
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        )}
        {query.isError && (
          <p className="text-sm text-destructive">
            Не удалось загрузить данные командного центра.
          </p>
        )}
        {query.data !== undefined && query.data.results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ближайших мероприятий нет.
          </p>
        )}
        {query.data?.results.map((event) => (
          <Link
            key={event.id}
            to={ROUTES.securityEventDetailTo(event.id)}
            className="flex items-center gap-3.5 border-b py-3 text-left last:border-0 hover:bg-muted/30"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-sm font-extrabold text-primary">
              {event.businessDate.slice(8, 10)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {event.title}
              </span>
              <span className="block text-[11.5px] text-muted-foreground">
                {event.businessDate} · {event.objectName}
              </span>
            </span>
            <span className={stageBadgeVariants({ stage: event.stage })}>
              {STAGE_LABEL[event.stage]}
            </span>
            <b className="tabular-nums text-sm">{event.readinessPercent}%</b>
          </Link>
        ))}
      </section>

      <CreateSecurityEventDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  )
}
