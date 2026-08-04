// Story 16.8h2: деталь ОДНОЙ версии Расстановки + назначения + конфликты
// (свежий пересчёт, отдельный запрос — 16.8f). Буквальный образец скелета —
// duty-plans/pages/DutyPlanDetailPage.tsx (useParams/isLoading/isError-not
// -found ветки). Только чтение — действия (submit/return/approve/
// acknowledge) вне объёма этой стори (16.8h3/h4).
import { Link, useParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { ApiError } from '../../../shared/api/errors'
import { useAssignmentVersion, useAssignmentVersionConflicts } from '../api/queries'
import type {
  AssignmentVersionConflictsResponse,
  AssignmentVersionDetailResponse,
} from '../api/queries'

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'На согласовании',
  RETURNED: 'Возвращена на доработку',
  APPROVED: 'Утверждена',
}

export function PlacementVersionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const versionId = id ?? ''
  const versionQuery = useAssignmentVersion(versionId, { enabled: versionId !== '' })
  const conflictsQuery = useAssignmentVersionConflicts(versionId, {
    enabled: versionId !== '',
  })

  if (versionQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка версии…</p>
  }
  if (versionQuery.isError) {
    const notFound =
      versionQuery.error instanceof ApiError && versionQuery.error.status === 404
    return (
      <NotFound
        message={
          notFound
            ? 'Версия Расстановки не найдена.'
            : 'Не удалось загрузить версию Расстановки. Попробуйте обновить страницу.'
        }
      />
    )
  }

  const version = versionQuery.data
  if (version === undefined) {
    return <NotFound message="Версия Расстановки не найдена." />
  }

  return (
    <div>
      <Link
        to={ROUTES.placementVersions}
        className="mb-3 inline-block text-xs font-semibold text-primary"
      >
        ← Назад к списку версий
      </Link>

      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          ОМ · Событие #{version.event}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          Версия {version.version} · {STATUS_LABEL[version.status] ?? version.status}
        </h1>
        <span className="text-sm text-muted-foreground">
          {version.is_current ? 'Текущая версия' : 'Не текущая версия'}
          {version.signature_hash !== '' && ` · подпись: ${version.signature_hash}`}
        </span>
      </header>

      <AssignmentsTable version={version} />
      <ConflictsPanel
        isLoading={conflictsQuery.isLoading}
        isError={conflictsQuery.isError}
        conflicts={conflictsQuery.data ?? []}
      />
    </div>
  )
}

function NotFound({ message }: { message: string }) {
  return (
    <div>
      <p className="text-sm text-destructive">{message}</p>
      <Link
        to={ROUTES.placementVersions}
        className="mt-2 inline-block text-sm font-semibold text-primary"
      >
        ← Назад к списку версий
      </Link>
    </div>
  )
}

function AssignmentsTable({ version }: { version: AssignmentVersionDetailResponse }) {
  if (version.assignments.length === 0) {
    return (
      <section className="mb-3.5 rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Назначений в этой версии нет.
      </section>
    )
  }
  return (
    <section className="mb-3.5 overflow-hidden rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">Сотрудник</th>
            <th className="px-3 py-2 font-semibold">Пост</th>
            <th className="px-3 py-2 font-semibold">Конфликт</th>
            <th className="px-3 py-2 font-semibold">Ознакомлен</th>
          </tr>
        </thead>
        <tbody>
          {version.assignments.map((a) => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="px-3 py-2 font-mono text-xs">{a.employee_id}</td>
              <td className="px-3 py-2">{a.post}</td>
              <td className="px-3 py-2">{conflictSeverityLabel(a.conflict_severity)}</td>
              <td className="px-3 py-2">
                {a.acknowledged_at === null
                  ? 'Нет'
                  : new Date(a.acknowledged_at).toLocaleString('ru-RU')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function ConflictsPanel({
  isLoading,
  isError,
  conflicts,
}: {
  isLoading: boolean
  isError: boolean
  conflicts: AssignmentVersionConflictsResponse
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-2 text-sm font-semibold">Конфликты (свежий пересчёт)</div>
      {isLoading && <p className="text-sm text-muted-foreground">Проверка конфликтов…</p>}
      {isError && (
        <p className="text-sm text-destructive">Не удалось проверить конфликты.</p>
      )}
      {!isLoading && !isError && conflicts.length === 0 && (
        <p className="text-sm text-muted-foreground">Конфликтов нет.</p>
      )}
      {!isLoading && !isError && conflicts.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {conflicts.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-mono text-xs">{c.employee_id}</span> —{' '}
              {c.conflict_severity}: {conflictCodesOf(c.conflict_codes).join(', ')}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// `ConflictSeverityEnum` (openapi-typescript) is "SOFT" | "HARD" only —
// spectacular's enum extraction misses the blank runtime default (DRF
// CharField choices with no explicit "" entry) — widen to `string` here
// rather than fight the generated type; the real API DOES return "".
function conflictSeverityLabel(severity: string): string {
  return severity === '' ? '—' : severity
}

// `conflict_codes` is a JSONField → `unknown` in the generated schema; the
// real API always returns a string array (services.py's `codes` list).
function conflictCodesOf(codes: unknown): string[] {
  return Array.isArray(codes) ? (codes as string[]) : []
}
