"use client";

// Рабочее пространство оценивания (§19.14): очередь заданий, форма оценки и
// сводка мероприятия. Экран не создаёт заданий и не придумывает значений:
// начальная оценка, перечень оснований, состав очереди и счётчики приходят
// готовыми. Оценок, полученных смотрящим от других, здесь нет — их не отдаёт
// сервер.
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { ClipboardCheck } from "lucide-react";
import {
  useEvaluationWorkspace,
  useSubmitEvaluation,
} from "@/hooks/use-ops-ratings";
import { RatingsNav } from "@/features/ops-ratings/ratings-nav";
import { RatingNotificationsSection } from "@/features/ops-ratings/rating-notifications-section";
import { SubmittedEvaluationCard } from "@/features/ops-ratings/submitted-evaluation-card";
import { EvaluationConflictNotice } from "@/features/ops-ratings/evaluation-conflict-notice";
import {
  DIRECTION_LABEL,
  RATING_DEFAULT_SCORE,
  RATING_SCALE_MAX,
  RATING_SCALE_MIN,
  newIdempotencyKey,
  validateSubmission,
} from "@/entities/operational-rating";
import type {
  EvaluationBasis,
  EvaluationWorkItemView,
  SubmissionField,
  SubmissionViolation,
  SubmittedEvaluationView,
} from "@/entities/operational-rating";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

type TabKey = "pending" | "submitted" | "progress";

const TAB_LABEL: Record<TabKey, string> = {
  pending: "Мне нужно оценить",
  submitted: "Отправленные мной",
  progress: "Сводка мероприятия",
};

/** Шкала §19.9: 1…10 — нуля в ней нет. */
const SCALE = Array.from(
  { length: RATING_SCALE_MAX - RATING_SCALE_MIN + 1 },
  (_value, index) => RATING_SCALE_MIN + index
);

function dateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

/** Ошибка сервера ставится рядом с тем же полем, что и клиентская, ПО КОДУ. */
const SERVER_ERROR_FIELD: Record<string, SubmissionField> = {
  SCORE_OUT_OF_SCALE: "score",
  SCORE_NOT_INTEGER: "score",
  BASIS_REQUIRED: "basisCode",
  BASIS_UNKNOWN: "basisCode",
  BASIS_NOTE_REQUIRED: "basisNote",
  COMMENT_REQUIRED: "comment",
};

interface FormProps {
  item: EvaluationWorkItemView;
  bases: EvaluationBasis[];
  onClose: () => void;
}

