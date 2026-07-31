// Story 14.11l: «Перепланировать смену». Буквальный образец —
// CreateDutyShiftDialog.tsx (14.11k) — нативный <dialog>, RHF+Zod,
// ValidationError-only setError, zonedDateTimeToIso() для datetime-полей.
// Отличие от create: форма ПРЕДЗАПОЛНЕНА текущими значениями строки (кроме
// reason — пусто), и post/duty_type несут явный checkbox «Снять» —
// единственный способ отличить «не менять» (значение переслано как есть,
// эквивалентно absent по факту) от «явно снять» (backend требует null, не
// просто отсутствие поля — DutyShiftReplanSerializer, 14.11e).
import { useEffect, useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { Label } from '../../../shared/ui/Label'
import { ValidationError } from '../../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../../shared/api/useApiMutation'
import { useReplanDutyShift } from '../api/queries'
import type { DutyShiftsListResponse } from '../api/queries'
import { isoToZonedDateTimeLocal, zonedDateTimeToIso } from '../lib/localDateTime'

type DutyShift = DutyShiftsListResponse['results'][number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const formSchema = z
  .object({
    reason: z.string().trim().min(1, 'Укажите причину.'),
    employee_id: z.string().trim().regex(UUID_RE, 'Укажите UUID сотрудника.'),
    post: z.coerce.number().int().positive('Число больше нуля.').optional().or(z.literal('')),
    post_clear: z.boolean(),
    duty_type: z.coerce
      .number()
      .int()
      .positive('Число больше нуля.')
      .optional()
      .or(z.literal('')),
    duty_type_clear: z.boolean(),
    duty_role_code: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    starts_at: z.string().min(1, 'Укажите начало дежурства.'),
    ends_at: z.string().min(1, 'Укажите окончание дежурства.'),
  })
  .transform((values) => ({
    reason: values.reason,
    employee_id: values.employee_id,
    post: values.post_clear
      ? null
      : values.post === '' || values.post === undefined
        ? undefined
        : values.post,
    duty_type: values.duty_type_clear
      ? null
      : values.duty_type === '' || values.duty_type === undefined
        ? undefined
        : values.duty_type,
    duty_role_code: values.duty_role_code,
    notes: values.notes,
    starts_at: zonedDateTimeToIso(values.starts_at),
    ends_at: zonedDateTimeToIso(values.ends_at),
  }))

type FormInput = z.input<typeof formSchema>
type FormValues = z.output<typeof formSchema>

export interface ReplanDutyShiftDialogProps {
  planId: string
  shift: DutyShift | null
  onClose: () => void
}

export function ReplanDutyShiftDialog({ planId, shift, onClose }: ReplanDutyShiftDialogProps) {
  if (shift === null) return null
  return <OpenDialog planId={planId} shift={shift} onClose={onClose} />
}

function OpenDialog({
  planId,
  shift,
  onClose,
}: {
  planId: string
  shift: DutyShift
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const mutation = useReplanDutyShift(planId, String(shift.id))

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      reason: '',
      employee_id: shift.employee_id,
      post: shift.post ?? '',
      post_clear: false,
      duty_type: shift.duty_type ?? '',
      duty_type_clear: false,
      duty_role_code: shift.duty_role_code,
      notes: shift.notes,
      starts_at: isoToZonedDateTimeLocal(shift.starts_at),
      ends_at: isoToZonedDateTimeLocal(shift.ends_at),
    },
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function submit(values: FormValues): void {
    mutation.mutate(values)
  }

  useEffect(() => {
    if (!(mutation.error instanceof ValidationError)) return
    for (const [field, value] of Object.entries(mutation.error.details)) {
      const message = Array.isArray(value) ? String(value[0]) : String(value)
      setError(field as keyof FormInput, { message })
    }
  }, [mutation.error, setError])

  useEffect(() => {
    if (mutation.data !== undefined) onClose()
  }, [mutation.data, onClose])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/40"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        Перепланировать смену
      </h2>
      <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(submit)(e)}>
        <div>
          <Label htmlFor="reason">Причина перепланирования</Label>
          <Input id="reason" {...register('reason')} />
          {errors.reason && (
            <p className="mt-1 text-xs text-destructive">{errors.reason.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="employee_id">UUID сотрудника</Label>
          <Input id="employee_id" {...register('employee_id')} />
          {errors.employee_id && (
            <p className="mt-1 text-xs text-destructive">{errors.employee_id.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="post">ID поста</Label>
          <Input id="post" type="number" {...register('post')} />
          <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" {...register('post_clear')} />
            Снять пост
          </label>
          {errors.post && <p className="mt-1 text-xs text-destructive">{errors.post.message}</p>}
        </div>
        <div>
          <Label htmlFor="duty_type">ID вида дежурства</Label>
          <Input id="duty_type" type="number" {...register('duty_type')} />
          <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" {...register('duty_type_clear')} />
            Снять вид дежурства
          </label>
          {errors.duty_type && (
            <p className="mt-1 text-xs text-destructive">{errors.duty_type.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="duty_role_code">Роль</Label>
          <Input id="duty_role_code" {...register('duty_role_code')} />
        </div>
        <div>
          <Label htmlFor="notes">Заметки</Label>
          <Input id="notes" {...register('notes')} />
        </div>
        <div>
          <Label htmlFor="starts_at">Начало</Label>
          <Input id="starts_at" type="datetime-local" {...register('starts_at')} />
          {errors.starts_at && (
            <p className="mt-1 text-xs text-destructive">{errors.starts_at.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="ends_at">Окончание</Label>
          <Input id="ends_at" type="datetime-local" {...register('ends_at')} />
          {errors.ends_at && (
            <p className="mt-1 text-xs text-destructive">{errors.ends_at.message}</p>
          )}
        </div>
        {mutation.error !== null && !(mutation.error instanceof ValidationError) && (
          <p className="text-sm text-destructive" role="alert">
            {mutation.error.kind === 'server' || mutation.error.kind === 'network'
              ? GENERIC_FAILURE_MESSAGE
              : mutation.error.message}
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Перепланирование…' : 'Перепланировать'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
