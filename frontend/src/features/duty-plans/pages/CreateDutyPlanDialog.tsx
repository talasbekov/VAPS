// Story 14.11j: «Создать план дежурств». Нативный <dialog> + showModal() —
// тот же канон, что CreateSecurityEventDialog.tsx (ЕДИНЫЙ механизм модалок).
// React Hook Form + Zod. Object-picker — числовое ID-поле (stopgap, Scope
// Decision: нет backend-эндпоинта списка объектов ещё). После успеха —
// остаёмся на списке (НЕ навигируем — деталь-страницы 14.11k ещё нет).
import { useEffect, useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { Label } from '../../../shared/ui/Label'
import { ValidationError } from '../../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../../shared/api/useApiMutation'
import { useCreateDutyPlan } from '../api/queries'

const formSchema = z.object({
  object: z.coerce.number().int().positive('Укажите ID объекта.'),
  year: z.coerce
    .number()
    .int()
    .min(2026, 'Год должен быть не раньше 2026.')
    .max(2100, 'Год должен быть не позже 2100.'),
  month: z.coerce
    .number()
    .int()
    .min(1, 'Месяц — число от 1 до 12.')
    .max(12, 'Месяц — число от 1 до 12.'),
})

type FormInput = z.input<typeof formSchema>
type FormValues = z.output<typeof formSchema>

export interface CreateDutyPlanDialogProps {
  open: boolean
  onClose: () => void
}

export function CreateDutyPlanDialog({ open, onClose }: CreateDutyPlanDialogProps) {
  if (!open) return null
  return <OpenDialog onClose={onClose} />
}

function OpenDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const mutation = useCreateDutyPlan()

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

  // 400 (форма) → RHF setError по деталям DRF-стиля (§7.4/8.5 конверт).
  // Review (Blind Hunter/Edge Case Hunter, 14.11j): ТОЛЬКО ValidationError
  // (400) — ConflictError/ServerError и т.д. тоже extends ApiError, но их
  // details не гарантированно поле-формы (409 DUTY_PLAN_ALREADY_EXISTS
  // сегодня шлёт details: {} — молчаливый no-op, но НЕ архитектурная
  // гарантия для будущих кодов). Сужение до ValidationError — тот класс, чей
  // контракт (§7.4/8.5) реально обещает "details = поля формы".
  useEffect(() => {
    if (!(mutation.error instanceof ValidationError)) return
    for (const [field, value] of Object.entries(mutation.error.details)) {
      const message = Array.isArray(value) ? String(value[0]) : String(value)
      setError(field as keyof FormValues, { message })
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
        Создать план дежурств
      </h2>
      <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(submit)(e)}>
        <div>
          <Label htmlFor="object">ID объекта</Label>
          <Input id="object" type="number" {...register('object')} />
          {errors.object && (
            <p className="mt-1 text-xs text-destructive">{errors.object.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="year">Год</Label>
          <Input id="year" type="number" {...register('year')} />
          {errors.year && <p className="mt-1 text-xs text-destructive">{errors.year.message}</p>}
        </div>
        <div>
          <Label htmlFor="month">Месяц (1-12)</Label>
          <Input id="month" type="number" {...register('month')} />
          {errors.month && (
            <p className="mt-1 text-xs text-destructive">{errors.month.message}</p>
          )}
        </div>
        {mutation.error !== null && !(mutation.error instanceof ValidationError) && (
          <p className="text-sm text-destructive" role="alert">
            {/* UX L208 / useApiMutation.ts's own canon: 5xx/сеть — generic БЕЗ
                деталей наружу; остальное (409 «план уже существует» и т.п.) —
                серверное message безопасно показать как есть. */}
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
