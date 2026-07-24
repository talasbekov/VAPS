// «Боевые группы и Трассы» (§24.5-24.10, по запросу «боевые группы на
// Трассе») — сокращённое подмножество §24.1: подача состава начальником
// управления → рассмотрение (принять/вернуть с причиной). См. model/types.ts
// шапку и FRONTEND_DECISIONS A51 для полного списка того, что НЕ реализовано.
import { useMemo, useState } from 'react'
import { usePermissions } from '../../../shared/auth/usePermissions'
import { Button } from '../../../shared/ui/Button'
import {
  useCombatDutyShifts,
  useCombatDutyTypes,
  useCombatRosterCandidates,
  useDutyRoutes,
  useReviewCombatGroup,
  useSubmitCombatGroup,
} from '../api/queries'
import type { CombatDutyShift, CombatSubmissionState } from '../model/types'

const SUBMISSION_STATE_LABEL: Record<CombatSubmissionState, string> = {
  SUBMITTED: 'Подано, ожидает рассмотрения',
  RETURNED: 'Возвращено на доработку',
  ACCEPTED: 'Принято',
}

const SUBMISSION_STATE_CLASS: Record<CombatSubmissionState, string> = {
  SUBMITTED: 'inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800',
  RETURNED: 'inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800',
  ACCEPTED: 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800',
}

export function CombatDutyGroupsSection() {
  const { hasPermission } = usePermissions()
  const canSubmit = hasPermission('ops.combat_group.submit')
  const canReview = hasPermission('ops.combat_group.review')

  const dutyTypesQuery = useCombatDutyTypes()
  const routesQuery = useDutyRoutes()
  const rosterQuery = useCombatRosterCandidates({ enabled: canSubmit })
  const shiftsQuery = useCombatDutyShifts()

  const dutyTypeLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of dutyTypesQuery.data?.results ?? []) map.set(t.dutyTypeCode, t.safeLabel)
    return map
  }, [dutyTypesQuery.data])

  const routeLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of routesQuery.data?.results ?? []) map.set(r.routeId, r.safeLabel)
    return map
  }, [routesQuery.data])

  const isLoading = dutyTypesQuery.isLoading || routesQuery.isLoading || shiftsQuery.isLoading
  const isError = dutyTypesQuery.isError || routesQuery.isError || shiftsQuery.isError
  const shifts = shiftsQuery.data?.results ?? []

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка боевых групп и Трасс…</p>
  }
  if (isError) {
    return <p className="text-sm text-destructive">Не удалось загрузить боевые группы и Трассы.</p>
  }

  return (
    <div className="flex flex-col gap-3.5">
      {shifts.length === 0 && (
        <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
          Смен боевых групп не найдено
        </section>
      )}
      {shifts.map((shift) => (
        <CombatShiftCard
          key={shift.id}
          shift={shift}
          dutyTypeLabel={dutyTypeLabel.get(shift.dutyTypeCode) ?? shift.dutyTypeCode}
          routeLabel={routeLabel}
          canSubmit={canSubmit}
          canReview={canReview}
          rosterCandidates={rosterQuery.data?.results ?? []}
        />
      ))}
    </div>
  )
}

