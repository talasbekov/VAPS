// Story 17.7d: «Снять и заменить» — каскадная замена выбывшего (17.5/
// 17.7b), буквальный образец ReturnVersionDialog.tsx (native <dialog>,
// RHF+Zod, редирект на новую версию при успехе). Единственный manual-путь
// не предлагается (нет employee-picker в кодовой базе) — только авто-поиск
// по штатной цепочке.
import { useEffect, useId, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { Label } from '../../../shared/ui/Label'
import { ROUTES } from '../../../shared/routes'
import { ApiError, ValidationError } from '../../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../../shared/api/useApiMutation'
import { useReplaceDeparted } from '../api/queries'

const formSchema = z.object({
  reason: z.string().trim().min(1, 'Укажите причину.'),
  sanction: z.string().trim().min(1, 'Укажите санкцию.'),
})
type FormValues = z.infer<typeof formSchema>

export interface ReplaceDepartedDialogProps {
  versionId: string
  departedEmployeeId: string
  open: boolean
  onClose: () => void
}

export function ReplaceDepartedDialog({
  versionId,
  departedEmployeeId,
  open,
  onClose,
}: ReplaceDepartedDialogProps) {
  // Story 17.7c review-урок: диалог полностью размонтируется при
  // open=false — следующее открытие получает свежий useReplaceDeparted()
  // (новый mutation-инстанс), нет permanent-lockout после 403/409, т.к.
  // error-state не переживает размонтирование.
  if (!open) return null
  return (
    <OpenDialog
      versionId={versionId}
      departedEmployeeId={departedEmployeeId}
      onClose={onClose}
    />
  )
}

function OpenDialog({
  versionId,
  departedEmployeeId,
  onClose,
}: {
  versionId: string
  departedEmployeeId: string
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const navigate = useNavigate()
  const mutation = useReplaceDeparted(versionId)

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
    mutation.mutate({ ...values, departed_employee_id: departedEmployeeId })
  }

  useEffect(() => {
    if (!(mutation.error instanceof ValidationError)) return
    for (const [field, value] of Object.entries(mutation.error.details)) {
      const message = Array.isArray(value) ? String(value[0]) : String(value)
      setError(field as keyof FormValues, { message })
    }
  }, [mutation.error, setError])

  useEffect(() => {
    if (mutation.data === undefined) return
    onClose()
    void navigate(ROUTES.placementVersionDetailTo(mutation.data.id))
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
        Снять и заменить
      </h2>
      <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(submit)(e)}>
        <div>
          <Label htmlFor="reason">Причина</Label>
          <textarea
            id="reason"
            rows={2}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            {...register('reason')}
          />
          {errors.reason && (
            <p className="mt-1 text-xs text-destructive">{errors.reason.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="sanction">Санкция</Label>
          <textarea
            id="sanction"
            rows={2}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            {...register('sanction')}
          />
          {errors.sanction && (
            <p className="mt-1 text-xs text-destructive">{errors.sanction.message}</p>
          )}
        </div>
        {mutation.error !== null && !(mutation.error instanceof ValidationError) && (
          <p className="text-sm text-destructive" role="alert">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : GENERIC_FAILURE_MESSAGE}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Отправка…' : 'Заменить'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
