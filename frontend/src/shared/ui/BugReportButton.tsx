// Story 13.1b — «сообщить о проблеме», стоимость ~0. shared/ui, не
// features/ (ARCH-FE-013, тот же довод, что AppFooter/AppLayout.tsx): один
// компонент на каждый экран портала, живёт в шапке рядом с NotificationBell
// (тот же прецедент — shared/ui-компонент со своим useApiMutation/apiClient
// напрямую, легально здесь).
//
// Headless-модалка: <dialog>+showModal(), прямая копия структуры
// ConflictDialog.tsx (единственный модальный примитив в проекте) — НЕ
// изобретать новый. Валидация — только непустой текст (trim), НЕ
// REASON_MIN/MAX ConflictDialog: та длина специфична конфликт-оверрайду
// (BR-003), буква 13.1 не требует минимума.
import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { MessageSquareWarning } from 'lucide-react'
import { apiClient } from '../api/client'
import { useApiMutation } from '../api/useApiMutation'
import { getRecentRequestIds } from '../api/recentRequestIds'
import { NetworkError, ServerError } from '../api/errors'
import type { components } from '../api/schema'
import { APP_VERSION, BUILD_SHA } from '../version'
import { useToast } from './toast'
import { Button } from './Button'

type BugReportCreatePayload = components['schemas']['BugReportCreateRequest'] &
  Record<string, unknown>
type BugReportCreateResponse = components['schemas']['BugReport']

export function BugReportButton() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { toast } = useToast()
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const [description, setDescription] = useState('')
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  const mutation = useApiMutation<
    BugReportCreateResponse,
    BugReportCreatePayload
  >({
    mutationFn: (variables) =>
      apiClient.post<BugReportCreateResponse>('/api/bugreports/', variables),
    onSuccess: () => {
      toast('Спасибо, репорт отправлен.')
      setDescription('')
      setOpen(false)
    },
  })

  // No `else { dialog.close() }` branch: `open=false` unmounts the whole
  // `<dialog>` subtree (conditional render below), which destroys the
  // native element outright — there is never a "React thinks closed, DOM
  // still open" state to reconcile. Same pattern as ConflictDialog.tsx
  // (review: Edge Case Hunter flagged this as fragile IF a future refactor
  // switches to keep-mounted+CSS-hidden instead of conditional unmount —
  // note left here so that refactor doesn't quietly reintroduce the gap).
  useEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [open])

  function closeDialog() {
    setOpen(false)
    mutation.reset()
  }

  const trimmed = description.trim()

  function submit() {
    if (trimmed === '') return
    mutation.mutate({
      screen_path: location.pathname,
      app_version: APP_VERSION,
      build_sha: BUILD_SHA,
      last_request_ids: getRecentRequestIds(),
      description: trimmed,
    })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-label="Сообщить о проблеме"
        onClick={() => setOpen(true)}
      >
        <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && (
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeDialog()
            }
          }}
          onCancel={(event) => {
            event.preventDefault()
            closeDialog()
          }}
        >
          <h2 id={titleId}>Сообщить о проблеме</h2>
          <p>
            Экран, версия приложения и последние запросы прикладываются
            автоматически — просто опишите, что произошло.
          </p>
          <label htmlFor={descriptionId}>Что произошло</label>
          <textarea
            id={descriptionId}
            value={description}
            placeholder="Например: кнопка «Сдать день» не реагирует на клик."
            onChange={(event) => setDescription(event.target.value)}
            aria-describedby={
              mutation.error &&
              !(mutation.error instanceof ServerError) &&
              !(mutation.error instanceof NetworkError)
                ? errorId
                : undefined
            }
            aria-invalid={
              mutation.error &&
              !(mutation.error instanceof ServerError) &&
              !(mutation.error instanceof NetworkError)
                ? true
                : undefined
            }
          />
          {/* Review (Blind Hunter): useApiMutation's onError already fires a
              GLOBAL toast for ServerError/NetworkError — rendering an inline
              alert too would say the same thing twice, in two different
              wordings. Inline alert only for the remaining error shapes
              (e.g. 400/403), which the mutation hook does NOT toast. */}
          {mutation.error &&
            !(mutation.error instanceof ServerError) &&
            !(mutation.error instanceof NetworkError) && (
              <p id={errorId} role="alert">
                Не удалось отправить репорт. Текст сохранён — попробуйте ещё
                раз.
              </p>
            )}
          <button type="button" onClick={closeDialog}>
            Отмена
          </button>
          <button
            type="button"
            disabled={trimmed === '' || mutation.isPending}
            onClick={submit}
          >
            Отправить
          </button>
        </dialog>
      )}
    </>
  )
}