function EvaluationForm({ item, bases, onClose }: FormProps) {
  const queryClient = useQueryClient();
  // Начальное значение приходит из ЗАДАНИЯ (§19.8) — не константа формы.
  const [score, setScore] = useState(item.initialScore);
  const [basisCode, setBasisCode] = useState("");
  const [basisNote, setBasisNote] = useState("");
  const [comment, setComment] = useState("");
  const [violation, setViolation] = useState<SubmissionViolation | null>(null);
  // Ключ рождается вместе с формой и переживает повторные отправки (§19.26).
  const [idempotencyKey] = useState(newIdempotencyKey);

  const mutation = useSubmitEvaluation(item.id, () => {
    onClose();
  });

  const selectedBasis = bases.find((basis) => basis.code === basisCode);
  const serverErrorCode =
    mutation.error !== null && "errorCode" in mutation.error
      ? mutation.error.errorCode
      : null;
  const serverFieldRaw =
    serverErrorCode === null
      ? null
      : (SERVER_ERROR_FIELD[serverErrorCode] ?? null);
  // Отказ, адресованный скрытому полю пояснения, печатается общим сообщением.
  const serverField =
    serverFieldRaw === "basisNote" && selectedBasis?.requiresNote !== true
      ? null
      : serverFieldRaw;

  function errorFor(field: SubmissionField): string | null {
    if (violation !== null && violation.field === field) return violation.message;
    if (serverField === field && mutation.error !== null)
      return mutation.error.message;
    return null;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = {
      score,
      basisCode: basisCode === "" ? null : basisCode,
      basisNote: basisNote === "" ? null : basisNote,
      comment: comment === "" ? null : comment,
    };
    // §19.9: форма не отправляется до прохождения проверки; тот же вызов
    // делает мок-сервер на своих данных — правило одно на двоих.
    const found = validateSubmission(input, bases);
    setViolation(found);
    if (found !== null) return;
    mutation.mutate({ ...input, revision: item.revision, idempotencyKey });
  }

  return (
    <form
      className="mt-3 rounded-lg border bg-background p-3"
      onSubmit={submit}
      noValidate
    >
      <div className="mb-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <span>Пост или роль: {item.postLabel}</span>
        <span>Направление: {DIRECTION_LABEL[item.evaluationDirection]}</span>
        <span>
          Фактический интервал: {dateTime(item.actualStartsAt)} —{" "}
          {dateTime(item.actualEndsAt)}
        </span>
        <span>
          Факт участия: {item.participated ? "участвовал" : "не участвовал"}
        </span>
        <span>Начальная оценка: {item.initialScore}</span>
      </div>

      <label
        className="mb-1 block text-xs font-semibold"
        htmlFor={`score-${item.id}`}
      >
        Оценка
      </label>
      <select
        id={`score-${item.id}`}
        className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
        value={score}
        onChange={(event) => setScore(Number(event.target.value))}
      >
        {SCALE.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      {errorFor("score") !== null && (
        <p className="mb-2 text-xs text-destructive">{errorFor("score")}</p>
      )}

      <label
        className="mb-1 block text-xs font-semibold"
        htmlFor={`basis-${item.id}`}
      >
        Основание
      </label>
      <select
        id={`basis-${item.id}`}
        className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
        value={basisCode}
        onChange={(event) => setBasisCode(event.target.value)}
      >
        <option value="">— выберите основание —</option>
        {bases.map((basis) => (
          <option key={basis.code} value={basis.code}>
            {basis.label}
          </option>
        ))}
      </select>
      {errorFor("basisCode") !== null && (
        <p className="mb-2 text-xs text-destructive">{errorFor("basisCode")}</p>
      )}

      {selectedBasis?.requiresNote === true && (
        <>
          <label
            className="mb-1 block text-xs font-semibold"
            htmlFor={`basis-note-${item.id}`}
          >
            Пояснение к основанию
          </label>
          <input
            id={`basis-note-${item.id}`}
            className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
            value={basisNote}
            onChange={(event) => setBasisNote(event.target.value)}
          />
          {errorFor("basisNote") !== null && (
            <p className="mb-2 text-xs text-destructive">
              {errorFor("basisNote")}
            </p>
          )}
        </>
      )}

      <label
        className="mb-1 block text-xs font-semibold"
        htmlFor={`comment-${item.id}`}
      >
        Комментарий
        {score < RATING_DEFAULT_SCORE && " (обязателен)"}
      </label>
      <textarea
        id={`comment-${item.id}`}
        className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
        rows={3}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      {errorFor("comment") !== null && (
        <p className="mb-2 text-xs text-destructive">{errorFor("comment")}</p>
      )}

      {/* Конфликт редакции и неизвестный исход — СВОЯ панель рядом с формой
          (§19.25): введённый текст не стирается, ConflictDialog назначений
          здесь запрещён прямо. */}
      <EvaluationConflictNotice
        error={mutation.error}
        attempted={{
          score,
          basisLabel: selectedBasis?.label ?? null,
          comment: comment === "" ? null : comment,
        }}
        onRecheck={() => {
          void queryClient.invalidateQueries({ queryKey: ["ops-ratings"] });
        }}
      />
      {mutation.error !== null &&
        serverField === null &&
        mutation.error.kind !== "network" && (
          <p className="mb-2 text-xs text-destructive">
            {mutation.error.message}
          </p>
        )}

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          disabled={mutation.isPending}
        >
          Отправить оценку
        </button>
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm"
          onClick={onClose}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

export default function EvaluationWorkspacePage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event");
  const [tab, setTab] = useState<TabKey>("pending");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  // Карточка отправленной оценки открывается ОТДЕЛЬНЫМ запросом (§19.18 шаг 3).
  const [openSubmittedId, setOpenSubmittedId] = useState<string | null>(null);
  const query = useEvaluationWorkspace(eventId);
  const data = query.data;

  const tabs: TabKey[] =
    data?.eventProgress != null
      ? ["pending", "submitted", "progress"]
      : ["pending", "submitted"];
  const activeTab = tabs.includes(tab) ? tab : "pending";

  if (!permissionsLoading && !hasPermission("rating.evaluate")) {
    return <OpsAccessDenied what="рабочего места оценивания" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Оценивание участников</h1>
            <p className="text-muted-foreground">
              Задания на оценивание формирует сервер. Оценки, полученные вами от
              других лиц, здесь не показываются и не запрашиваются.
            </p>
          </div>
        </div>

        <RatingsNav />

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка заданий…</p>
        )}
        {query.error !== null && (
          <p className="text-sm text-destructive">{query.error.message}</p>
        )}

        {data !== undefined && (
          <>
            {data.unavailableReason === "FEATURE_DISABLED" && (
              <p className="rounded-xl border bg-card p-4 text-sm">
                Оценивание выключено сервером (ENABLE_OPERATIONAL_RATINGS).
                Заданий нет не потому, что работа выполнена, — функция не
                работает целиком.
              </p>
            )}

            {/* §19.28: уведомления адресованы человеку и живут там, где он
                работает, — над очередью. */}
            <RatingNotificationsSection />

            {data.events.length > 1 && (
              <label
                className="block text-xs font-semibold"
                htmlFor="workspace-event"
              >
                Мероприятие
                <select
                  id="workspace-event"
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={data.selectedEvent?.securityEventId ?? ""}
                  onChange={(event) => {
                    setOpenItemId(null);
                    router.replace(
                      `${pathname}?event=${encodeURIComponent(event.target.value)}`
                    );
                  }}
                >
                  {data.events.map((event) => (
                    <option
                      key={event.securityEventId}
                      value={event.securityEventId}
                    >
                      {event.number} — {event.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {data.selectedEvent !== null && (
              <section
                className="rounded-xl border bg-card p-4"
                aria-label="Мероприятие"
              >
                <h2 className="mb-2 text-sm font-semibold">
                  {data.selectedEvent.number} — {data.selectedEvent.title}
                </h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr_auto_1fr]">
                  <dt className="font-semibold">Объект</dt>
                  <dd>{data.selectedEvent.objectLabel}</dd>
                  <dt className="font-semibold">Состояние</dt>
                  <dd>{data.selectedEvent.stateLabel}</dd>
                  <dt className="font-semibold">Фактическое начало</dt>
                  <dd>{dateTime(data.selectedEvent.actualStartsAt)}</dd>
                  <dt className="font-semibold">Фактическое завершение</dt>
                  <dd>{dateTime(data.selectedEvent.actualEndsAt)}</dd>
                  {/* Счётчики шапки — МОИ задания. Работа других оценщиков —
                      во вкладке «Сводка мероприятия». */}
                  <dt className="font-semibold">Моих заданий</dt>
                  <dd>{data.queue.total}</dd>
                  <dt className="font-semibold">Отправлено мной</dt>
                  <dd>{data.queue.submitted}</dd>
                  <dt className="font-semibold">Осталось мне</dt>
                  <dd>{data.queue.remaining}</dd>
                  <dt className="font-semibold">Методика</dt>
                  <dd className="font-mono">
                    {data.policy?.policyVersion ?? "не определена"}
                  </dd>
                  <dt className="font-semibold">Синхронизация</dt>
                  <dd>
                    {query.isFetching
                      ? "Обновление…"
                      : `Данные на ${dateTime(data.loadedAt)}`}
                  </dd>
                </dl>
              </section>
            )}

            <div
              className="flex gap-2"
              role="tablist"
              aria-label="Разделы оценивания"
            >
              {tabs.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === key}
                  className={
                    activeTab === key
                      ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                      : "rounded-md border px-3 py-1.5 text-sm"
                  }
                  onClick={() => setTab(key)}
                >
                  {TAB_LABEL[key]}
                </button>
              ))}
            </div>

            {activeTab === "pending" && (
              <section
                className="rounded-xl border bg-card p-4"
                aria-label={TAB_LABEL.pending}
              >
                {data.pending.length === 0 ? (
                  // §19.31: каноническая формулировка пустого списка заданий.
                  <p className="text-sm text-muted-foreground">
                    У вас нет участников для оценивания по этому мероприятию.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {data.pending.map((item) => (
                      <li key={item.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">
                            {item.targetSafeLabel}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {item.targetSafeUnitLabel} · {item.postLabel} ·{" "}
                            {DIRECTION_LABEL[item.evaluationDirection]}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Факт участия:{" "}
                          {item.participated ? "участвовал" : "не участвовал"} ·
                          Начальная оценка: {item.initialScore} · Не отправлено
                        </p>
                        {openItemId === item.id ? (
                          <EvaluationForm
                            item={item}
                            bases={data.bases}
                            onClose={() => setOpenItemId(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            className="mt-2 rounded-md border px-3 py-1.5 text-sm"
                            onClick={() => setOpenItemId(item.id)}
                          >
                            Оценить: {item.targetSafeLabel}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {activeTab === "submitted" && (
              <section
                className="rounded-xl border bg-card p-4"
                aria-label={TAB_LABEL.submitted}
              >
                {data.submitted.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Отправленных оценок нет.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {data.submitted.map((entry: SubmittedEvaluationView) => (
                      <li key={entry.evaluationId} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">
                            {entry.targetSafeLabel}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {entry.postLabel} ·{" "}
                            {DIRECTION_LABEL[entry.evaluationDirection]}
                          </span>
                        </div>
                        <p className="mt-1 text-sm">
                          Оценка:{" "}
                          <span className="tabular-nums">{entry.score}</span>
                          {entry.basisLabel !== null &&
                            ` · Основание: ${entry.basisLabel}`}
                        </p>
                        {entry.basisNote !== null && (
                          <p className="text-xs text-muted-foreground">
                            Пояснение: {entry.basisNote}
                          </p>
                        )}
                        {entry.comment !== null && (
                          <p className="text-xs text-muted-foreground">
                            Комментарий: {entry.comment}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Отправлено: {dateTime(entry.submittedAt)} · Редакция{" "}
                          {entry.revision}
                        </p>
                        {openSubmittedId === entry.workItemId ? (
                          <SubmittedEvaluationCard
                            workItemId={entry.workItemId}
                            onClose={() => setOpenSubmittedId(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            className="mt-2 rounded-md border px-3 py-1.5 text-sm"
                            onClick={() => setOpenSubmittedId(entry.workItemId)}
                          >
                            Открыть отправленную оценку: {entry.targetSafeLabel}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {activeTab === "progress" && data.eventProgress !== null && (
              <section
                className="rounded-xl border bg-card p-4"
                aria-label={TAB_LABEL.progress}
              >
                <p className="text-sm">
                  Участников: {data.eventProgress.participants} · Заданий:{" "}
                  {data.eventProgress.counters.total} · Отправлено:{" "}
                  {data.eventProgress.counters.submitted} · Осталось:{" "}
                  {data.eventProgress.counters.remaining}
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {data.eventProgress.byDirection.map((row) => (
                    <li
                      key={row.direction}
                      className="text-xs text-muted-foreground"
                    >
                      {DIRECTION_LABEL[row.direction]}: отправлено{" "}
                      {row.counters.submitted} из {row.counters.total}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Это прогресс оценивания, а не его содержание: значений оценок,
                  оценщиков и комментариев здесь нет — они закрыты (§19.21).
                </p>
              </section>
            )}

            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 text-sm font-semibold">Что не показывается</h2>
              <ul className="flex flex-col gap-2">
                {data.unavailableViews.map((view) => (
                  <li key={view.code} className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {view.label}.{" "}
                    </span>
                    {view.reason}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
