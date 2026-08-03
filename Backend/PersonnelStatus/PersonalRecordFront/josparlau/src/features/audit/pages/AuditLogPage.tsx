// Аудит и настройки (§29 мастер-промпта, Этап 6): read-only журнал действий.
// Настройки/справочники (§29-30) — Not started, вне объёма этого среза.
import { useMemo, useState } from 'react'
import { useAuditLogs } from '../api/queries'
import { Input } from '../../../shared/ui/Input'
import type { AuditLog } from '../model/types'

export function AuditLogPage() {
  const [search, setSearch] = useState('')
  const query = useAuditLogs()

  const filtered = useMemo(() => {
    const all = query.data?.results ?? []
    const q = search.trim().toLowerCase()
    if (q === '') return all
    return all.filter((log) =>
      `${log.action} ${log.entity_type} ${log.actor_user_id}`.toLowerCase().includes(q),
    )
  }, [query.data, search])

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Контроль
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Аудит</h1>
        <span className="text-sm text-muted-foreground">
          Журнал действий пользователей — только для чтения
        </span>
      </header>

      <div className="mb-3">
        <Input
          className="min-w-56"
          placeholder="Поиск по действию, сущности, пользователю…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ResultsTable isLoading={query.isLoading} isError={query.isError} logs={filtered} />
    </div>
  )
}

function ResultsTable({
  isLoading,
  isError,
  logs,
}: {
  isLoading: boolean
  isError: boolean
  logs: AuditLog[]
}) {
  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Загрузка журнала…
      </section>
    )
  }
  if (isError) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-destructive">
        Не удалось загрузить журнал аудита. Попробуйте обновить страницу.
      </section>
    )
  }
  if (logs.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Записи не найдены
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-muted/40">
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Дата и время</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Пользователь</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Действие</th>
            <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">Сущность</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-t hover:bg-muted/30">
              <td className="p-3.5 text-sm tabular-nums text-muted-foreground">{log.created_at}</td>
              <td className="p-3.5 text-sm">{log.actor_user_id}</td>
              <td className="p-3.5 font-mono text-xs">{log.action}</td>
              <td className="p-3.5 text-sm text-muted-foreground">
                {log.entity_type} · {log.entity_id}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
