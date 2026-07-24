// «Боевые группы и Трассы» (§24.5-24.10, по запросу «боевые группы на
// Трассе») — сокращённое подмножество §24.1: подача состава начальником
// управления → рассмотрение (принять/вернуть с причиной). См. model/types.ts
// шапку и FRONTEND_DECISIONS A51 для полного списка того, что НЕ реализовано.
import { useMemo, useState } from 'react'
import { usePermissions } from '../../../shared/auth/usePermissions'
import { Button } from '../../../shared/ui/Button'
import {
  useAcknowledgeCombatDuty,
  useCheckInCombatDuty,
  useCombatDutyShifts,
  useCombatDutyTypes,
  useCombatRosterCandidates,
  useCompleteCombatDuty,
  useCreateCombatDutyShift,
  useDutyRoutes,
  useRequestCombatDutyReplacement,
  useReviewCombatGroup,
  useSubmitCombatGroup,
} from '../api/queries'
import type {
  CombatDutyExecution,
  CombatDutyExecutionState,
  CombatDutyShift,
  CombatDutyTypeDefinition,
  CombatSubmissionState,
  DutyRoute,
  DutyReplacementRecord,
  DutyRouteCoverageMode,
} from '../model/types'

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

const EXECUTION_STATE_LABEL: Record<CombatDutyExecutionState, string> = {
  PENDING_ACKNOWLEDGEMENT: 'Ожидает ознакомления состава',
  READY: 'Ознакомлены, готовы к заступлению',
  ACTIVE: 'Заступили, несут службу',
  COMPLETED: 'Дежурство завершено',
}

export function CombatDutyGroupsSection() {
  const { hasPermission } = usePermissions()
  const canSubmit = hasPermission('ops.combat_group.submit')
  const canReview = hasPermission('ops.combat_group.review')
  const canAcknowledge = hasPermission('ops.combat_group.acknowledge')
  const canCheckIn = hasPermission('ops.combat_group.checkin')
  const canComplete = hasPermission('ops.combat_group.complete')
  const canReplace = hasPermission('ops.combat_group.replace')
  const canPlan = hasPermission('ops.duty.manage')

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
      {canPlan && (
        <CreateRequirementSection
          dutyTypes={dutyTypesQuery.data?.results ?? []}
          routes={routesQuery.data?.results ?? []}
        />
      )}
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
          canAcknowledge={canAcknowledge}
          canCheckIn={canCheckIn}
          canComplete={canComplete}
          canReplace={canReplace}
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
  canAcknowledge,
  canCheckIn,
  canComplete,
  canReplace,
  rosterCandidates,
}: {
  shift: CombatDutyShift
  dutyTypeLabel: string
  routeLabel: Map<string, string>
  canSubmit: boolean
  canReview: boolean
  canAcknowledge: boolean
  canCheckIn: boolean
  canComplete: boolean
  canReplace: boolean
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
          {shift.requiredEmployees !== null && (
            <div className="mt-1 text-xs text-muted-foreground">
              Требуется: {shift.requiredEmployees} чел.
            </div>
          )}
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

        {submission !== null && submission.stateCode === 'ACCEPTED' && submission.execution !== null && (
          <ExecutionControls
            shiftId={shift.id}
            groupLeaderEmployeeName={submission.groupLeaderEmployeeName}
            memberEmployeeNames={submission.memberEmployeeNames}
            execution={submission.execution}
            replacements={submission.replacements}
            canAcknowledge={canAcknowledge}
            canCheckIn={canCheckIn}
            canComplete={canComplete}
            canReplace={canReplace}
            rosterCandidates={rosterCandidates}
          />
        )}

        {canSubmit && needsSubmission && (
          <SubmitForm shiftId={shift.id} rosterCandidates={rosterCandidates} />
        )}
      </div>
    </section>
  )
}

