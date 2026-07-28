// Карточка обращения (§28 detail): статус, рабочий приоритет, ответственный,
// публичный ответ, внутренняя заметка по праву, связанный экран, техническая
// информация, дубликат, закрытие, лента событий и аудит.
//
// ⚠️ Экран не знает ни одного условия доступности. Что можно сделать с
// обращением, в какие статусы оно может уйти и видна ли внутренняя заметка —
// приходит с сервера; здесь нет ни одной ветки «если закрыто — выключить»
// (тот же приём, что action policy месячного плана §21.28).
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import {
  useAddFeedbackComment,
  useCloseFeedback,
  useFeedbackDetail,
  useTriageFeedback,
} from '../api/queries'
import type { FeedbackActionCode, FeedbackEventKind, FeedbackStatusCode } from '../model/types'
import type { FeedbackAction } from '../model/types'

const EVENT_LABEL: Record<FeedbackEventKind, string> = {
  CREATED: 'Обращение заведено',
  SUBMITTED: 'Обращение отправлено',
  STATUS_CHANGED: 'Статус изменён',
  ASSIGNED: 'Ответственный изменён',
  WORKING_PRIORITY_SET: 'Рабочий приоритет изменён',
  PUBLIC_REPLY_ADDED: 'Добавлен ответ автору',
  INTERNAL_NOTE_ADDED: 'Добавлена внутренняя заметка',
  MARKED_DUPLICATE: 'Отмечено дубликатом',
  CLOSED: 'Обращение закрыто',
}

function formatMoment(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  return `${(bytes / 1024).toFixed(1)} КБ`
}

/** Действие ищется по коду в серверном списке. Отсутствующее действие
 * недоступно — «нет в ответе» и «запрещено» для экрана одно и то же. */
function actionOf(actions: readonly FeedbackAction[], code: FeedbackActionCode): FeedbackAction {
  return (
    actions.find((action) => action.code === code) ?? {
      code,
      available: false,
      reason: 'Действие недоступно.',
    }
  )
}

