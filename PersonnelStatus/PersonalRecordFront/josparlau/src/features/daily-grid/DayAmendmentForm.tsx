// Story 10.6 — форма исправления сдачи: причина + санкция.
//
// Почему ИНЛАЙН-панель, а не модалка (Решение №2, прецедент — Решение №5 стори
// 10.3): модальность в jsdom не эмулируется, и модальный ассерт был бы
// вакуумным до e2e 10.10.
//
// Почему НЕ `ConflictDialog` (Решение №3): amendment — не override-путь.
// `DAY_ALREADY_SUBMITTED` нет в `OVERRIDABLE_CODES` ⇒ `useApiMutation.conflict`
// по нему не поднимется и диалог физически не откроется; да и тело здесь
// `{reason, sanction}`, а не `{override, override_reason}`. ARCH-FE-015
// запрещает СВОИ override-диалоги, но не запрещает форму причины на своём пути
// (прецедент — 10.5a).
//
// Почему настоящий `<form>` с `type="submit"`: без него `Enter` не отправляет
// НИЧЕГО — у панели-прецедента все кнопки `type="button"` и формы нет
// (`DaySubmissionPanel.tsx:267,303,311`), поэтому клавиатурный путь NFR-8
// (AC-7) там был бы недостижим.
import { useId, useState } from 'react'

import { Button } from '../../shared/ui/Button'
import { Input } from '../../shared/ui/Input'
import { Label } from '../../shared/ui/Label'
import { isAmendmentComplete, SANCTION_MAX } from './amendment'
import type { DayAmendBody } from './amendment'

export interface DayAmendmentFormProps {
  /** День, который правим, — назван в подтверждении дословно. */
  businessDate: string
  /** Отправка в полёте: блокирует кнопку (вторая половина гарда AC-3). */
  isPending: boolean
  /** Тело уже обрезано `trim()` — панель отправляет его как есть. */
  onSubmit: (body: DayAmendBody) => void
  onCancel: () => void
}

/** Канон-строки формы (открытый вопрос №1 стори — к утверждению Bratan). */
const FORM_TITLE = 'Исправление сдачи'
const CONFIRM_LABEL = 'Подтвердить исправление'
const REASON_LABEL = 'Причина'
const SANCTION_LABEL = 'Санкция'

export function DayAmendmentForm({
  businessDate,
  isPending,
  onSubmit,
  onCancel,
}: DayAmendmentFormProps) {
  const reasonId = useId()
  const sanctionId = useId()
  const counterId = useId()
  const [reason, setReason] = useState('')
  const [sanction, setSanction] = useState('')

  const complete = isAmendmentComplete(reason, sanction)
  const canSubmit = complete && !isPending

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // ⚠️ Дубль-гарда `if (!canSubmit) return` здесь СОЗНАТЕЛЬНО НЕТ (ревью
    // 10.6, наблюдение Б QA-прогона): владелец пути — `disabled={!canSubmit}`
    // на кнопке. Implicit submission и в chromium, и в user-event идёт ЧЕРЕЗ
    // кнопку по умолчанию (проверено браузерными пробами M9/#4), поэтому до
    // сюда незаконная отправка не доезжает. Пока гард стоял в обоих местах,
    // они взаимно перекрывались и НИ ОДИН не краснел от точечной мутации —
    // тот же класс вакуумной пары, что Отклонение 1 (гард isPending).
    onSubmit({ reason: reason.trim(), sanction: sanction.trim() })
  }

  return (
    <form
      aria-label={FORM_TITLE}
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-input p-3 text-sm"
    >
      <p className="font-medium">Исправить сдачу за {businessDate}?</p>
      {/* Границу называем честно: прочие ретро-правки (update_status,
          complete_status_early, extend_status, cancel_status, увольнение)
          amendment НЕ триггерят — осознанный скоуп 5.4b. Копия вида «любая
          правка задним числом создаст исправление» была бы ложью. */}
      <p className="text-muted-foreground">
        Появится новая версия дня; прежняя останется в истории с автором,
        временем и основанием.
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

      <div className="flex flex-col gap-1">
        <Label htmlFor={sanctionId}>{SANCTION_LABEL}</Label>
        <Input
          id={sanctionId}
          type="text"
          value={sanction}
          onChange={(event) => setSanction(event.target.value)}
          // Зеркало CharField(max_length=255). Предел на поле делает случай
          // «256 символов» в компоненте НЕдостижимым — поэтому он живёт в
          // юнит-тесте валидатора, а не здесь (иначе тест был бы мёртвым).
          maxLength={SANCTION_MAX}
          aria-describedby={counterId}
        />
        {/* Счётчик — не только цвет/длина поля: предел назван числом
            (DESIGN.md:366,371 — состояние словами, а не сигналом). */}
        <span
          id={counterId}
          data-testid="sanction-counter"
          className="text-xs text-muted-foreground"
        >
          {sanction.length}/{SANCTION_MAX}
        </span>
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
