// «Создать ОМ» (Smart Josparlau.dc.html: fCreateOm). Нативный <dialog> +
// showModal() — тот же канон, что ConflictDialog.tsx (ЕДИНЫЙ механизм модалок,
// не второй UI-kit). React Hook Form + Zod (§5.6) — единый источник валидации.
import { useEffect, useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { Label } from '../../../shared/ui/Label'
import { ROUTES } from '../../../shared/routes'
import { ApiError } from '../../../shared/api/errors'
import { useCreateSecurityEvent } from '../api/queries'

const formSchema = z.object({
  title: z.string().trim().min(1, 'Обязательное поле.'),
  objectName: z.string().trim().min(1, 'Обязательное поле.'),
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату в формате ГГГГ-ММ-ДД.'),
})

type FormValues = z.infer<typeof formSchema>

export interface CreateSecurityEventDialogProps {
  open: boolean
  onClose: () => void
}

export function CreateSecurityEventDialog({
  open,
  onClose,
}: CreateSecurityEventDialogProps) {
  if (!open) return null
  return <OpenDialog onClose={onClose} />
}

function OpenDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const navigate = useNavigate()
  const mutation = useCreateSecurityEvent()

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) })

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function submit(values: FormValues): void {
    mutation.mutate(values)
  }

  // 400 (форма) → RHF setError по деталям DRF-стиля (§7.4/8.5 конверт)
  useEffect(() => {
    if (!(mutation.error instanceof ApiError)) return
    for (const [field, value] of Object.entries(mutation.error.details)) {
      const message = Array.isArray(value) ? String(value[0]) : String(value)
      setError(field as keyof FormValues, { message })
    }
  }, [mutation.error, setError])

  useEffect(() => {
    if (mutation.data !== undefined) {
      navigate(ROUTES.securityEventDetailTo(mutation.data.id))
      onClose()
    }
  }, [mutation.data, navigate, onClose])

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
        Создать охранное мероприятие
      </h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => void handleSubmit(submit)(e)}
      >
        <div>
          <Label htmlFor="title">Название</Label>
          <Input id="title" {...register('title')} />
          {errors.title && (
            <p className="mt-1 text-xs text-destructive">
              {errors.title.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="objectName">Объект</Label>
          <Input id="objectName" {...register('objectName')} />
          {errors.objectName && (
            <p className="mt-1 text-xs text-destructive">
              {errors.objectName.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="businessDate">Дата проведения</Label>
          <Input id="businessDate" type="date" {...register('businessDate')} />
          {errors.businessDate && (
            <p className="mt-1 text-xs text-destructive">
              {errors.businessDate.message}
            </p>
          )}
        </div>
        {mutation.error !== null && (
          <p className="text-sm text-destructive" role="alert">
            Не удалось создать мероприятие. Проверьте поля и попробуйте снова.
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
