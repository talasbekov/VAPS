// «Назначить смену» (прототип КалендарьСмен: fAssign). Нативный <dialog> +
// showModal() — тот же канон модалок, что ConflictDialog/CreateSecurityEventDialog.
// 409-обход НЕ свой: общий ConflictDialog + useApiMutation.confirmOverride
// (код DUTY_CONFLICT_DETECTED уже в OVERRIDABLE_CODES — свой новый код диалог
// обхода не включил бы).
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Label } from '../../../shared/ui/Label'
import { Input } from '../../../shared/ui/Input'
import { ConflictDialog } from '../../../shared/ui/ConflictDialog'
import { ApiError } from '../../../shared/api/errors'
import { useCreateDutyShift, useDutyDirectory, useDutyTypes } from '../api/queries'

export interface AssignShiftDialogProps {
  open: boolean
  /** Предзаполнение из клика по пустой клетке календаря. */
  initialDate: string
  initialEmployeeId?: string
  onClose: () => void
}

export function AssignShiftDialog({
  open,
  initialDate,
  initialEmployeeId,
  onClose,
}: AssignShiftDialogProps) {
  if (!open) return null
  // key/ремаунт: поля формы не переживают закрытие — новое назначение
  // начинается с чистого состояния, а не с хвоста предыдущего.
  return (
    <OpenAssignDialog
      initialDate={initialDate}
      initialEmployeeId={initialEmployeeId}
      onClose={onClose}
    />
  )
}

function OpenAssignDialog({
  initialDate,
  initialEmployeeId,
  onClose,
}: Omit<AssignShiftDialogProps, 'open'>) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const fieldId = useId()

  const directoryQuery = useDutyDirectory()
  const dutyTypesQuery = useDutyTypes()
  const mutation = useCreateDutyShift()

  const [businessDate, setBusinessDate] = useState(initialDate)
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? '')
  const [objectId, setObjectId] = useState('')
  const [dutyTypeCode, setDutyTypeCode] = useState('')

  // Стек модалок — ОДИН уровень (UX L76): на время ConflictDialog форма
  // закрывается, а не показывается под ним. `.close()` не размонтирует форму —
  // введённые поля переживают отмену обхода и остаются доступны для правки.
  const conflictOpen = mutation.conflict !== null
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (conflictOpen && dialog.open) dialog.close()
    if (!conflictOpen && !dialog.open) dialog.showModal()
  }, [conflictOpen])

  useEffect(() => {
    if (mutation.data !== undefined) onClose()
  }, [mutation.data, onClose])

  const targets = directoryQuery.data?.targets ?? []
  const roster = directoryQuery.data?.roster ?? []
  const dutyTypes = dutyTypesQuery.data?.results ?? []

  const complete =
    businessDate !== '' && employeeId !== '' && objectId !== '' && dutyTypeCode !== ''

  function submit(): void {
    mutation.mutate({ businessDate, employeeId, objectId, dutyTypeCode })
  }

  // 400 (форма) — рендерим по деталям конверта; 422 (бизнес-правило,
  // hard-block) — отдельным текстом: обойти его нельзя, и предлагать причину
  // было бы мёртвой кнопкой (§35).
  const fieldErrors =
    mutation.error instanceof ApiError && mutation.error.status === 400
      ? mutation.error.details
      : {}
  const businessRuleMessage =
    mutation.error instanceof ApiError && mutation.error.status === 422
      ? mutation.error.message
      : null

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
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
        <h2 id={titleId} className="mb-1 text-lg font-semibold">
          Назначение смены
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Конфликты проверяются при сохранении.
        </p>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div>
            <Label htmlFor={`${fieldId}-employee`}>Сотрудник</Label>
            <select
              id={`${fieldId}-employee`}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {roster.map((entry) => (
                <option key={entry.employeeId} value={entry.employeeId}>
                  {entry.fullName} · {entry.unitLabel}
                </option>
              ))}
            </select>
            <FieldError message={fieldErrors.employeeId} />
          </div>

          <div>
            <Label htmlFor={`${fieldId}-object`}>Объект дежурства</Label>
            <select
              id={`${fieldId}-object`}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={objectId}
              onChange={(event) => setObjectId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {targets.map((target) => (
                <option key={target.objectId} value={target.objectId}>
                  {target.safeLabel}
                </option>
              ))}
            </select>
            <FieldError message={fieldErrors.objectId} />
          </div>

          <div>
            <Label htmlFor={`${fieldId}-type`}>Вид дежурства</Label>
            <select
              id={`${fieldId}-type`}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={dutyTypeCode}
              onChange={(event) => setDutyTypeCode(event.target.value)}
            >
              <option value="">— выберите —</option>
              {dutyTypes.map((type) => (
                <option key={type.dutyTypeCode} value={type.dutyTypeCode}>
                  {type.safeLabel}
                </option>
              ))}
            </select>
            <FieldError message={fieldErrors.dutyTypeCode} />
          </div>

          <div>
            <Label htmlFor={`${fieldId}-date`}>Дата</Label>
            <Input
              id={`${fieldId}-date`}
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
            />
            <FieldError message={fieldErrors.businessDate} />
          </div>

          {businessRuleMessage !== null && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {businessRuleMessage} Обход невозможен — выберите другой день или сотрудника.
            </p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={!complete || mutation.isPending}>
              {mutation.isPending ? 'Сохранение…' : 'Назначить'}
            </Button>
          </div>
        </form>
      </dialog>

      <ConflictDialog
        conflict={mutation.conflict}
        onOverride={(reason) => mutation.confirmOverride(reason)}
        onCancel={() => mutation.dismissConflict()}
      />
    </>
  )
}

function FieldError({ message }: { message: unknown }) {
  if (message === undefined) return null
  const text = Array.isArray(message) ? String(message[0]) : String(message)
  return <p className="mt-1 text-xs text-destructive">{text}</p>
}
