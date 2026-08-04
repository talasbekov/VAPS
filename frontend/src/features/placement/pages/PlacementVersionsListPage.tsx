// Story 16.8h2: список версий Расстановки. Буквальный образец —
// duty-plans/pages/DutyPlansListPage.tsx (isLoading/isError/isEmpty-ветки).
// Событие показано голым numeric id — реальной «деталь события»-страницы
// ещё нет во фронте (SecurityEventDetailPage целиком pending-contract, эта
// стори её не трогает).
import { Link } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { useAssignmentVersions } from '../api/queries'
import type { AssignmentVersionsListResponse } from '../api/queries'

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'На согласовании',
  RETURNED: 'Возвращена на доработку',
  APPROVED: 'Утверждена',
}

export function PlacementVersionsListPage() {
  const query = useAssignmentVersions()

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          ОМ
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Расстановка</h1>
        <span className="text-sm text-muted-foreground">Версии расстановки по мероприятиям</span>
      </header>

      <ResultsTable
        isLoading={query.isLoading}
        isError={query.isError}
        versions={query.data?.results ?? []}
        isEmpty={query.data !== undefined && query.data.results.length === 0}
      />
    </div>
  )
}

function ResultsTable({
  isLoading,
  isError,
  versions,
  isEmpty,
}: {
  isLoading: boolean
  isError: boolean
  versions: AssignmentVersionsListResponse['results']
  isEmpty: boolean
}) {
  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Загрузка версий…
      </section>
    )
  }
  if (isError) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-destructive">
        Не удалось загрузить версии Расстановки. Попробуйте обновить страницу.
      </section>
    )
  }
  if (isEmpty) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Версий Расстановки пока нет.
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">Мероприятие</th>
            <th className="px-3 py-2 font-semibold">Версия</th>
            <th className="px-3 py-2 font-semibold">Статус</th>
            <th className="px-3 py-2 font-semibold">Текущая</th>
            <th className="px-3 py-2 font-semibold">Обновлено</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2">
                <Link
                  to={ROUTES.placementVersionDetailTo(v.id)}
                  className="font-semibold text-primary"
                >
                  Событие #{v.event}
                </Link>
              </td>
              <td className="px-3 py-2">{v.version}</td>
              <td className="px-3 py-2">{STATUS_LABEL[v.status] ?? v.status}</td>
              <td className="px-3 py-2">{v.is_current ? 'Да' : 'Нет'}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {new Date(v.updated_at).toLocaleString('ru-RU')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
