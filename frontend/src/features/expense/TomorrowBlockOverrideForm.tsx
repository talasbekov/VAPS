// Story 10.5a — форма обхода блокировки «на завтра»: причина, ничего больше.
//
// Прямая копия по духу `features/daily-grid/DayAmendmentForm.tsx` (инлайн
// `<form>`, не модалка — модальность в jsdom не эмулируется, Решение №2
// стори 10.3/10.6). Отличие — ОДНО поле «Причина», без «Санкции»: обход не
// несёт дисциплинарного смысла amendment-флоу, это разрешение действия, не
// исправление задним числом.
//
// Почему НЕ `ConflictDialog`/`useApiMutation.conflict` (ARCH-FE-015):
// `TOMORROW_BLOCKED` — 422, не 409 overridable; обход — ОТДЕЛЬНЫЙ эндпоинт с
// ОТДЕЛЬНЫМ телом `{business_date, reason}`, не retry исходной мутации.
import { useId, useState } from 'react'

import { Button } from '../../shared/ui/Button'
import { Label } from '../../shared/ui/Label'
import { isOverrideReasonComplete } from './expense'

export interface TomorrowBlockOverrideFormProps {
  /** Дата, чью блокировку обходим, — названа в тексте дословно. */
  businessDate: string
  /** Отправка в полёте: блокирует кнопку. */
  isPending: boolean
  /** Причина уже обрезана `trim()` — вызывающий отправляет её как есть. */
  onSubmit: (reason: string) => void
  onCancel: () => void
}

const FORM_TITLE = 'Обход блокировки'
const CONFIRM_LABEL = 'Подтвердить обход'
const REASON_LABEL = 'Причина'

export function TomorrowBlockOverrideForm({
  businessDate,
  isPending,
  onSubmit,
  onCancel,
}: TomorrowBlockOverrideFormProps) {
  const reasonId = useId()
  const [reason, setReason] = useState('')

  const canSubmit = isOverrideReasonComplete(reason) && !isPending

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Дубль-гарда `if (!canSubmit) return` здесь СОЗНАТЕЛЬНО НЕТ — тот же
    // прецедент, что `DayAmendmentForm.handleSubmit`: владелец пути —
    // `disabled={!canSubmit}` на кнопке, implicit submission идёт через неё.
    onSubmit(reason.trim())
  }

  return (
    <form
      aria-label={FORM_TITLE}
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-input p-3 text-sm"
    >
      <p className="font-medium">Обойти блокировку на {businessDate}?</p>
      {/* Ревью-фикс (Edge Case Hunter): обход day-level, не per-division —
          снимает блок на ВЕСЬ день для ВСЕХ подразделений, не только для
          выбранного здесь. Без этой строки оператор мог бы прочитать кнопку
          как «разблокировать МОЁ подразделение». */}
      <p className="text-muted-foreground">
        Обход снимает блокировку на весь день целиком, для ВСЕХ подразделений
        — не только для выбранного здесь.
      </p>

      <div className="flex flex-col gap-1">
        <Label htmlFor={reasonId}>{REASON_LABEL}</Label>
        <textarea
          id={reasonId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {CONFIRM_LABEL}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  )
}
