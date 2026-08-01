// Общий ConflictDialog (ARCH-FE-015: диалог ОДИН, в shared/ui; пер-фичевые
// оверрайд-диалоги забанены). Нативный <dialog> + showModal(): focus-trap,
// Escape и возврат фокуса — нативно (FF98+ → цель FF100 ok; UX L177/L219),
// стек модалок — один уровень (UX L76). Копирайт — мокап key-daily-grid.html
// L426-450. Правило «причина 10–500 символов» несёт ФРОНТ (BR-003, UX L175) —
// бэк проверяет только непустоту, расхождение зафиксировано в стори 8.5.
// Headless-минимум БЕЗ стилей: Tailwind/shadcn приходят в 8.7 (Д4),
// CSS-in-JS/inline-style запрещены (ARCH-FE-014).
import { useEffect, useId, useRef, useState } from 'react'
import type { ConflictError } from '../api/errors'

export const REASON_MIN = 10
export const REASON_MAX = 500

export interface ConflictDialogProps {
  conflict: ConflictError | null
  /** «Подтвердить оверрайд»: причина уже провалидирована (10–500 после trim). */
  onOverride: (reason: string) => void
  /** «Отмена»/Escape: повтора не будет, conflict-state сбрасывает владелец. */
  onCancel: () => void
}

export function ConflictDialog({
  conflict,
  onOverride,
  onCancel,
}: ConflictDialogProps) {
  if (conflict === null) return null
  // размонтирование = закрытие: state причины не переживает смену конфликта
  return (
    <OpenConflictDialog
      conflict={conflict}
      onOverride={onOverride}
      onCancel={onCancel}
    />
  )
}

function OpenConflictDialog({
  conflict,
  onOverride,
  onCancel,
}: ConflictDialogProps & { conflict: ConflictError }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [reason, setReason] = useState('')
  const reasonId = useId()

  // showModal — только через эффект (в рендере DOM-узла ещё нет);
  // guard по .open: StrictMode двойной прогон эффекта не должен кидать
  // InvalidStateError на уже открытом диалоге (Ловушка 7)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [])

  const trimmed = reason.trim()
  const reasonValid =
    trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${reasonId}-title`}
      // Escape: перехватываем keydown сами (работает и в jsdom, где нативный
      // cancel-путь <dialog> не эмулируется); preventDefault гасит нативное
      // закрытие — открытость управляется ТОЛЬКО пропом conflict
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      // нативный cancel-путь (на случай UA-закрытия мимо keydown)
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 id={`${reasonId}-title`}>Конфликт: {conflict.message}</h2>
      <ConflictList details={conflict.details} />
      <p>
        Это мягкий конфликт — продолжить можно, указав причину. Причина попадёт
        в аудит.
      </p>
      <label htmlFor={reasonId}>Причина (10–500 символов)</label>
      <textarea
        id={reasonId}
        value={reason}
        placeholder="Например: наряд сокращён по приказу №…"
        onChange={(event) => setReason(event.target.value)}
      />
      <div>
        {reason.length} / {REASON_MAX}
      </div>
      <button type="button" onClick={onCancel}>
        Отмена
      </button>
      <button
        type="button"
        disabled={!reasonValid}
        onClick={() => onOverride(trimmed)}
      >
        Подтвердить оверрайд
      </button>
    </dialog>
  )
}

/** details.conflicts[] конверта — unknown-типа: рендер строго defensive. */
function ConflictList({ details }: { details: Record<string, unknown> }) {
  const conflicts = Array.isArray(details.conflicts) ? details.conflicts : []
  if (conflicts.length === 0) return null
  return (
    <ul>
      {conflicts.map((item, index) => (
        <li key={index}>{conflictLabel(item)}</li>
      ))}
    </ul>
  )
}

function conflictLabel(item: unknown): string {
  if (typeof item === 'object' && item !== null) {
    const record = item as Record<string, unknown>
    const parts = [record.conflict_code, record.employee_id].filter(
      (value): value is string => typeof value === 'string',
    )
    if (parts.length > 0) return parts.join(' · ')
  }
  return JSON.stringify(item)
}
