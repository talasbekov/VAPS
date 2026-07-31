// Story 14.11k: деталь ОДНОГО плана дежурств + грид его смен. Буквальный
// образец скелета — SecurityEventDetailPage.tsx (useParams/isLoading/
// isError-not-found ветки ДО тела).
// Story 14.11l: approve-кнопка в заголовке + per-row cancel/replan. Нет
// validate/conflicts-UI — вне объёма (title стори их не называет).
//
// Scope Decision (14.11k): НЕТ GET /api/operations/duty-plans/{id}/
// (retrieve) в схеме — заголовок плана берётся из useDutyPlans() (list),
// отфильтрованного по id на клиенте. Это НЕ кэш-зависимость: useDutyPlans()
// делает СВОЙ независимый fetch списка при каждом монтировании, так что
// прямой заход по URL (F5/новая вкладка) тоже работает — дороже одного
// retrieve-запроса, но корректно. Настоящий retrieve — future backend work.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ROUTES } from '../../../shared/routes'
import { GENERIC_FAILURE_MESSAGE } from '../../../shared/api/useApiMutation'
import {
  useApproveDutyPlan,
  useCancelDutyShift,
  useDutyPlans,
  useDutyShifts,
} from '../api/queries'
import type { DutyShiftsListResponse } from '../api/queries'
import { CreateDutyShiftDialog } from './CreateDutyShiftDialog'
import { ReplanDutyShiftDialog } from './ReplanDutyShiftDialog'

type DutyShift = DutyShiftsListResponse['results'][number]

const MONTH_LABEL = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  APPROVED: 'Утверждён',
}

export function DutyPlanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const planId = id ?? ''
  const [dialogOpen, setDialogOpen] = useState(false)
  const [replanShift, setReplanShift] = useState<DutyShift | null>(null)

  const plansQuery = useDutyPlans()
  // Review (Blind Hunter/Edge Case Hunter): плюс-и-минус смены не должны
  // фаериться, пока план ещё не разрешён (не загружен/не найден/битый id
  // в URL) — иначе гарантирован лишний запрос вида GET .../abc/shifts/.
  const plan = plansQuery.data?.results.find((p) => String(p.id) === planId)
  const shiftsQuery = useDutyShifts(planId, { enabled: plan !== undefined })

  if (plansQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка плана…</p>
  }
  if (plansQuery.isError) {
    return (
      <NotFound message="Не удалось загрузить план дежурств. Попробуйте обновить страницу." />
    )
  }
  if (plan === undefined) {
    return <NotFound message="План не найден." />
  }

  return (
    <div>
      <Link
        to={ROUTES.dutyPlans}
        className="mb-3 inline-block text-xs font-semibold text-primary"
      >
        ← Назад к списку планов
      </Link>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
            Служба
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            Объект {plan.object} — {MONTH_LABEL[plan.month - 1] ?? plan.month} {plan.year}
          </h1>
          <span className="text-sm text-muted-foreground">
            {STATUS_LABEL[plan.status_code] ?? plan.status_code}
          </span>
        </div>
        <div className="flex gap-2">
          <ApproveButton planId={planId} statusCode={plan.status_code} />
          <Button onClick={() => setDialogOpen(true)}>+ Создать смену</Button>
        </div>
      </header>

      <ShiftsTable
        isLoading={shiftsQuery.isLoading}
        isError={shiftsQuery.isError}
        shifts={shiftsQuery.data?.results ?? []}
        isEmpty={shiftsQuery.data !== undefined && shiftsQuery.data.results.length === 0}
        planId={planId}
        onReplan={setReplanShift}
      />

      <CreateDutyShiftDialog
        planId={planId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
      <ReplanDutyShiftDialog
        planId={planId}
        shift={replanShift}
        onClose={() => setReplanShift(null)}
      />
    </div>
  )
}

function ApproveButton({ planId, statusCode }: { planId: string; statusCode: string }) {
  const mutation = useApproveDutyPlan(planId)
  const isApproved = statusCode !== 'DRAFT'

  return (
    <div>
      <Button
        variant="outline"
        disabled={isApproved || mutation.isPending}
        onClick={() => mutation.mutate({})}
      >
        {isApproved ? 'Утверждён' : mutation.isPending ? 'Утверждение…' : 'Утвердить план'}
      </Button>
      {mutation.error !== null && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {mutation.error.kind === 'server' || mutation.error.kind === 'network'
            ? GENERIC_FAILURE_MESSAGE
            : mutation.error.message}
        </p>
      )}
    </div>
  )
}

