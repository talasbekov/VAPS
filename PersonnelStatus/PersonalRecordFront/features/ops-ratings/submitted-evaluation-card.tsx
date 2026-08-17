"use client";

// Карточка отправленной оценки (§19.17) и исправление (§19.18).
//
// Порядок шагов §19.18 соблюдён буквально: карточка открывается ОТДЕЛЬНЫМ
// запросом (шаг 3 — актуальная revision), кнопка исправления — только если
// право прислал сервер (canCorrect), перед подтверждением показывается diff
// (шаг 8), мутация уходит с той редакцией, что видел человек (шаг 10). Успех —
// только после ответа (шаг 11). Исходная запись с экрана не исчезает.
import { useState } from "react";
import {
  useCorrectEvaluation,
  useSubmittedEvaluationDetail,
} from "@/hooks/use-ops-ratings";
import { EvaluationConflictNotice } from "./evaluation-conflict-notice";
import {
  DIRECTION_LABEL,
  RATING_DEFAULT_SCORE,
  RATING_SCALE_MAX,
  RATING_SCALE_MIN,
  buildCorrectionDiff,
  newIdempotencyKey,
  validateCorrection,
} from "@/entities/operational-rating";
import type {
  SubmissionField,
  SubmissionViolation,
} from "@/entities/operational-rating";

const SCALE = Array.from(
  { length: RATING_SCALE_MAX - RATING_SCALE_MIN + 1 },
  (_value, index) => RATING_SCALE_MIN + index
);

/** Ошибка сервера ставится рядом с тем же полем, что и клиентская, ПО КОДУ. */
export const SERVER_ERROR_FIELD: Record<string, SubmissionField> = {
  SCORE_OUT_OF_SCALE: "score",
  SCORE_NOT_INTEGER: "score",
  BASIS_REQUIRED: "basisCode",
  BASIS_UNKNOWN: "basisCode",
  BASIS_NOTE_REQUIRED: "basisNote",
  COMMENT_REQUIRED: "comment",
  CORRECTION_REASON_REQUIRED: "reason",
};

function dateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

