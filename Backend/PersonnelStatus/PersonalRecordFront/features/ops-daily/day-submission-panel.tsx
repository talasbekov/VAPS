"use client";

// Панель сдачи дня — нативный порт: честное состояние дня, предпросмотр с
// подтверждением, живая сдача и amendment-флоу. Кнопка «Сдать день» живёт
// ЗДЕСЬ: кнопка грида шлёт дельты статусов и день НЕ сдаёт.
import { useEffect, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDailyExpenseRead } from "@/hooks/use-daily-expense-read";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError } from "@/lib/ops-errors";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  DAILY_DIVISIONS_PATH,
  DAILY_SUBMISSIONS_PATH,
  EVENT_LABELS,
  SANCTION_MAX,
  dailyAmendPath,
  describeAmendFailure,
  describeSubmitFailure,
  isAmendmentComplete,
  isWithinSubmitWindow,
  parseSubmissionList,
  parseValidationDetails,
  previousSubmission,
  todayLocalIso,
} from "@/entities/daily-grid";
import type {
  DayAmendBody,
  DaySubmission,
  DaySubmissionCreateBody,
} from "@/entities/daily-grid";
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";

/** Одна строка локального расхождения: кого правили после сдачи и на что. */
export interface DriftEntry {
  employeeId: string;
  fullName: string;
  statusLabel: string;
}

export interface DaySubmissionPanelProps {
  divisionId: string | null;
  businessDate: string;
  dateValid: boolean;
  rowCount: number;
  dirtyCount: number;
  /** Правки, отправленные на ЭТОМ экране уже после сдачи. */
  localDrift: DriftEntry[];
  submission: DaySubmission | null;
  /** ВСЕ версии дня из того же запроса (селектор по is_current не фильтрует). */
  submissions: DaySubmission[];
  isLoading: boolean;
  isError: boolean;
  /** Exact-unit capability from freshly read canonical division metadata. */
  canCorrect?: boolean;
  /** Inside the statuses submission card: reuse actions without a second card. */
  embedded?: boolean;
}

const SUBMIT_LABEL = "Сдать день";
const AMEND_LABEL = "Исправить сдачу";

// Момент печатается модулем `formatIsoDateTime` (Plane №935): своя копия
// отдавала сырую ISO-строку вместо «—» и печатала секунды, которых на экране
// нет ни у кого. Один формат на все экраны — «дд.мм.гггг, чч:мм».

