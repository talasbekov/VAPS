// Правка одного значения политики (§29). Нативный <dialog> + showModal() —
// тот же канон модалок, что ConflictDialog: второго механизма окон в проекте
// нет.
//
// Причина обязательна и здесь, и на сервере: экран проверяет длину, чтобы не
// отправлять заведомо отклоняемый запрос, но окончательное решение остаётся за
// репозиторием — правило живёт в одном месте, а форма лишь предупреждает.
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { Label } from '../../../shared/ui/Label'
import { ApiError } from '../../../shared/api/errors'
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH } from '../lib/policy'
import { useUpdateSetting } from '../api/queries'
import type { PolicySetting } from '../model/types'

export interface EditSettingDialogProps {
  setting: PolicySetting
  unitLabel: string
  onClose: () => void
}

export function EditSettingDialog({ setting, unitLabel, onClose }: EditSettingDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const fieldId = useId()
  const mutation = useUpdateSetting()

  const [value, setValue] = useState(String(setting.value))
  const [reason, setReason] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    if (mutation.data !== undefined) onClose()
  }, [mutation.data, onClose])

  const trimmedReason = reason.trim()
  const parsed = Number(value)
  const reasonValid =
    trimmedReason.length >= REASON_MIN_LENGTH && trimmedReason.length <= REASON_MAX_LENGTH
  const valueParsable = value.trim() !== '' && Number.isFinite(parsed)

  const fieldErrors =
    mutation.error instanceof ApiError && mutation.error.status === 400
      ? mutation.error.details
      : {}
  // 422 — нарушено правило политики: «значение не изменилось» или порядок
  // порогов. Обхода нет, поэтому и предлагать причину повторно бессмысленно.
  const ruleMessage =
    mutation.error instanceof ApiError && mutation.error.status === 422
      ? mutation.error.message
      : null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${fieldId}-title`}
      className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/40"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={`${fieldId}-title`} className="mb-1 text-lg font-semibold">
        {setting.safeLabel}
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">{setting.description}</p>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate({
            settingCode: setting.settingCode,
            value: parsed,
            reason: trimmedReason,
          })
        }}
      >
        <div>
          <Label htmlFor={`${fieldId}-value`}>
            Значение ({unitLabel}), допустимо {setting.minValue}–{setting.maxValue}
          </Label>
          <Input
            id={`${fieldId}-value`}
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <FieldError message={fieldErrors.value} />
        </div>

        <div>
          <Label htmlFor={`${fieldId}-reason`}>
            Причина изменения ({REASON_MIN_LENGTH}–{REASON_MAX_LENGTH} символов)
          </Label>
          <textarea
            id={`${fieldId}-reason`}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            {reason.length} / {REASON_MAX_LENGTH}
          </div>
          <FieldError message={fieldErrors.reason} />
        </div>

        {ruleMessage !== null && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {ruleMessage}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={!valueParsable || !reasonValid || mutation.isPending}>
            {mutation.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}

function FieldError({ message }: { message: unknown }) {
  if (message === undefined) return null
  const text = Array.isArray(message) ? String(message[0]) : String(message)
  return (
    <p className="mt-1 text-xs text-destructive" role="alert">
      {text}
    </p>
  )
}