export function SubmittedEvaluationCard({
  workItemId,
  onClose,
}: {
  workItemId: string;
  onClose: () => void;
}) {
  const query = useSubmittedEvaluationDetail(workItemId);
  const data = query.data;

  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [basisCode, setBasisCode] = useState<string | null>(null);
  const [basisNote, setBasisNote] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [violation, setViolation] = useState<SubmissionViolation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const mutation = useCorrectEvaluation(workItemId, () => {
    setEditing(false);
    setConfirming(false);
    setViolation(null);
    setReason("");
  });

  if (query.isLoading)
    return <p className="text-sm text-muted-foreground">Загрузка карточки…</p>;
  if (query.error !== null)
    return <p className="text-sm text-destructive-ink">{query.error.message}</p>;
  if (data === undefined) return null;

  const submitted = data.submitted;
  // Значения формы, пока их не трогали, — те, что ПРИСЛАНЫ: подставлять сюда
  // умолчания значило бы предложить исправление, которого никто не задумывал.
  const nextScore = score ?? submitted.score;
  const nextBasisCode =
    basisCode ??
    data.bases.find((basis) => basis.label === submitted.basisLabel)?.code ??
    "";
  const nextBasisNote = basisNote ?? submitted.basisNote ?? "";
  const nextComment = comment ?? submitted.comment ?? "";
  const selectedBasis = data.bases.find((basis) => basis.code === nextBasisCode);

  const diff = buildCorrectionDiff(
    {
      score: submitted.score,
      basisLabel: submitted.basisLabel,
      basisNote: submitted.basisNote,
      comment: submitted.comment,
    },
    {
      score: nextScore,
      basisLabel: selectedBasis?.label ?? null,
      basisNote: nextBasisNote,
      comment: nextComment,
    }
  );

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

  function review(event: React.FormEvent) {
    event.preventDefault();
    const found = validateCorrection(
      {
        score: nextScore,
        basisCode: nextBasisCode === "" ? null : nextBasisCode,
        basisNote: nextBasisNote === "" ? null : nextBasisNote,
        comment: nextComment === "" ? null : nextComment,
        reason,
      },
      data?.bases ?? []
    );
    setViolation(found);
    if (found !== null) return;
    // Шаг 8: сначала diff, и только потом подтверждение.
    setConfirming(true);
  }

  function confirm() {
    mutation.mutate({
      score: nextScore,
      basisCode: nextBasisCode === "" ? null : nextBasisCode,
      basisNote: nextBasisNote === "" ? null : nextBasisNote,
      comment: nextComment === "" ? null : nextComment,
      reason,
      // Редакция — та, что пришла ЭТИМ запросом карточки (шаг 3).
      revision: data?.workItem.revision ?? 0,
      idempotencyKey,
    });
  }

  return (
    <section
      className="mt-3 rounded-lg border bg-background p-3"
      aria-label="Отправленная оценка"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="font-semibold">Участник</dt>
        <dd>{submitted.targetSafeLabel}</dd>
        <dt className="font-semibold">Пост или роль</dt>
        <dd>{submitted.postLabel}</dd>
        <dt className="font-semibold">Направление</dt>
        <dd>{DIRECTION_LABEL[submitted.evaluationDirection]}</dd>
        <dt className="font-semibold">Оценка</dt>
        <dd className="tabular-nums">{submitted.score}</dd>
        <dt className="font-semibold">Основание</dt>
        <dd>{submitted.basisLabel ?? "—"}</dd>
        <dt className="font-semibold">Комментарий</dt>
        <dd>{submitted.comment ?? "—"}</dd>
        <dt className="font-semibold">Отправлено</dt>
        <dd>{dateTime(submitted.submittedAt)}</dd>
        <dt className="font-semibold">Редакция</dt>
        <dd className="tabular-nums">{data.workItem.revision}</dd>
        <dt className="font-semibold">Идентификатор оценки</dt>
        <dd className="font-mono">{submitted.evaluationId}</dd>
      </dl>

      {data.chain === null ? (
        <p className="mt-3 text-xs text-muted-foreground">
          История исправлений не показывается: право на просмотр цепочки
          исправлений не выдано.
        </p>
      ) : (
        <div className="mt-3">
          <h4 className="mb-1 text-xs font-semibold">История записи</h4>
          <ul className="flex flex-col gap-1">
            {data.chain.map((link) => (
              <li key={link.evaluationId} className="text-xs text-muted-foreground">
                <span className="font-mono">{link.evaluationId}</span> — оценка{" "}
                {link.score}
                {link.current
                  ? " · действующая запись"
                  : ` · заменена ${link.supersededAt === null ? "" : dateTime(link.supersededAt)}: ${link.supersededReason ?? "—"}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!editing && (
        <div className="mt-3 flex gap-2">
          {data.canCorrect && (
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => setEditing(true)}
            >
              Исправить оценку
            </button>
          )}
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>
      )}
      {!editing && !data.canCorrect && (
        <p className="mt-2 text-xs text-muted-foreground">
          Исправление недоступно: право на исправление оценки не выдано.
          Отправленная запись не редактируется — исправление создаёт новую
          (§19.18).
        </p>
      )}

      {editing && !confirming && (
        <form className="mt-3" onSubmit={review} noValidate>
          <label
            className="mb-1 block text-xs font-semibold"
            htmlFor={`correct-score-${workItemId}`}
          >
            Новая оценка
          </label>
          <select
            id={`correct-score-${workItemId}`}
            className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
            value={nextScore}
            onChange={(event) => setScore(Number(event.target.value))}
          >
            {SCALE.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          {errorFor("score") !== null && (
            <p className="mb-2 text-xs text-destructive-ink">{errorFor("score")}</p>
          )}

          <label
            className="mb-1 block text-xs font-semibold"
            htmlFor={`correct-basis-${workItemId}`}
          >
            Основание
          </label>
          <select
            id={`correct-basis-${workItemId}`}
            className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
            value={nextBasisCode}
            onChange={(event) => setBasisCode(event.target.value)}
          >
            <option value="">— выберите основание —</option>
            {data.bases.map((basis) => (
              <option key={basis.code} value={basis.code}>
                {basis.label}
              </option>
            ))}
          </select>
          {errorFor("basisCode") !== null && (
            <p className="mb-2 text-xs text-destructive-ink">
              {errorFor("basisCode")}
            </p>
          )}

          {selectedBasis?.requiresNote === true && (
            <>
              <label
                className="mb-1 block text-xs font-semibold"
                htmlFor={`correct-basis-note-${workItemId}`}
              >
                Пояснение к основанию
              </label>
              <input
                id={`correct-basis-note-${workItemId}`}
                className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
                value={nextBasisNote}
                onChange={(event) => setBasisNote(event.target.value)}
              />
              {errorFor("basisNote") !== null && (
                <p className="mb-2 text-xs text-destructive-ink">
                  {errorFor("basisNote")}
                </p>
              )}
            </>
          )}

          <label
            className="mb-1 block text-xs font-semibold"
            htmlFor={`correct-comment-${workItemId}`}
          >
            Комментарий
            {nextScore < RATING_DEFAULT_SCORE && " (обязателен)"}
          </label>
          <textarea
            id={`correct-comment-${workItemId}`}
            className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
            rows={3}
            value={nextComment}
            onChange={(event) => setComment(event.target.value)}
          />
          {errorFor("comment") !== null && (
            <p className="mb-2 text-xs text-destructive-ink">{errorFor("comment")}</p>
          )}

          <label
            className="mb-1 block text-xs font-semibold"
            htmlFor={`correct-reason-${workItemId}`}
          >
            Причина исправления (обязательна)
          </label>
          <textarea
            id={`correct-reason-${workItemId}`}
            className="mb-1 w-full rounded-md border bg-background p-2 text-sm"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {errorFor("reason") !== null && (
            <p className="mb-2 text-xs text-destructive-ink">{errorFor("reason")}</p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Показать изменения
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => {
                setEditing(false);
                setViolation(null);
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {editing && confirming && (
        <div className="mt-3" aria-label="Подтверждение исправления">
          <h4 className="mb-1 text-xs font-semibold">Что изменится</h4>
          {diff.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Значения не изменились — исправлять нечего.
            </p>
          ) : (
            <ul className="mb-2 flex flex-col gap-1">
              {diff.map((row) => (
                <li key={row.field} className="text-xs">
                  <span className="font-semibold">{row.label}: </span>
                  <span className="text-muted-foreground">{row.before}</span>
                  {" → "}
                  <span>{row.after}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mb-2 text-xs text-muted-foreground">Причина: {reason}</p>
          <EvaluationConflictNotice
            error={mutation.error}
            attempted={{
              score: nextScore,
              basisLabel: selectedBasis?.label ?? null,
              comment: nextComment === "" ? null : nextComment,
            }}
            onRecheck={() => {
              void query.refetch();
            }}
          />
          {mutation.error !== null &&
            serverField === null &&
            mutation.error.kind !== "network" &&
            !(
              "details" in mutation.error &&
              "currentRevision" in mutation.error.details
            ) && (
              <p className="mb-2 text-xs text-destructive-ink">
                {mutation.error.message}
              </p>
            )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              disabled={mutation.isPending || diff.length === 0}
              onClick={confirm}
            >
              Подтвердить исправление
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => {
                setConfirming(false);
                // Ошибку прошлой попытки надо снять явно: производная от неё
                // иначе держала бы путь закрытым до перемонтирования формы.
                mutation.reset();
              }}
            >
              Вернуться к правке
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