export function DaySubmissionPanel({
  divisionId,
  businessDate,
  dateValid,
  rowCount,
  dirtyCount,
  localDrift,
  submission,
  submissions,
  isLoading: parentLoading,
  isError: parentError,
  canCorrect,
  embedded = false,
}: DaySubmissionPanelProps) {
  const queryClient = useQueryClient();
  const access = useOpsPermissions();
  const canSubmitDay = !access.isLoading && !access.error && access.hasPermission("daily_report.mark_update");
  const [confirming, setConfirming] = useState(false);
  // Ответ ПОСЛЕДНЕЙ успешной сдачи — «результат действия»; истина о дне всё
  // равно перечитывается инвалидацией.
  const [submitted, setSubmitted] = useState<DaySubmission | null>(null);
  // Причина отказа ДО отправки — пишется по клику.
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [amending, setAmending] = useState(false);
  const [amended, setAmended] = useState<DaySubmission | null>(null);

  /** История сдач ПОДРАЗДЕЛЕНИЯ (без фильтра по дате) — предпросмотру нужно
   * знать, была ли предыдущая сдача: при previous === null сервер всегда даёт
   * CHANGED. */
  const historyQuery = useDailyExpenseRead("division-history", [divisionId], (_signal, authorize) =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?division_id=${encodeURIComponent(divisionId as string)}&limit=200`, authorize
      ), {
    enabled: divisionId !== null && dateValid && !parentLoading && !parentError,
    refetchOnWindowFocus: false,
  });
  const isLoading = parentLoading || historyQuery.isPending;

  const previous = useMemo(
    () => previousSubmission(parseSubmissionList(historyQuery.data), businessDate),
    [historyQuery.data, businessDate]
  );

  const mutation = useOpsMutation<DaySubmission, DaySubmissionCreateBody>({
    mutationFn: (variables) =>
      opsApiClient.post<DaySubmission>(DAILY_SUBMISSIONS_PATH, variables),
    onSuccess: (data) => {
      setSubmitted(data);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["daily-expense-board"] });
      void queryClient.invalidateQueries({
        queryKey: ["ops-daily", "day-submission", divisionId, businessDate],
      });
      void queryClient.invalidateQueries({
        queryKey: ["ops-daily", "division-submissions", divisionId],
      });
    },
  });

  const { error: mutationError, isPending, mutate } = mutation;
  const failure = mutationError === null ? null : describeSubmitFailure(mutationError);

  // Действующая версия дня считается ДО мутации исправления: pk адресует
  // цепочку — сервер сам переразрешает голову дня.
  // Локальный ответ закрывает промежуток до перечитки, но не перекрывает
  // более новую версию другого оператора. При равной версии берём свежие
  // серверные поля; результаты другого подразделения/дня сюда не входят.
  const current = [submission, amended, submitted].reduce<DaySubmission | null>(
    (latest, candidate) => {
      if (!candidate?.is_current || candidate.division_id !== divisionId ||
        candidate.business_date !== businessDate) return latest;
      return latest === null || candidate.version > latest.version ? candidate : latest;
    },
    null
  );
  const hasCorrectionPermission = !access.isLoading && !access.error &&
    access.hasPermission("daily_report.correct");
  const correctionScope = useDailyExpenseRead("correction-divisions", [businessDate], (_signal, authorize) =>
    opsApiClient.get<{ results: { id: string; can_correct?: boolean }[] }>(
      `${DAILY_DIVISIONS_PATH}?business_date=${encodeURIComponent(businessDate)}`, authorize), {
    enabled: canCorrect === undefined && hasCorrectionPermission && current !== null &&
      divisionId !== null && dateValid,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const isError = parentError || historyQuery.isError || correctionScope.readAccessBlocked ||
    (canCorrect === undefined && hasCorrectionPermission && correctionScope.isError);
  const correctionAllowed = canCorrect !== undefined ? canCorrect === true :
    correctionScope.isSuccess && !correctionScope.isFetching &&
    correctionScope.data.results.some(row => String(row.id) === divisionId && row.can_correct === true);
  const canAmend = current !== null && hasCorrectionPermission && correctionAllowed && !isLoading && !isError;

  const amendMutation = useOpsMutation<DaySubmission, DayAmendBody>({
    mutationFn: async (variables) => {
      try {
        return await opsApiClient.post<DaySubmission>(dailyAmendPath(current?.id ?? 0), variables);
      } catch (error) {
        if (error instanceof OpsApiError && error.status === 403) {
          // Keep the mutation pending until current permission and target
          // metadata have been checked; cached grants cannot permit a retry.
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["ops-me"] }),
            queryClient.invalidateQueries({ queryKey: ["ops-daily", "submission-divisions", businessDate] }),
            queryClient.invalidateQueries({ queryKey: ["daily-expense-board"] }),
          ]);
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      setAmended(data);
      setAmending(false);
      void queryClient.invalidateQueries({ queryKey: ["daily-expense-board"] });
      void queryClient.invalidateQueries({
        queryKey: ["ops-daily", "day-submission", divisionId, businessDate],
      });
      void queryClient.invalidateQueries({
        queryKey: ["ops-daily", "division-submissions", divisionId],
      });
    },
  });

  const amendFailure =
    amendMutation.error === null ? null : describeAmendFailure(amendMutation.error);

  // 409 (гонка двух amendment) и 404 — состояние дня под формой устарело:
  // перечитываем.
  const amendStale =
    amendFailure?.kind === "conflict" || amendFailure?.kind === "not-found";
  useEffect(() => {
    if (!amendStale) return;
    void queryClient.invalidateQueries({ queryKey: ["daily-expense-board"] });
    void queryClient.invalidateQueries({
      queryKey: ["ops-daily", "day-submission", divisionId, businessDate],
    });
    // Второй ключ — ТОТ ЖЕ, что уже инвалидируют оба `onSuccess` выше. Правка
    // ревью ветки 22.08: ключа "day-submission" НЕ ЧИТАЕТ НИКТО (владение
    // списком сдач уехало в борд «Ежедневного расхода»), а `invalidateQueries`
    // рассылает событие только тем запросам, которые РЕАЛЬНО есть в кэше —
    // значит на 409/404 не перечитывалось ничего вообще, и рядом с текстом
    // отказа оставалось устаревшее состояние дня.
    void queryClient.invalidateQueries({
      queryKey: ["ops-daily", "division-submissions", divisionId],
    });
  }, [amendStale, queryClient, divisionId, businessDate]);

  /** Форма открыта — чистая производная, не стейт: после гонки версий день
   * остаётся сданным, и стейт не закрылся бы никогда. 400 сюда не входит —
   * правимый отказ оставляет форму открытой. */
  const amendFormOpen = canAmend && amending && !amendStale;

  const dayVersions = useMemo(
    () => submissions.filter((row) => row.business_date === businessDate),
    [submissions, businessDate]
  );

  // После 409 сдачи состояние дня перечитывается — иначе «Сдать день» осталась
  // бы активной обманкой на уже сданном дне.
  const alreadySubmitted = failure?.kind === "already-submitted";
  useEffect(() => {
    if (!alreadySubmitted) return;
    void queryClient.invalidateQueries({ queryKey: ["daily-expense-board"] });
    void queryClient.invalidateQueries({
      queryKey: ["ops-daily", "day-submission", divisionId, businessDate],
    });
    // См. тот же комментарий у восстановления после 409/404 исправления: без
    // этой второй инвалидации перечитывать состояние дня было нечему.
    void queryClient.invalidateQueries({
      queryKey: ["ops-daily", "division-submissions", divisionId],
    });
  }, [alreadySubmitted, queryClient, divisionId, businessDate]);

  if (!dateValid) return null;

  function blockingReason(): string | null {
    if (!canSubmitDay) return "У вашей роли нет права сдавать день.";
    if (isLoading || isError) return "Дождитесь загрузки состояния дня.";
    if (divisionId === null) return "Выберите подразделение.";
    // Инвариантная блокировка: сдача снимает снапшот с СЕРВЕРНОГО состояния —
    // несохранённые дельты в него не попадут.
    if (dirtyCount > 0) return `Сначала сохраните правки: изменено ${dirtyCount}`;
    // Клиентский гард — удобство; истина при расхождении зон — allowed из 422.
    if (!isWithinSubmitWindow(businessDate, todayLocalIso())) {
      return "Сдать можно за сегодня и на 62 дня вперёд; прошлые дни не сдаются.";
    }
    return null;
  }

  function handleOpenConfirm() {
    const reason = blockingReason();
    setBlockedReason(reason);
    if (reason !== null) return;
    setConfirming(true);
  }

  function handleConfirm() {
    if (isPending) return;
    const reason = blockingReason();
    if (reason !== null) {
      setBlockedReason(reason);
      setConfirming(false);
      return;
    }
    if (divisionId === null) return;
    // Тело — СТРОГО два поля: актора определяет сервер.
    mutate({ division_id: divisionId, business_date: businessDate });
  }

  const validationDetails =
    failure?.kind === "validation" && mutationError !== null
      ? parseValidationDetails(mutationError)
      : [];

  const amendValidationDetails =
    amendFailure?.kind === "validation" && amendMutation.error !== null
      ? parseValidationDetails(amendMutation.error)
      : [];

  function handleAmendSubmit(body: DayAmendBody) {
    // Амендить нечего, если день не сдан: без действующей версии нет и pk.
    if (!canAmend || current === null || amendMutation.isPending) return;
    amendMutation.mutate(body);
  }

  return (
    <section className={embedded ? "min-w-0" : "rounded-xl border bg-card p-4"}>
      {!embedded && <h2 className="mb-3 text-lg font-semibold">Сдача дня</h2>}
      <div className="flex flex-col gap-3">
        {isLoading && (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка состояния дня…
          </p>
        )}

        {isError && (
          // Ошибка чтения — НЕ «пустой день»: молчаливая трактовка показала бы
          // кнопку сдачи там, где читать нельзя вовсе.
          <p role="alert" className="text-sm text-destructive-ink">
            Не удалось прочитать состояние дня.
            {" "}<button type="button" className="underline underline-offset-2" disabled={historyQuery.isFetching}
              onClick={() => void historyQuery.refetch()}>Повторить загрузку</button>
          </p>
        )}

        {!isLoading && !isError && current !== null && (
          <div className="flex flex-col gap-1 rounded-md bg-emerald-100 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            {/* Состояние названо словами — цвет никогда не единственный сигнал. */}
            <span className="font-medium">
              День сдан: v{current.version} · {EVENT_LABELS[current.event]}
            </span>
            <span>
              {formatIsoDateTime(current.submitted_at)} · {current.submitted_by}
            </span>
            {current.late && <span>сдано с опозданием (после контрольного часа)</span>}
            {embedded && <span>Данные доступны ответственному за расход департамента.</span>}
          </div>
        )}

        {embedded && current !== null && !isLoading && !isError && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Если статусы изменились после сдачи</summary>
            <p className="mt-1">Изменения не переписывают сданную версию. {canAmend ? 'Используйте «Исправить сдачу», чтобы передать обновлённый расход.' : 'Для обновления сдачи обратитесь к сотруднику с правом её исправления.'}</p>
          </details>
        )}

        {!isLoading && !isError && canAmend && !amendFormOpen && (
          <div>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm"
              // reset() обязателен: после 409/404 форму держит закрытой
              // производная от error, а error очищается только следующим
              // mutate — без сброса кнопка была бы мёртвой.
              onClick={() => {
                if (!canAmend) return;
                amendMutation.reset();
                setAmending(true);
              }}
            >
              {AMEND_LABEL}
            </button>
          </div>
        )}

        {amending && current !== null && !amendStale && (
          <div hidden={!canAmend}>
            <DayAmendmentForm
              businessDate={businessDate}
              isPending={amendMutation.isPending || !canAmend}
              onSubmit={handleAmendSubmit}
              onCancel={() => { if (!amendMutation.isPending) setAmending(false); }}
            />
          </div>
        )}

        {amendFailure !== null && amendFailure.kind !== "silent" && (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200"
          >
            <span className="font-medium">{amendFailure.message}</span>
            {amendValidationDetails.length > 0 && (
              <ul className="list-disc pl-5">
                {amendValidationDetails.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!isLoading && !isError && dayVersions.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer py-2 font-medium">История сдачи за {formatIsoDate(businessDate)} · {dayVersions.length}</summary>
            <ul className="flex flex-col gap-1">
              {dayVersions.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2"
                >
                  <span>
                    v{version.version} · {EVENT_LABELS[version.event]} ·{" "}
                    {formatIsoDateTime(version.submitted_at)} · {version.submitted_by}
                  </span>
                  {version.is_current && (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                      действующая
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {!isLoading && !isError && current === null && (!confirming || !canSubmitDay) && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">День не сдан</span>
            {canSubmitDay ? <button
              type="button"
              className="min-h-10 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              onClick={handleOpenConfirm}
            >
              {embedded ? "Проверить и сдать" : SUBMIT_LABEL}
            </button> : <span className="text-sm text-muted-foreground">У вашей роли нет права сдавать день.</span>}
          </div>
        )}

        {blockedReason !== null && !confirming && (
          <p
            role="alert"
            className="rounded-md bg-amber-100 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {blockedReason}
          </p>
        )}

        {/* current === null — после 409 перечитка приносит «День сдан», и
            открытое подтверждение не должно висеть под ним. */}
        {confirming && current === null && canSubmitDay && !isLoading && !isError && (
          <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
            <p className="font-medium">
              Сдать расход за {formatIsoDate(businessDate)}? Сотрудников по списку: {rowCount}.
            </p>
            <p className="text-muted-foreground">
              Будет сохранён расход выбранного подразделения на эту дату. Проверьте статусы перед подтверждением.
            </p>
            {previous !== null && <p className="text-muted-foreground">
              Последняя сдача: {formatIsoDate(previous.business_date)} · v{previous.version}.
            </p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={isPending}
                onClick={handleConfirm}
              >
                {isPending ? "Сдаём день…" : "Подтвердить сдачу"}
              </button>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm"
                disabled={isPending}
                onClick={() => setConfirming(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Отправка…
          </p>
        )}

        {/* 5xx/сеть/401 сюда не доходят (silent): их обслужил общий канал. */}
        {failure !== null && failure.kind !== "silent" && (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200"
          >
            <span className="font-medium">{failure.message}</span>
            {failure.allowed !== undefined && (
              // Даты — ДОСЛОВНО из ответа: зоны браузера и сервера расходятся
              // на границе суток.
              <span>Допустимые даты: {failure.allowed.join(", ")}</span>
            )}
            {validationDetails.length > 0 && (
              <ul className="list-disc pl-5">
                {validationDetails.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {localDrift.length > 0 && current !== null && (
          <div
            role="alert"
            className="flex flex-col gap-1 rounded-md bg-amber-100 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <span className="font-medium">Расход разошёлся с тем, что сдано</span>
            <ul className="list-disc pl-5">
              {localDrift.map((entry) => (
                <li key={entry.employeeId}>
                  {entry.fullName} · {entry.statusLabel}
                </li>
              ))}
            </ul>
            {/* Граница названа честно: это правки, сделанные ЗДЕСЬ, — полную
                истину о расхождении несёт серверный светофор. */}
            <span>
              Здесь перечислены изменения, сделанные на этой странице. Обновите
              данные и проверьте состояние сдачи подразделения.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

interface DayAmendmentFormProps {
  businessDate: string;
  isPending: boolean;
  onSubmit: (body: DayAmendBody) => void;
  onCancel: () => void;
}

/** Форма исправления: причина + санкция. Настоящий <form> — иначе Enter не
 * отправлял бы ничего. */
function DayAmendmentForm({
  businessDate,
  isPending,
  onSubmit,
  onCancel,
}: DayAmendmentFormProps) {
  const reasonId = useId();
  const sanctionId = useId();
  const counterId = useId();
  const [reason, setReason] = useState("");
  const [sanction, setSanction] = useState("");

  const complete = isAmendmentComplete(reason, sanction);
  const canSubmit = complete && !isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ reason: reason.trim(), sanction: sanction.trim() });
  }

  return (
    <form
      aria-label="Исправление сдачи"
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border p-3 text-sm"
    >
      <p className="font-medium">Исправить сдачу за {businessDate}?</p>
      <p className="text-muted-foreground">
        Появится новая версия дня; прежняя останется в истории с автором,
        временем и основанием.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId} className="text-xs font-semibold">
          Причина
        </label>
        <textarea
          id={reasonId}
          disabled={isPending}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={sanctionId} className="text-xs font-semibold">
          Санкция
        </label>
        <input
          id={sanctionId}
          disabled={isPending}
          type="text"
          value={sanction}
          onChange={(event) => setSanction(event.target.value)}
          maxLength={SANCTION_MAX}
          aria-describedby={counterId}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
        {/* Предел назван числом, а не только длиной поля. */}
        <span id={counterId} className="text-xs text-muted-foreground">
          {sanction.length}/{SANCTION_MAX}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={!canSubmit}
        >
          Подтвердить исправление
        </button>
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
