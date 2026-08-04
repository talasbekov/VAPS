// Story 16.8h2: деталь ОДНОЙ версии Расстановки + назначения + конфликты
// (свежий пересчёт, отдельный запрос — 16.8f). Буквальный образец скелета —
// duty-plans/pages/DutyPlanDetailPage.tsx (useParams/isLoading/isError-not
// -found ветки).
// Story 16.8h3: submit/return/approve — условный рендер по `status`
// (DRAFT→submit; SUBMITTED→return/approve), approve's 409
// SOFT_CONFLICT_DETECTED через общий ConflictDialog (useApiMutation's
// conflict-канал, 16.8h1).
// Story 16.8h4: «отметить ознакомление» — per-row кнопка в
// AssignmentsTable; identity-проверка (16.8e) полностью на бэке, фронт не
// знает employee_id текущего пользователя.
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ConflictDialog } from '../../../shared/ui/ConflictDialog'
import { ROUTES } from '../../../shared/routes'
import { ApiError, ConflictError } from '../../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../../shared/api/useApiMutation'
import {
  useAcknowledgePlacementAssignment,
  useApproveAssignmentVersion,
  useAssignmentVersion,
  useAssignmentVersionConflicts,
  useSubmitAssignmentVersion,
} from '../api/queries'
import type {
  AssignmentVersionConflictsResponse,
  AssignmentVersionDetailResponse,
} from '../api/queries'
import { JournalPanel } from './JournalPanel'
import { ReplaceDepartedDialog } from './ReplaceDepartedDialog'
import { ReturnVersionDialog } from './ReturnVersionDialog'

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'На согласовании',
  RETURNED: 'Возвращена на доработку',
  APPROVED: 'Утверждена',
}

export function PlacementVersionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const versionId = id ?? ''
  const versionQuery = useAssignmentVersion(versionId, {
    enabled: versionId !== '',
  })
  const conflictsQuery = useAssignmentVersionConflicts(versionId, {
    enabled: versionId !== '',
  })

  if (versionQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка версии…</p>
  }
  if (versionQuery.isError) {
    const notFound =
      versionQuery.error instanceof ApiError &&
      versionQuery.error.status === 404
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
          Версия {version.version} ·{' '}
          {STATUS_LABEL[version.status] ?? version.status}
        </h1>
        <span className="text-sm text-muted-foreground">
          {version.is_current ? 'Текущая версия' : 'Не текущая версия'}
          {version.signature_hash !== '' &&
            ` · подпись: ${version.signature_hash}`}
        </span>
      </header>

      <LifecycleActions versionId={versionId} status={version.status} />

      <AssignmentsTable version={version} />
      <ConflictsPanel
        isLoading={conflictsQuery.isLoading}
        isError={conflictsQuery.isError}
        conflicts={conflictsQuery.data ?? []}
      />
      <JournalPanel eventId={version.event} />
    </div>
  )
}

function LifecycleActions({
  versionId,
  status,
}: {
  versionId: string
  status: string
}) {
  // Story 16.8i (e2e review): ReturnVersionDialog is rendered OUTSIDE the
  // status-conditional sections below, not nested inside the SUBMITTED
  // branch. Its own return-success onSuccess() flips the version's cached
  // status to RETURNED (setQueryData), which flows straight back into this
  // component's `status` prop on the SAME render — if the dialog lived
  // inside `if (status === 'SUBMITTED')`, that branch would stop matching
  // and unmount the dialog before ITS OWN "navigate to the new draft"
  // effect got a chance to run on the just-arrived mutation.data. Caught
  // by the real-browser e2e test (jsdom's test timing masked it — the
  // isolated unit test never actually raced these two renders the same
  // way). `open` still gates visibility; only the MOUNT lifetime moved.
  const [returnDialogOpen, setReturnDialogOpen] = useState(false)
  const submitMutation = useSubmitAssignmentVersion(versionId)
  const approveMutation = useApproveAssignmentVersion(versionId)

  return (
    <>
      {status === 'DRAFT' && (
        <section className="mb-3.5 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Черновик готов — можно подать на согласование.
            </p>
            <Button
              type="button"
              disabled={submitMutation.isPending}
              onClick={() => submitMutation.mutate({})}
            >
              {submitMutation.isPending ? 'Отправка…' : 'Подать на согласование'}
            </Button>
          </div>
          {submitMutation.error !== null && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {submitMutation.error instanceof ApiError
                ? submitMutation.error.message
                : GENERIC_FAILURE_MESSAGE}
            </p>
          )}
        </section>
      )}

      {status === 'SUBMITTED' && (
        <section className="mb-3.5 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">На согласовании.</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReturnDialogOpen(true)}
              >
                Вернуть на доработку
              </Button>
              <Button
                type="button"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate({})}
              >
                {approveMutation.isPending ? 'Утверждение…' : 'Утвердить'}
              </Button>
            </div>
          </div>
          {approveMutation.error !== null &&
            !(approveMutation.error instanceof ConflictError) && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {approveMutation.error instanceof ApiError
                  ? approveMutation.error.message
                  : GENERIC_FAILURE_MESSAGE}
              </p>
            )}
          {/* Story 16.8i (review, Blind Hunter): still nested here, UNLIKE
              ReturnVersionDialog — safe today because approve success has no
              pending post-mutation effect for THIS dialog to lose (conflict
              lives in useApiMutation, cleared before the override retry;
              nothing here awaits mutation.data to fire a side effect). If
              approve's onSuccess ever grows one, apply the same fix: hoist
              this dialog outside the status conditional. */}
          <ConflictDialog
            conflict={approveMutation.conflict}
            onOverride={approveMutation.confirmOverride}
            onCancel={approveMutation.dismissConflict}
          />
        </section>
      )}

      <ReturnVersionDialog
        versionId={versionId}
        open={returnDialogOpen}
        onClose={() => setReturnDialogOpen(false)}
      />
    </>
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