function NotFound({ message }: { message: string }) {
  return (
    <div>
      <p className="text-sm text-destructive">{message}</p>
      <Link
        to={ROUTES.dutyPlans}
        className="mt-2 inline-block text-sm font-semibold text-primary"
      >
        ← Назад к списку планов
      </Link>
    </div>
  )
}

function ShiftsTable({
  isLoading,
  isError,
  shifts,
  isEmpty,
  planId,
  onReplan,
}: {
  isLoading: boolean
  isError: boolean
  shifts: DutyShiftsListResponse['results']
  isEmpty: boolean
  planId: string
  onReplan: (shift: DutyShift) => void
}) {
  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Загрузка смен…
      </section>
    )
  }
  if (isError) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-destructive">
        Не удалось загрузить смены. Попробуйте обновить страницу.
      </section>
    )
  }
  if (isEmpty) {
    return (
      <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Смены не найдены
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-muted/40">
            <Th>Сотрудник</Th>
            <Th>Пост</Th>
            <Th>Вид дежурства</Th>
            <Th>Роль</Th>
            <Th>Начало</Th>
            <Th>Окончание</Th>
            <Th>Статус</Th>
            <Th>Действия</Th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => (
            <tr key={shift.id} className="border-t hover:bg-muted/30">
              <td className="p-3.5 text-sm font-mono text-foreground">{shift.employee_id}</td>
              <td className="p-3.5 text-sm tabular-nums">{shift.post ?? '—'}</td>
              <td className="p-3.5 text-sm tabular-nums">{shift.duty_type ?? '—'}</td>
              <td className="p-3.5 text-sm">{shift.duty_role_code || '—'}</td>
              <td className="p-3.5 text-sm">{shift.starts_at}</td>
              <td className="p-3.5 text-sm">{shift.ends_at}</td>
              <td className="p-3.5">
                {shift.cancelled_at !== null ? (
                  <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800">
                    Отменена
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800">
                    Активна
                  </span>
                )}
              </td>
              <td className="p-3.5">
                {shift.cancelled_at === null && (
                  <div className="flex items-start gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onReplan(shift)}
                    >
                      Перепланировать
                    </Button>
                    <CancelShiftAction planId={planId} shift={shift} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function CancelShiftAction({ planId, shift }: { planId: string; shift: DutyShift }) {
  const mutation = useCancelDutyShift(planId, String(shift.id))
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')

  if (!showForm) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(true)}>
        Отменить
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={`cancel-reason-${shift.id}`}
        className="text-[11px] font-semibold text-muted-foreground"
      >
        Причина отмены
      </label>
      <input
        id={`cancel-reason-${shift.id}`}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={mutation.isPending || reason.trim() === ''}
          onClick={() => mutation.mutate({ reason })}
        >
          {mutation.isPending ? 'Отмена…' : 'Подтвердить'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Review (Blind Hunter): без сброса причина остаётся в поле при
            // повторном открытии тоггла — не влияет на КОРРЕКТНОСТЬ (та же
            // строка/смена), но вводит в заблуждение UX-ом «залипшего» текста.
            setReason('')
            setShowForm(false)
          }}
        >
          Отмена
        </Button>
      </div>
      {mutation.error !== null && (
        <p className="text-xs text-destructive" role="alert">
          {/* Отмена — не RHF-форма (одно controlled-поле), setError
              неприменим; backend's DomainError.detail здесь несёт {"field":
              "reason"}, не {"reason": [...]} — не field-keyed record, как у
              DRF-serializer ошибок. mutation.error.message (человекочитаемое
              сообщение из конверта) — правильный источник текста, не details. */}
          {mutation.error.kind === 'server' || mutation.error.kind === 'network'
            ? GENERIC_FAILURE_MESSAGE
            : mutation.error.message}
        </p>
      )}
    </div>
  )
}

function Th({ children }: { children?: ReactNode }) {
  return (
    <th className="p-3.5 text-[11px] font-semibold text-muted-foreground">{children}</th>
  )
}
