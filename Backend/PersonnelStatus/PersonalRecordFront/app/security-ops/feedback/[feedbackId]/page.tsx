"use client";

// Карточка обращения (§28 detail): статус, рабочий приоритет, ответственный,
// публичный ответ, внутренняя заметка, дубликат, закрытие, лента и аудит.
// Экран не знает ни одного условия доступности: что можно сделать и в какие
// статусы уйти — приходит с сервера.
import { useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MessageSquareText } from "lucide-react";
import {
  useAddFeedbackComment,
  useCloseFeedback,
  useFeedbackDetail,
  useTriageFeedback,
} from "@/hooks/use-ops-feedback";
import type {
  FeedbackAction,
  FeedbackActionCode,
  FeedbackEventKind,
  FeedbackStatusCode,
} from "@/entities/ops-feedback";

const EVENT_LABEL: Record<FeedbackEventKind, string> = {
  CREATED: "Обращение заведено",
  SUBMITTED: "Обращение отправлено",
  STATUS_CHANGED: "Статус изменён",
  ASSIGNED: "Ответственный изменён",
  WORKING_PRIORITY_SET: "Рабочий приоритет изменён",
  PUBLIC_REPLY_ADDED: "Добавлен ответ автору",
  INTERNAL_NOTE_ADDED: "Добавлена внутренняя заметка",
  MARKED_DUPLICATE: "Отмечено дубликатом",
  CLOSED: "Обращение закрыто",
};

