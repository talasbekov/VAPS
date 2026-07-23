// Аналитика службы (§22 мастер-промпта). Живёт в app/, НЕ в features/analytics
// — экран композирует данные ДВУХ независимых фич (security-events, objects),
// а ARCH-FE-013 запрещает features→features (та же матрица, что не даёт
// personnel импортировать objects). app→features разрешён (та же матрица),
// это законная композиция на уровне приложения, не побег от границ.
//
// Честные агрегаты, вычисленные из РЕАЛЬНЫХ read model, а НЕ выдуманные
// показатели — §35 запрет «не считай KPI, если это выдаёт себя за серверный
// агрегат»: подпись явно говорит «по видимым записям». Дашборды нагрузки/
// рейтинга (Epic 19-20) — Not started, нет read model.
import { useSecurityEventsList } from '../features/security-events/api/queries'
import { STAGE_LABEL } from '../features/security-events/lib/stageMeta'
import { SECURITY_EVENT_STAGES } from '../features/security-events/model/types'
import { useObjectsList } from '../features/objects/api/queries'
import type { PassportState } from '../features/objects/model/types'

const PASSPORT_LABEL: Record<PassportState, string> = {
  GREEN: 'Актуален',
  YELLOW: 'Требует проверки',
  RED: 'Требует внимания',
}

export function ServiceAnalyticsPage() {
  const eventsQuery = useSecurityEventsList({ search: '', stage: 'ALL', page: 1, pageSize: 100 })
  const objectsQuery = useObjectsList()

  const isLoading = eventsQuery.isLoading || objectsQuery.isLoading
  const isError = eventsQuery.isError || objectsQuery.isError

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Контроль
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Аналитика службы</h1>
        <span className="text-sm text-muted-foreground">
          Распределение по видимым записям — не заявлено как серверный агрегат
        </span>
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка аналитики…</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">Не удалось загрузить данные аналитики.</p>
      )}

      {!isLoading && !isError && (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-4">
            <div className="mb-3 text-sm font-semibold">
              ОМ по этапам ({eventsQuery.data?.results.length ?? 0} из {eventsQuery.data?.count ?? 0})
            </div>
            <div className="flex flex-col gap-2">
              {SECURITY_EVENT_STAGES.map((stage) => {
                const count =
                  eventsQuery.data?.results.filter((e) => e.stage === stage).length ?? 0
                const total = eventsQuery.data?.results.length ?? 0
                const pct = total === 0 ? 0 : Math.round((count / total) * 100)
                return (
                  <div key={stage} className="grid grid-cols-[140px_1fr_50px] items-center gap-2">
                    <span className="text-xs">{STAGE_LABEL[stage]}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-right text-xs tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-4">
            <div className="mb-3 text-sm font-semibold">
              Объекты по состоянию паспорта ({objectsQuery.data?.results.length ?? 0})
            </div>
            <div className="flex flex-col gap-2">
              {(['GREEN', 'YELLOW', 'RED'] as const).map((state) => {
                const count =
                  objectsQuery.data?.results.filter((o) => o.passportState === state).length ?? 0
                const total = objectsQuery.data?.results.length ?? 0
                const pct = total === 0 ? 0 : Math.round((count / total) * 100)
                return (
                  <div key={state} className="grid grid-cols-[140px_1fr_50px] items-center gap-2">
                    <span className="text-xs">{PASSPORT_LABEL[state]}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-right text-xs tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-4 lg:col-span-2">
            <div className="mb-1 text-sm font-semibold">Не реализовано в этом срезе</div>
            <p className="text-xs text-muted-foreground">
              Нагрузка личного состава, оперативный рейтинг, дежурства, экспорт с
              маскированием (§22, Epic 19-20) — Not started: нет read model на
              стороне Smart Josparlau для честного расчёта.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