// §24.19-24.23: пост-акцептный lifecycle принятого состава — ознакомление
// каждого (leader+members), заступление, факт (может отличаться от плана).
function ExecutionControls({
  shiftId,
  groupLeaderEmployeeName,
  memberEmployeeNames,
  execution,
  replacements,
  canAcknowledge,
  canCheckIn,
  canComplete,
  canReplace,
  rosterCandidates,
}: {
  shiftId: string
  groupLeaderEmployeeName: string
  memberEmployeeNames: string[]
  execution: CombatDutyExecution
  replacements: DutyReplacementRecord[]
  canAcknowledge: boolean
  canCheckIn: boolean
  canComplete: boolean
  canReplace: boolean
  rosterCandidates: { employeeName: string; unitName: string }[]
}) {
  const acknowledgeMutation = useAcknowledgeCombatDuty()
  const checkInMutation = useCheckInCombatDuty()
  const completeMutation = useCompleteCombatDuty()
  const [actualMembers, setActualMembers] = useState<string[]>([
    groupLeaderEmployeeName,
    ...memberEmployeeNames,
  ])

  const requiredNames = [groupLeaderEmployeeName, ...memberEmployeeNames]
  const error = acknowledgeMutation.error ?? checkInMutation.error ?? completeMutation.error

  function toggleActualMember(name: string): void {
    setActualMembers((list) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]))
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Несение службы</span>
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-800">
          {EXECUTION_STATE_LABEL[execution.stateCode]}
        </span>
      </div>
      {error !== null && <p className="text-xs text-destructive">{error.message}</p>}

      {(execution.stateCode === 'PENDING_ACKNOWLEDGEMENT' || execution.stateCode === 'READY') && (
        <div className="flex flex-col gap-1.5">
          {requiredNames.map((name) => {
            const acknowledged = execution.acknowledgedMemberNames.includes(name)
            return (
              <div key={name} className="flex items-center justify-between gap-2 text-sm">
                <span>{name}</span>
                {acknowledged ? (
                  <span className="text-xs font-medium text-green-700">Ознакомлен</span>
                ) : canAcknowledge ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={acknowledgeMutation.isPending}
                    onClick={() =>
                      acknowledgeMutation.mutate({ id: shiftId, body: { employeeName: name } })
                    }
                  >
                    Отметить ознакомление
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Ожидает ознакомления</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {(execution.stateCode === 'PENDING_ACKNOWLEDGEMENT' || execution.stateCode === 'READY') &&
        canReplace && (
          <ReplaceControls
            shiftId={shiftId}
            currentRoster={requiredNames}
            rosterCandidates={rosterCandidates}
          />
        )}

      {replacements.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">История замен</span>
          {replacements.map((r) => (
            <div key={r.replacementId}>
              {r.outgoingEmployeeName} → {r.incomingEmployeeName} ({r.reasonCode})
            </div>
          ))}
        </div>
      )}

      {execution.stateCode === 'READY' && canCheckIn && (
        <Button
          size="sm"
          className="self-start"
          disabled={checkInMutation.isPending}
          onClick={() => checkInMutation.mutate({ id: shiftId })}
        >
          {checkInMutation.isPending ? 'Заступление…' : 'Заступить'}
        </Button>
      )}

      {execution.stateCode === 'ACTIVE' && (
        <div className="flex flex-col gap-2">
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted-foreground">
              Фактически несли службу
            </legend>
            <div className="flex flex-wrap gap-3">
              {requiredNames.map((name) => (
                <label key={name} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={actualMembers.includes(name)}
                    onChange={() => toggleActualMember(name)}
                    disabled={!canComplete}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          {canComplete && (
            <Button
              size="sm"
              className="self-start"
              disabled={completeMutation.isPending}
              onClick={() =>
                completeMutation.mutate({ id: shiftId, body: { actualMemberNames: actualMembers } })
              }
            >
              {completeMutation.isPending ? 'Завершение…' : 'Завершить дежурство'}
            </Button>
          )}
        </div>
      )}

      {execution.stateCode === 'COMPLETED' && execution.actualMemberNames !== null && (
        <p className="text-sm text-muted-foreground">
          Фактически несли службу: {execution.actualMemberNames.join(', ') || '—'}
        </p>
      )}
    </div>
  )
}

// §24.21 «после утверждения нельзя просто поменять сотрудника в массиве» —
// упрощённая одношаговая замена (доступна только ДО заступления, см.
// model/types.ts DutyReplacementRecord).
function ReplaceControls({
  shiftId,
  currentRoster,
  rosterCandidates,
}: {
  shiftId: string
  currentRoster: string[]
  rosterCandidates: { employeeName: string; unitName: string }[]
}) {
  const [outgoing, setOutgoing] = useState('')
  const [incoming, setIncoming] = useState('')
  const [reasonCode, setReasonCode] = useState('')
  const [showForm, setShowForm] = useState(false)
  const replaceMutation = useRequestCombatDutyReplacement()

  const incomingCandidates = rosterCandidates.filter((c) => !currentRoster.includes(c.employeeName))

  if (!showForm) {
    return (
      <div className="flex flex-col gap-1">
        {replaceMutation.error !== null && (
          <p className="text-xs text-destructive">{replaceMutation.error.message}</p>
        )}
        <Button size="sm" variant="outline" className="self-start" onClick={() => setShowForm(true)}>
          Заменить участника
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      {replaceMutation.error !== null && (
        <p className="text-xs text-destructive">{replaceMutation.error.message}</p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`outgoing-${shiftId}`}>
            Кого заменить
          </label>
          <select
            id={`outgoing-${shiftId}`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={outgoing}
            onChange={(e) => setOutgoing(e.target.value)}
          >
            <option value="">— выбрать —</option>
            {currentRoster.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`incoming-${shiftId}`}>
            Кем заменить
          </label>
          <select
            id={`incoming-${shiftId}`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={incoming}
            onChange={(e) => setIncoming(e.target.value)}
          >
            <option value="">— выбрать —</option>
            {incomingCandidates.map((c) => (
              <option key={c.employeeName} value={c.employeeName}>
                {c.employeeName} ({c.unitName})
              </option>
            ))}
          </select>
        </div>
      </div>
      <input
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        placeholder="Причина замены…"
        value={reasonCode}
        onChange={(e) => setReasonCode(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={
            replaceMutation.isPending || outgoing === '' || incoming === '' || reasonCode.trim() === ''
          }
          onClick={() => {
            replaceMutation.mutate({
              id: shiftId,
              body: {
                outgoingEmployeeName: outgoing,
                incomingEmployeeName: incoming,
                reasonCode,
                safeComment: null,
              },
            })
            setShowForm(false)
            setOutgoing('')
            setIncoming('')
            setReasonCode('')
          }}
        >
          {replaceMutation.isPending ? 'Замена…' : 'Подтвердить замену'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
          Отмена
        </Button>
      </div>
    </div>
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

// §24.1 «формирование потребности на период» — упрощено до одной формы:
// создаёт новую смену (submission: null, сразу «Требует подачи») без
// отдельного шага публикации графика комплектования (см. model/types.ts
// шапку, FRONTEND_DECISIONS A54).
function CreateRequirementSection({
  dutyTypes,
  routes,
}: {
  dutyTypes: CombatDutyTypeDefinition[]
  routes: DutyRoute[]
}) {
  const [showForm, setShowForm] = useState(false)
  const [businessDate, setBusinessDate] = useState('')
  const [dutyTypeCode, setDutyTypeCode] = useState('')
  const [routeIds, setRouteIds] = useState<string[]>([])
  const [coverageMode, setCoverageMode] = useState<DutyRouteCoverageMode>('RESERVE')
  const [requiredEmployees, setRequiredEmployees] = useState(2)
  const createMutation = useCreateCombatDutyShift()

  function toggleRoute(routeId: string): void {
    setRouteIds((list) => (list.includes(routeId) ? list.filter((id) => id !== routeId) : [...list, routeId]))
  }

  if (!showForm) {
    return (
      <div className="flex flex-col gap-1">
        {createMutation.error !== null && (
          <p className="text-xs text-destructive">{createMutation.error.message}</p>
        )}
        <Button size="sm" variant="outline" className="self-start" onClick={() => setShowForm(true)}>
          Сформировать потребность
        </Button>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Сформировать потребность на смену</h3>
      {createMutation.error !== null && (
        <p className="text-xs text-destructive">{createMutation.error.message}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="req-business-date">
            Дата
          </label>
          <input
            id="req-business-date"
            type="date"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="req-duty-type">
            Вид дежурства
          </label>
          <select
            id="req-duty-type"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={dutyTypeCode}
            onChange={(e) => setDutyTypeCode(e.target.value)}
          >
            <option value="">— выбрать —</option>
            {dutyTypes.map((t) => (
              <option key={t.dutyTypeCode} value={t.dutyTypeCode}>
                {t.safeLabel}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="req-coverage-mode">
            Режим покрытия
          </label>
          <select
            id="req-coverage-mode"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={coverageMode}
            onChange={(e) => setCoverageMode(e.target.value as DutyRouteCoverageMode)}
          >
            <option value="RESERVE">Основная/резервная</option>
            <option value="SEQUENTIAL">Последовательно</option>
            <option value="PARALLEL">Параллельно</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="req-required-employees">
            Требуемая численность
          </label>
          <input
            id="req-required-employees"
            type="number"
            min={1}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={requiredEmployees}
            onChange={(e) => setRequiredEmployees(Number(e.target.value))}
          />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Трассы</legend>
        <div className="flex flex-wrap gap-3">
          {routes.map((r) => (
            <label key={r.routeId} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={routeIds.includes(r.routeId)}
                onChange={() => toggleRoute(r.routeId)}
              />
              {r.safeLabel}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={
            createMutation.isPending ||
            businessDate === '' ||
            dutyTypeCode === '' ||
            routeIds.length === 0 ||
            requiredEmployees < 1
          }
          onClick={() => {
            createMutation.mutate({
              body: { businessDate, dutyTypeCode, routeIds, coverageMode, requiredEmployees },
            })
            setShowForm(false)
            setBusinessDate('')
            setDutyTypeCode('')
            setRouteIds([])
            setCoverageMode('RESERVE')
            setRequiredEmployees(2)
          }}
        >
          {createMutation.isPending ? 'Создание…' : 'Создать'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
          Отмена
        </Button>
      </div>
    </section>
  )
}