function formatMoment(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

/** Отсутствующее в серверном списке действие недоступно. */
function actionOf(
  actions: readonly FeedbackAction[],
  code: FeedbackActionCode
): FeedbackAction {
  return (
    actions.find((action) => action.code === code) ?? {
      code,
      available: false,
      reason: "Действие недоступно.",
    }
  );
}

export default function FeedbackDetailPage() {
  const params = useParams<{ feedbackId: string }>();
  const feedbackId = params.feedbackId ?? "";
  // Модуль живёт по ДВУМ адресам (/feedback и /security-ops/feedback — одна
  // страница, см. app/feedback/): реестр и соседние карточки адресуются от
  // текущего пути, а не от жёсткого префикса раздела.
  const pathname = usePathname();
  const registryPath =
    pathname.replace(/\/+$/, "").split("/").slice(0, -1).join("/") ||
    "/security-ops/feedback";
  const detailQuery = useFeedbackDetail(feedbackId);
  const addComment = useAddFeedbackComment();
  const triage = useTriageFeedback();
  const close = useCloseFeedback();

  const [closingReply, setClosingReply] = useState("");
  const [closingStatus, setClosingStatus] = useState<string>("");
  const [duplicateOfId, setDuplicateOfId] = useState("");

  const data = detailQuery.data;
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  // Тот же код, что у реестра обращений. Без гварда карточка по прямой ссылке
  // печатала 403 сырым текстом сервера в ветке detailQuery.isError.
  if (!permissionsLoading && !hasPermission("feedback.view")) {
    return <OpsAccessDenied what="обращения" />;
  }

  if (detailQuery.isError) {
    return (
      <DashboardLayout>
        <div className="space-y-3">
          <h1 className="text-2xl font-bold">Обращение</h1>
          <p className="text-sm text-destructive">{detailQuery.error.message}</p>
          <Link
            className="text-sm font-semibold text-primary underline"
            href={registryPath}
          >
            ← К реестру обращений
          </Link>
        </div>
      </DashboardLayout>
    );
  }
  if (data === undefined) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </DashboardLayout>
    );
  }

  const { request, registry } = data;
  const labelOf = (kind: "type" | "priority" | "status", code: string): string => {
    const source =
      kind === "type"
        ? registry.types
        : kind === "priority"
          ? registry.priorities
          : registry.statuses;
    return source.find((entry) => entry.code === code)?.label ?? code;
  };
  const moduleLabel =
    registry.modules.find((entry) => entry.moduleCode === request.moduleCode)?.label ??
    request.moduleCode;

  const replyAction = actionOf(data.actions, "ADD_PUBLIC_REPLY");
  const noteAction = actionOf(data.actions, "ADD_INTERNAL_NOTE");
  const triageAction = actionOf(data.actions, "TRIAGE");
  const closeAction = actionOf(data.actions, "CLOSE");
  // Терминальные исходы отбираются из разрешённых СЕРВЕРОМ переходов.
  const terminalChoices = data.allowedStatuses.filter((code) =>
    registry.terminalStatuses.includes(code)
  );
  const workflowChoices = data.allowedStatuses.filter(
    (code) => !registry.terminalStatuses.includes(code)
  );

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <MessageSquareText className="h-8 w-8 text-primary" />
          <div>
            <Link
              className="text-sm font-semibold text-primary underline"
              href={registryPath}
            >
              ← К реестру обращений
            </Link>
            <h1 className="text-2xl font-bold">{request.subject}</h1>
            <p className="text-muted-foreground">
              {labelOf("type", request.typeCode)} · {moduleLabel} ·{" "}
              {request.authorLabel} · {formatMoment(request.createdAt)}
            </p>
          </div>
        </div>

        <section
          role="group"
          aria-label="Состояние обращения"
          className="rounded-xl border bg-card p-4"
        >
          <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-foreground">Статус</dt>
              <dd>{labelOf("status", request.statusCode)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Приоритет автора</dt>
              <dd>{labelOf("priority", request.priorityCode)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Рабочий приоритет</dt>
              {/* Пока разбора не было — не копия заявленного. */}
              <dd>
                {request.workingPriorityCode === null
                  ? "не назначен — обращение ещё не разбирали"
                  : labelOf("priority", request.workingPriorityCode)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Ответственный</dt>
              <dd>
                {request.assigneeLabel === null ? "не назначен" : request.assigneeLabel}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">
                Экран, о котором обращение
              </dt>
              <dd>{request.relatedRoute ?? "не указан"}</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">
                Техническая информация
              </dt>
              <dd>
                {request.technicalInfo === null
                  ? "автор её не прикладывал"
                  : `${request.technicalInfo.appRevision} · ${request.technicalInfo.viewport} · ${request.technicalInfo.platform}`}
              </dd>
            </div>
          </dl>

          {data.duplicateOf !== null && (
            <p className="mt-3 text-xs text-muted-foreground">
              Признано дубликатом обращения{" "}
              {data.duplicateOf.subject === null ? (
                <span>{data.duplicateOf.hiddenReason}</span>
              ) : (
                <Link
                  className="font-semibold text-primary underline"
                  href={`${registryPath}/${data.duplicateOf.feedbackId}`}
                >
                  {data.duplicateOf.subject}
                </Link>
              )}
            </p>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Содержание обращения</h2>
          {request.restrictedReason !== null ? (
            <p className="text-xs text-muted-foreground">{request.restrictedReason}</p>
          ) : (
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <p>{request.description}</p>
              {request.expectedResult !== null && (
                <p>Ожидаемый результат: {request.expectedResult}</p>
              )}
              {request.reproductionSteps !== null && (
                <p>Шаги: {request.reproductionSteps}</p>
              )}
              {request.contact !== null && <p>Контакт: {request.contact}</p>}
              {request.attachments !== null && request.attachments.length > 0 && (
                <p>
                  Вложения (метаданные):{" "}
                  {request.attachments
                    .map((file) => `${file.fileName} · ${formatSize(file.sizeBytes)}`)
                    .join("; ")}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Переписка</h2>
          {data.comments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Комментариев пока нет.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.comments.map((comment) => (
                <li key={comment.commentId} className="rounded-lg border p-2">
                  <p className="mb-1 text-[11px] font-bold text-muted-foreground">
                    {comment.kind === "INTERNAL_NOTE" ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
                        Внутренняя заметка
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5">
                        Ответ автору
                      </span>
                    )}{" "}
                    {comment.authorLabel} · {formatMoment(comment.createdAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}

          {/* key по числу комментариев: после успешной отправки узел
              пересоздаётся и поля очищаются сами. */}
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
          <section
            role="group"
            aria-label="Разбор обращения"
            className="rounded-xl border bg-card p-4"
          >
            <h2 className="mb-2 text-sm font-semibold">Разбор</h2>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Ответственный
                <select
                  aria-label="Ответственный за обращение"
                  className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
                  defaultValue={request.assigneeUserId ?? ""}
                  onChange={(event) =>
                    triage.mutate({
                      feedbackId,
                      assigneeUserId:
                        event.target.value === "" ? null : event.target.value,
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
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Рабочий приоритет
                <select
                  aria-label="Рабочий приоритет"
                  className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
                  defaultValue={request.workingPriorityCode ?? ""}
                  onChange={(event) =>
                    triage.mutate({
                      feedbackId,
                      workingPriorityCode:
                        event.target.value === "" ? null : event.target.value,
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
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Перевести в статус
                <select
                  aria-label="Перевести в статус"
                  className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
                  value=""
                  onChange={(event) => {
                    if (event.target.value === "") return;
                    triage.mutate({ feedbackId, statusCode: event.target.value });
                  }}
                >
                  <option value="">— выбрать —</option>
                  {/* Переходы приходят с сервера: экран карты не знает. */}
                  {workflowChoices.map((code) => (
                    <option key={code} value={code}>
                      {labelOf("status", code)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {workflowChoices.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Переходов из текущего статуса справочник не предусматривает.
              </p>
            )}
            {triage.error !== null && (
              <p className="mt-2 text-xs text-destructive">{triage.error.message}</p>
            )}
          </section>
        )}

        {closeAction.available && terminalChoices.length > 0 && (
          <section
            role="group"
            aria-label="Закрытие обращения"
            className="rounded-xl border bg-card p-4"
          >
            <h2 className="mb-2 text-sm font-semibold">Закрытие</h2>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Исход
                <select
                  aria-label="Исход закрытия"
                  className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
                  value={closingStatus}
                  onChange={(event) => setClosingStatus(event.target.value)}
                >
                  <option value="">— выбрать —</option>
                  {terminalChoices.map((code) => (
                    <option key={code} value={code}>
                      {labelOf("status", code)}
                    </option>
                  ))}
                </select>
              </label>
              {closingStatus === "DUPLICATE" && (
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Обращение-оригинал
                  <input
                    aria-label="Идентификатор обращения-оригинала"
                    className="rounded-md border bg-background p-2 text-sm font-normal"
                    value={duplicateOfId}
                    onChange={(event) => setDuplicateOfId(event.target.value)}
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Ответ автору при закрытии
                <textarea
                  aria-label="Ответ автору при закрытии"
                  className="min-h-16 rounded-md border bg-background p-2 text-sm font-normal"
                  value={closingReply}
                  onChange={(event) => setClosingReply(event.target.value)}
                />
              </label>
              <div>
                <button
                  type="button"
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  disabled={
                    closingStatus === "" || closingReply.trim() === "" || close.isPending
                  }
                  onClick={() =>
                    close.mutate({
                      feedbackId,
                      statusCode: closingStatus as FeedbackStatusCode,
                      duplicateOfId: closingStatus === "DUPLICATE" ? duplicateOfId : null,
                      publicReply: closingReply,
                    })
                  }
                >
                  Закрыть обращение
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Закрытие всегда сопровождается ответом автору: человек, написавший
                обращение, узнаёт причину, а не только новый статус.
              </p>
              {close.error !== null && (
                <p className="text-xs text-destructive">{close.error.message}</p>
              )}
            </div>
          </section>
        )}

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Лента событий и аудит</h2>
          <ol className="flex flex-col gap-2">
            {data.timeline.map((event) => (
              <li key={event.eventId} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {EVENT_LABEL[event.kind]}
                </span>{" "}
                · {event.actorLabel} · {formatMoment(event.at)}
                {event.fieldCode !== null && (
                  <span>
                    {" "}
                    · {event.fieldCode}: {event.oldValue ?? "—"} →{" "}
                    {event.newValue ?? "—"}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-xl border border-dashed bg-muted/30 p-4">
          <h2 className="mb-2 text-sm font-semibold">
            Чего карточка не показывает и почему
          </h2>
          <ul className="flex flex-col gap-2">
            {data.unavailableBlocks.map((item) => (
              <li key={item.code} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{item.label}</span> —{" "}
                {item.reason}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </DashboardLayout>
  );
}

interface CommentFormsProps {
  replyAction: FeedbackAction;
  noteAvailable: boolean;
  pending: boolean;
  errorMessage: string | null;
  onSend: (kind: "PUBLIC_REPLY" | "INTERNAL_NOTE", body: string) => void;
}

function CommentForms(props: CommentFormsProps) {
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="mt-3 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Ответ автору
        <textarea
          aria-label="Ответ автору"
          className="min-h-16 rounded-md border bg-background p-2 text-sm font-normal"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
        />
      </label>
      <div>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={!props.replyAction.available || reply.trim() === "" || props.pending}
          title={props.replyAction.reason ?? undefined}
          onClick={() => props.onSend("PUBLIC_REPLY", reply)}
        >
          Отправить ответ
        </button>
        {props.replyAction.reason !== null && (
          <p className="mt-1 text-xs text-muted-foreground">
            {props.replyAction.reason}
          </p>
        )}
      </div>

      {/* Поле внутренней заметки — только тому, кому доступно само действие:
          форма, которая всегда отвечает отказом, — ловушка. */}
      {props.noteAvailable && (
        <>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Внутренняя заметка
            <textarea
              aria-label="Внутренняя заметка"
              className="min-h-16 rounded-md border bg-background p-2 text-sm font-normal"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={note.trim() === "" || props.pending}
              onClick={() => props.onSend("INTERNAL_NOTE", note)}
            >
              Сохранить заметку
            </button>
          </div>
        </>
      )}
      {props.errorMessage !== null && (
        <p className="text-xs text-destructive">{props.errorMessage}</p>
      )}
    </div>
  );
}
