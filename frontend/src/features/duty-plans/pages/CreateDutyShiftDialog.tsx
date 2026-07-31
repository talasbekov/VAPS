// Story 14.11k: «Создать смену». Буквальный образец — CreateDutyPlanDialog.tsx
// (14.11j, ПОСЛЕ review-фикса) — нативный <dialog>, RHF+Zod, ValidationError-
// only setError-эффект СРАЗУ (не открывать заново 14.11j's найденный review-
// дефект: широкий ApiError-catch ловил бы 409/422 как поле-ошибки).
// post/duty_type — числовой ID-stopgap (тот же паттерн, что object в 14.11j,
// Scope Decision: нет backend-эндпоинта списка постов/видов дежурств ещё).
import { useEffect, useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { Label } from '../../../shared/ui/Label'
import { ValidationError } from '../../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../../shared/api/useApiMutation'
import { useCreateDutyShift } from '../api/queries'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const formSchema = z
  .object({
    employee_id: z.string().trim().regex(UUID_RE, 'Укажите UUID сотрудника.'),
    post: z.coerce.number().int().positive('Число больше нуля.').optional().or(z.literal('')),
    duty_type: z.coerce
      .number()
      .int()
      .positive('Число больше нуля.')
      .optional()
      .or(z.literal('')),
    duty_role_code: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    starts_at: z.string().min(1, 'Укажите начало дежурства.'),
    ends_at: z.string().min(1, 'Укажите окончание дежурства.'),
  })
  .transform((values) => ({
    employee_id: values.employee_id,
    post: values.post === '' || values.post === undefined ? undefined : values.post,
    duty_type:
      values.duty_type === '' || values.duty_type === undefined ? undefined : values.duty_type,
    duty_role_code: values.duty_role_code,
    notes: values.notes,
    starts_at: new Date(values.starts_at).toISOString(),
    ends_at: new Date(values.ends_at).toISOString(),
  }))

type FormInput = z.input<typeof formSchema>
type FormValues = z.output<typeof formSchema>

export interface CreateDutyShiftDialogProps {
  planId: string
  open: boolean
  onClose: () => void
}

export function CreateDutyShiftDialog({ planId, open, onClose }: CreateDutyShiftDialogProps) {
  if (!open) return null
  return <OpenDialog planId={planId} onClose={onClose} />
}

function OpenDialog({ planId, onClose }: { planId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const mutation = useCreateDutyShift(planId)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({ resolver: zodResolver(formSchema) })

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function submit(values: FormValues): void {
    mutation.mutate(values)
  }

  // ValidationError-only с самого начала (14.11j's review-урок).
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
        Создать смену
      </h2>
      <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(submit)(e)}>
        <div>
          <Label htmlFor="employee_id">UUID сотрудника</Label>
          <Input id="employee_id" {...register('employee_id')} />
          {errors.employee_id && (
            <p className="mt-1 text-xs text-destructive">{errors.employee_id.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="post">ID поста (опционально)</Label>
          <Input id="post" type="number" {...register('post')} />
          {errors.post && <p className="mt-1 text-xs text-destructive">{errors.post.message}</p>}
        </div>
        <div>
          <Label htmlFor="duty_type">ID вида дежурства (опционально)</Label>
          <Input id="duty_type" type="number" {...register('duty_type')} />
          {errors.duty_type && (
            <p className="mt-1 text-xs text-destructive">{errors.duty_type.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="duty_role_code">Роль (опционально)</Label>
          <Input id="duty_role_code" {...register('duty_role_code')} />
        </div>
        <div>
          <Label htmlFor="notes">Заметки (опционально)</Label>
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
            {mutation.isPending ? 'Создание…' : 'Создать'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