function AssignmentsTable({
  version,
}: {
  version: AssignmentVersionDetailResponse
}) {
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
            <th className="px-3 py-2 font-semibold">Действия</th>
          </tr>
        </thead>
        <tbody>
          {version.assignments.map((a) => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="px-3 py-2 font-mono text-xs">{a.employee_id}</td>
              <td className="px-3 py-2">{a.post}</td>
              <td className="px-3 py-2">
                {conflictSeverityLabel(a.conflict_severity)}
              </td>
              <td className="px-3 py-2">
                <AcknowledgeCell
                  assignmentId={String(a.id)}
                  versionId={String(version.id)}
                  versionStatus={version.status}
                  acknowledgedAt={a.acknowledged_at}
                />
              </td>
              <td className="px-3 py-2">
                <ReplaceDepartedCell
                  versionId={String(version.id)}
                  employeeId={a.employee_id}
                  versionStatus={version.status}
                  isCurrent={version.is_current}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// Story 16.8h4: identity-based (16.8e) — фронт НЕ знает employee_id текущего
// пользователя, кнопка рендерится для КАЖДОГО ещё-не-отмеченного назначения
// APPROVED-версии; чужое назначение просто вернёт 403 (обычная mutation.
// error, тот же паттерн, что lifecycle-действия 16.8h3), кнопка остаётся
// кликабельной.
function AcknowledgeCell({
  assignmentId,
  versionId,
  versionStatus,
  acknowledgedAt,
}: {
  assignmentId: string
  versionId: string
  versionStatus: AssignmentVersionDetailResponse['status']
  acknowledgedAt: string | null
}) {
  const mutation = useAcknowledgePlacementAssignment(assignmentId, versionId)

  if (acknowledgedAt !== null) {
    return <span>{new Date(acknowledgedAt).toLocaleString('ru-RU')}</span>
  }
  if (versionStatus !== 'APPROVED') {
    return <span>Нет</span>
  }
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({})}
      >
        {mutation.isPending ? 'Отправка…' : 'Отметить ознакомление'}
      </Button>
      {mutation.error !== null && (
        <p className="text-xs text-destructive" role="alert">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : GENERIC_FAILURE_MESSAGE}
        </p>
      )}
    </div>
  )
}

// Story 17.7d: «Снять и заменить» (17.5/17.7b) — видна только на текущей
// APPROVED-версии (тот же lifecycle-гард, что amend_assignment_version()
// возвращает 422 иначе — кнопка не должна провоцировать заведомо-
// невалидный запрос).
function ReplaceDepartedCell({
  versionId,
  employeeId,
  versionStatus,
  isCurrent,
}: {
  versionId: string
  employeeId: string
  versionStatus: AssignmentVersionDetailResponse['status']
  isCurrent: boolean
}) {
  const [open, setOpen] = useState(false)

  if (versionStatus !== 'APPROVED' || !isCurrent) {
    return null
  }

  return (
    <>
      {/* review (Blind Hunter): каждая строка версии с 2+ назначениями
          несла бы кнопку с ОДНИМ и тем же accessible name — неоднозначно
          и для screen reader, и для любого теста, ищущего кнопку по
          имени. aria-label различает строки по employee_id. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Снять и заменить: ${employeeId}`}
        onClick={() => setOpen(true)}
      >
        Снять и заменить
      </Button>
      <ReplaceDepartedDialog
        versionId={versionId}
        departedEmployeeId={employeeId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
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
      <div className="mb-2 text-sm font-semibold">
        Конфликты (свежий пересчёт)
      </div>
      {isLoading && (
        <p className="text-sm text-muted-foreground">Проверка конфликтов…</p>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          Не удалось проверить конфликты.
        </p>
      )}
      {!isLoading && !isError && conflicts.length === 0 && (
        <p className="text-sm text-muted-foreground">Конфликтов нет.</p>
      )}
      {!isLoading && !isError && conflicts.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {conflicts.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-mono text-xs">{c.employee_id}</span> —{' '}
              {c.conflict_severity}:{' '}
              {conflictCodesOf(c.conflict_codes).join(', ')}
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