function CombatShiftCard({
  shift,
  dutyTypeLabel,
  routeLabel,
  canSubmit,
  canReview,
  rosterCandidates,
}: {
  shift: CombatDutyShift
  dutyTypeLabel: string
  routeLabel: Map<string, string>
  canSubmit: boolean
  canReview: boolean
  rosterCandidates: { employeeName: string; unitName: string }[]
}) {
  const submission = shift.submission
  const needsSubmission = submission === null || submission.stateCode === 'RETURNED'

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold">{shift.routeSet.safeLabel}</div>
          <div className="text-xs text-muted-foreground">
            {dutyTypeLabel} · {shift.businessDate} · покрытие:{' '}
            {shift.routeSet.coverageMode === 'SEQUENTIAL' && 'последовательно'}
            {shift.routeSet.coverageMode === 'PARALLEL' && 'параллельно'}
            {shift.routeSet.coverageMode === 'RESERVE' && 'основная/резервная'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Трассы: {shift.routeSet.routeIds.map((id) => routeLabel.get(id) ?? id).join(', ')}
          </div>
        </div>
        {submission !== null && (
          <span className={SUBMISSION_STATE_CLASS[submission.stateCode]}>
            {SUBMISSION_STATE_LABEL[submission.stateCode]}
          </span>
        )}
        {submission === null && (
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
            Требует подачи
          </span>
        )}
      </div>

      <div className="p-4">
        {submission !== null && (
          <dl className="mb-3 flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Подало управление</dt>
              <dd className="font-medium">{submission.submittedByUnitName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Старший группы</dt>
              <dd className="font-medium">{submission.groupLeaderEmployeeName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Состав</dt>
              <dd className="font-medium">{submission.memberEmployeeNames.join(', ')}</dd>
            </div>
            {submission.reserveEmployeeNames.length > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Резерв</dt>
                <dd className="font-medium">{submission.reserveEmployeeNames.join(', ')}</dd>
              </div>
            )}
            {submission.stateCode === 'RETURNED' && submission.returnReason !== null && (
              <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                Причина возврата: {submission.returnReason}
              </div>
            )}
          </dl>
        )}

        {canReview && submission !== null && submission.stateCode === 'SUBMITTED' && (
          <ReviewControls shiftId={shift.id} />
        )}

        {canSubmit && needsSubmission && (
          <SubmitForm shiftId={shift.id} rosterCandidates={rosterCandidates} />
        )}
      </div>
    </section>
  )
}

function ReviewControls({ shiftId }: { shiftId: string }) {
  const [returnReason, setReturnReason] = useState('')
  const [showReturnForm, setShowReturnForm] = useState(false)
  const reviewMutation = useReviewCombatGroup()

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      {reviewMutation.error !== null && (
        <p className="text-xs text-destructive">{reviewMutation.error.message}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={reviewMutation.isPending}
          onClick={() =>
            reviewMutation.mutate({ id: shiftId, body: { decision: 'ACCEPT', returnReason: null } })
          }
        >
          Принять
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={reviewMutation.isPending}
          onClick={() => setShowReturnForm((v) => !v)}
        >
          Вернуть на доработку
        </Button>
      </div>
      {showReturnForm && (
        <div className="flex gap-2">
          <input
            className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            placeholder="Причина возврата…"
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={reviewMutation.isPending || returnReason.trim() === ''}
            onClick={() => {
              reviewMutation.mutate({ id: shiftId, body: { decision: 'RETURN', returnReason } })
              setShowReturnForm(false)
            }}
          >
            Подтвердить возврат
          </Button>
        </div>
      )}
    </div>
  )
}

function SubmitForm({
  shiftId,
  rosterCandidates,
}: {
  shiftId: string
  rosterCandidates: { employeeName: string; unitName: string }[]
}) {
  const [leader, setLeader] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [reserve, setReserve] = useState<string[]>([])
  const submitMutation = useSubmitCombatGroup()

  function toggle(list: string[], setList: (v: string[]) => void, name: string): void {
    setList(list.includes(name) ? list.filter((n) => n !== name) : [...list, name])
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <h3 className="text-sm font-semibold">Подать состав боевой группы</h3>
      {submitMutation.error !== null && (
        <p className="text-xs text-destructive">{submitMutation.error.message}</p>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`leader-${shiftId}`}>
          Старший группы
        </label>
        <select
          id={`leader-${shiftId}`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={leader}
          onChange={(e) => setLeader(e.target.value)}
        >
          <option value="">— выбрать —</option>
          {rosterCandidates.map((c) => (
            <option key={c.employeeName} value={c.employeeName}>
              {c.employeeName} ({c.unitName})
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Основной состав</legend>
        <div className="flex flex-wrap gap-3">
          {rosterCandidates
            .filter((c) => c.employeeName !== leader)
            .map((c) => (
              <label key={c.employeeName} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={members.includes(c.employeeName)}
                  onChange={() => toggle(members, setMembers, c.employeeName)}
                />
                {c.employeeName}
              </label>
            ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Резерв</legend>
        <div className="flex flex-wrap gap-3">
          {rosterCandidates
            .filter((c) => c.employeeName !== leader && !members.includes(c.employeeName))
            .map((c) => (
              <label key={c.employeeName} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={reserve.includes(c.employeeName)}
                  onChange={() => toggle(reserve, setReserve, c.employeeName)}
                />
                {c.employeeName}
              </label>
            ))}
        </div>
      </fieldset>
      <Button
        size="sm"
        className="self-start"
        disabled={submitMutation.isPending || leader === '' || members.length === 0}
        onClick={() =>
          submitMutation.mutate({
            id: shiftId,
            body: {
              groupLeaderEmployeeName: leader,
              memberEmployeeNames: members,
              reserveEmployeeNames: reserve,
            },
          })
        }
      >
        {submitMutation.isPending ? 'Отправка…' : 'Подать состав'}
      </Button>
    </div>
  )
}