export function FeedbackDetailPage() {
  const params = useParams()
  const feedbackId = params.feedbackId ?? ''
  const detailQuery = useFeedbackDetail(feedbackId)
  const addComment = useAddFeedbackComment()
  const triage = useTriageFeedback()
  const close = useCloseFeedback()

  const [closingReply, setClosingReply] = useState('')
  const [closingStatus, setClosingStatus] = useState<string>('')
  const [duplicateOfId, setDuplicateOfId] = useState('')

  const data = detailQuery.data
  if (detailQuery.isError) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Обращение</h1>
        <p className="text-sm text-destructive">{detailQuery.error.message}</p>
        <Link className="text-sm font-semibold text-primary underline" to={ROUTES.feedback}>
          ← К реестру обращений
        </Link>
      </div>
    )
  }
  if (data === undefined) return <p className="text-sm text-muted-foreground">Загрузка…</p>

  const { request, registry } = data
  const labelOf = (kind: 'type' | 'priority' | 'status', code: string): string => {
    const source =
      kind === 'type'
        ? registry.types
        : kind === 'priority'
          ? registry.priorities
          : registry.statuses
    return source.find((entry) => entry.code === code)?.label ?? code
  }
  const moduleLabel =
    registry.modules.find((entry) => entry.moduleCode === request.moduleCode)?.label ??
    request.moduleCode

  const replyAction = actionOf(data.actions, 'ADD_PUBLIC_REPLY')
  const noteAction = actionOf(data.actions, 'ADD_INTERNAL_NOTE')
  const triageAction = actionOf(data.actions, 'TRIAGE')
  const closeAction = actionOf(data.actions, 'CLOSE')
  // Терминальные статусы отбираются из разрешённых сервером: экран не знает,
  // какие статусы закрывают обращение — это свойство справочника.
  const terminalChoices = data.allowedStatuses.filter((code) =>
    registry.terminalStatuses.includes(code),
  )
  const workflowChoices = data.allowedStatuses.filter(
    (code) => !registry.terminalStatuses.includes(code),
  )

  return (
    <div>
      <header className="mb-6">
        <Link className="text-sm font-semibold text-primary underline" to={ROUTES.feedback}>
          ← К реестру обращений
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{request.subject}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {labelOf('type', request.typeCode)} · {moduleLabel} · {request.authorLabel} ·{' '}
          {formatMoment(request.createdAt)}
        </p>
      </header>

      <section role="group" aria-label="Состояние обращения" className="mb-4 rounded-xl border bg-card p-4">
        <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Статус</dt>
            <dd data-testid="card-status">{labelOf('status', request.statusCode)}</dd>
          </div>
          <div>
            <dt className="font-semibold">Приоритет автора</dt>
            <dd>{labelOf('priority', request.priorityCode)}</dd>
          </div>
          <div>
            <dt className="font-semibold">Рабочий приоритет</dt>
            {/* §28 отличает рабочий приоритет от заявленного: пока разбора не
                было, приравнивать его к заявленному нельзя. */}
            <dd data-testid="card-working-priority">
              {request.workingPriorityCode === null
                ? 'не назначен — обращение ещё не разбирали'
                : labelOf('priority', request.workingPriorityCode)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Ответственный</dt>
            <dd data-testid="card-assignee">
              {request.assigneeLabel === null ? 'не назначен' : request.assigneeLabel}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Экран, о котором обращение</dt>
            <dd>{request.relatedRoute ?? 'не указан'}</dd>
          </div>
          <div>
            <dt className="font-semibold">Техническая информация</dt>
            <dd>
              {request.technicalInfo === null
                ? 'автор её не прикладывал'
                : `${request.technicalInfo.appRevision} · ${request.technicalInfo.viewport} · ${request.technicalInfo.platform}`}
            </dd>
          </div>
        </dl>

        {data.duplicateOf !== null && (
          <p className="mt-3 text-xs text-slate-600" data-testid="card-duplicate">
            Признано дубликатом обращения{' '}
            {data.duplicateOf.subject === null ? (
              <span>{data.duplicateOf.hiddenReason}</span>
            ) : (
              <Link
                className="font-semibold text-primary underline"
                to={ROUTES.feedbackDetailTo(data.duplicateOf.feedbackId)}
              >
                {data.duplicateOf.subject}
              </Link>
            )}
          </p>
        )}
      </section>

      <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Содержание обращения</h2>
        {request.restrictedReason !== null ? (
          <p className="text-xs text-slate-600">{request.restrictedReason}</p>
        ) : (
          <div className="flex flex-col gap-2 text-xs text-slate-600">
            <p>{request.description}</p>
            {request.expectedResult !== null && <p>Ожидаемый результат: {request.expectedResult}</p>}
            {request.reproductionSteps !== null && <p>Шаги: {request.reproductionSteps}</p>}
            {request.contact !== null && <p>Контакт: {request.contact}</p>}
            {request.attachments !== null && request.attachments.length > 0 && (
              <p>
                Вложения (метаданные):{' '}
                {request.attachments
                  .map((file) => `${file.fileName} · ${formatSize(file.sizeBytes)}`)
                  .join('; ')}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Переписка</h2>
        {data.comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">Комментариев пока нет.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.comments.map((comment) => (
              <li key={comment.commentId} className="rounded-lg border p-2">
                <p className="mb-1 text-[11px] font-bold text-slate-600">
                  {comment.kind === 'INTERNAL_NOTE' ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
                      Внутренняя заметка
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5">Ответ автору</span>
                  )}{' '}
                  {comment.authorLabel} · {formatMoment(comment.createdAt)}
                </p>
                <p className="text-xs text-slate-600">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        {/* Поля переписки — отдельный узел с `key` по числу комментариев:
            после успешной отправки список растёт, узел пересоздаётся и поля
            очищаются сами. Без setState в эффекте и без ручного сброса,
            который легко забыть на второй кнопке. */}
        <CommentForms
          key={data.comments.length}
          replyAction={replyAction}
          noteAvailable={noteAction.available}
          pending={addComment.isPending}
          errorMessage={addComment.error?.message ?? null}
          onSend={(kind, body) => addComment.mutate({ feedbackId, kind, body })}
        />
      </section>

      {triageAction.available && (
        <section role="group" aria-label="Разбор обращения" className="mb-4 rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Разбор</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Ответственный
              <select
                aria-label="Ответственный за обращение"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                defaultValue={request.assigneeUserId ?? ''}
                onChange={(event) =>
                  triage.mutate({
                    feedbackId,
                    assigneeUserId: event.target.value === '' ? null : event.target.value,
                  })
                }
              >
                <option value="">не назначен</option>
                {data.assigneeCandidates.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.safeLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Рабочий приоритет
              <select
                aria-label="Рабочий приоритет"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                defaultValue={request.workingPriorityCode ?? ''}
                onChange={(event) =>
                  triage.mutate({
                    feedbackId,
                    workingPriorityCode:
                      event.target.value === ''
                        ? null
                        : (event.target.value as typeof request.priorityCode),
                  })
                }
              >
                <option value="">не назначен</option>
                {registry.priorities.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Перевести в статус
              <select
                aria-label="Перевести в статус"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value=""
                onChange={(event) => {
                  if (event.target.value === '') return
                  triage.mutate({
                    feedbackId,
                    statusCode: event.target.value as FeedbackStatusCode,
                  })
                }}
              >
                <option value="">— выбрать —</option>
                {/* Список переходов приходит с сервера: экран не выводит его
                    из текущего статуса и не знает карты переходов. */}
                {workflowChoices.map((code) => (
                  <option key={code} value={code}>
                    {labelOf('status', code)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {workflowChoices.length === 0 && (
            <p className="mt-2 text-xs text-slate-600">
              Переходов из текущего статуса справочник не предусматривает.
            </p>
          )}
          {triage.error !== null && (
            <p className="mt-2 text-xs text-destructive">{triage.error.message}</p>
          )}
        </section>
      )}

      {closeAction.available && terminalChoices.length > 0 && (
        <section role="group" aria-label="Закрытие обращения" className="mb-4 rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Закрытие</h2>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Исход
              <select
                aria-label="Исход закрытия"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={closingStatus}
                onChange={(event) => setClosingStatus(event.target.value)}
              >
                <option value="">— выбрать —</option>
                {terminalChoices.map((code) => (
                  <option key={code} value={code}>
                    {labelOf('status', code)}
                  </option>
                ))}
              </select>
            </label>
            {closingStatus === 'DUPLICATE' && (
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                Обращение-оригинал
                <Input
                  aria-label="Идентификатор обращения-оригинала"
                  value={duplicateOfId}
                  onChange={(event) => setDuplicateOfId(event.target.value)}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Ответ автору при закрытии
              <textarea
                aria-label="Ответ автору при закрытии"
                className="min-h-16 rounded-md border bg-background p-2 text-sm"
                value={closingReply}
                onChange={(event) => setClosingReply(event.target.value)}
              />
            </label>
            <div>
              <Button
                size="sm"
                disabled={closingStatus === '' || closingReply.trim() === '' || close.isPending}
                onClick={() =>
                  close.mutate({
                    feedbackId,
                    statusCode: closingStatus as FeedbackStatusCode,
                    duplicateOfId: closingStatus === 'DUPLICATE' ? duplicateOfId : null,
                    publicReply: closingReply,
                  })
                }
              >
                Закрыть обращение
              </Button>
            </div>
            <p className="text-xs text-slate-600">
              Закрытие всегда сопровождается ответом автору: человек, написавший обращение, узнаёт
              причину, а не только новый статус.
            </p>
            {close.error !== null && (
              <p className="text-xs text-destructive">{close.error.message}</p>
            )}
          </div>
        </section>
      )}

      <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Лента событий и аудит</h2>
        <ol className="flex flex-col gap-2">
          {data.timeline.map((event) => (
            <li key={event.eventId} className="text-xs text-slate-600">
              <span className="font-semibold">{EVENT_LABEL[event.kind]}</span> ·{' '}
              {event.actorLabel} · {formatMoment(event.at)}
              {event.fieldCode !== null && (
                <span>
                  {' '}
                  · {event.fieldCode}: {event.oldValue ?? '—'} → {event.newValue ?? '—'}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-dashed bg-muted/30 p-4">
        <h2 className="mb-2 text-sm font-semibold">Чего карточка не показывает и почему</h2>
        <ul className="flex flex-col gap-2">
          {data.unavailableBlocks.map((item) => (
            <li key={item.code} className="text-xs text-slate-600">
              <span className="font-semibold">{item.label}</span> — {item.reason}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

interface CommentFormsProps {
  replyAction: FeedbackAction
  noteAvailable: boolean
  pending: boolean
  errorMessage: string | null
  onSend: (kind: 'PUBLIC_REPLY' | 'INTERNAL_NOTE', body: string) => void
}

function CommentForms(props: CommentFormsProps) {
  const [reply, setReply] = useState('')
  const [note, setNote] = useState('')

  return (
    <div className="mt-3 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
        Ответ автору
        <textarea
          aria-label="Ответ автору"
          className="min-h-16 rounded-md border bg-background p-2 text-sm"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
        />
      </label>
      <div>
        <Button
          size="sm"
          disabled={!props.replyAction.available || reply.trim() === '' || props.pending}
          title={props.replyAction.reason ?? undefined}
          onClick={() => props.onSend('PUBLIC_REPLY', reply)}
        >
          Отправить ответ
        </Button>
        {props.replyAction.reason !== null && (
          <p className="mt-1 text-xs text-slate-600">{props.replyAction.reason}</p>
        )}
      </div>

      {/* Поле внутренней заметки показывается только тому, кому доступно само
          действие: форма, которая всегда отвечает отказом, — не информация,
          а ловушка. */}
      {props.noteAvailable && (
        <>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Внутренняя заметка
            <textarea
              aria-label="Внутренняя заметка"
              className="min-h-16 rounded-md border bg-background p-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={note.trim() === '' || props.pending}
              onClick={() => props.onSend('INTERNAL_NOTE', note)}
            >
              Сохранить заметку
            </Button>
          </div>
        </>
      )}
      {props.errorMessage !== null && (
        <p className="text-xs text-destructive">{props.errorMessage}</p>
      )}
    </div>
  )
}
