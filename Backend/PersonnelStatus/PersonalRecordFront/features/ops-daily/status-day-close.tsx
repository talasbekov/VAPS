"use client";

// Сдача дня СО СТРАНИЦЫ «Статусы сотрудников» (Plane №1197, решение
// заказчика 12.09.2026). Замысел проходки: начальник управления ставит
// статусы тем, кому нужно (остальные — «в строю» без отметки), выбирает дату
// (по умолчанию завтра сервера) и на той же странице нажимает «Сдать день».
// До этого кнопка жила только на `/employees?view=daily` — в модуле, который
// открывается по правам сбора сил на ОМ, то есть в чужом для начальника
// управления месте. На борде расхода кнопка ОСТАЁТСЯ (заказчик: «добавить,
// старое оставить»).
//
// Панель `DaySubmissionPanel` не переписана — она монтируется здесь с тем же
// контрактом, что и на борде (`DivisionGroup`): состояние дня читается ОДНИМ
// запросом под ключом `["ops-daily","day-submission",divisionId,businessDate]`,
// который панель сама инвалидирует после сдачи/исправления.
//
// «РАСХОД НА ДАТУ» (Plane №1209). Над панелью сдачи — числа расхода управления
// на выбранную дату из того же источника, что читает ответственный и снимок
// сдачи (`GET strength-report/?business_date=&division_id=`). Начальник видит,
// ЧТО именно сдаёт, до нажатия кнопки; с проекцией кадровых статусов в раздел
// (`operations/personnel_mirror.py`) сюда входят и отпуск/больничный/
// командировка, поставленные в таблице ниже. Ключ `["ops-daily",
// "expense-preview", …]` инвалидирует «Обновить» страницы и закрытие окон
// статусов (через `onRefresh` таблицы).
import { Suspense, useCallback, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useBusinessDate } from "@/features/daily-expense/model/business-date";
import { apiClient, type StrengthReport } from "@/lib/api";
import {
  DAILY_DIVISIONS_PATH,
  DAILY_SUBMISSIONS_PATH,
  currentSubmission,
  parseSubmissionList,
  submitWindow,
  todayLocalIso,
} from "@/entities/daily-grid";
import { formatIsoDate } from "@/shared/lib/date";
import { DaySubmissionPanel } from "./day-submission-panel";

interface SubmissionDivision {
  id: string;
  name: string;
  ancestors?: string[];
  division_type?: string | null;
  can_submit?: boolean;
  can_correct?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The page count includes other units; the confirmation below uses the
// selected unit's canonical strength report instead.
export function StatusDayClose(_props: { employeeCount: number }) {
  // `useSearchParams` — своя граница Suspense: у `/statuses` нет клиентского
  // layout, и без границы прод-сборка падает на пререндере (Plane №112).
  return (
    <Suspense fallback={null}>
      <StatusDayCloseInner />
    </Suspense>
  );
}

function StatusDayCloseInner() {
  const access = useOpsPermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get("businessDate") ?? undefined;
  // Умолчание — «завтра» СЕРВЕРА, а не часов браузера (Plane №988); выбор
  // руками живёт в адресе, как на борде расхода.
  const canSubmit = !access.error && access.hasPermission("status.view") &&
    access.hasPermission("daily_report.mark_update");
  const { businessDate, isOverridden, defaultDate, dateError, retryDate, isRetryingDate } =
    useBusinessDate(selected, !access.isLoading && canSubmit);
  const dateValid = businessDate !== null && ISO_DATE.test(businessDate);
  const divisions = useQuery({
    queryKey: ["ops-daily", "submission-divisions", businessDate],
    enabled: !access.isLoading && canSubmit && dateValid,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    queryFn: () => opsApiClient.get<{ results: SubmissionDivision[] }>(
      `${DAILY_DIVISIONS_PATH}?business_date=${encodeURIComponent(businessDate as string)}`
    ),
  });
  // The same server scope resolver authorizes POST. Cached metadata cannot
  // keep a target/action visible while that scope is being revalidated.
  const dateReady = !dateError && (isOverridden || !isRetryingDate);
  const metadataReady = divisions.isSuccess && !divisions.isFetching && dateReady;
  // Keep the same context mounted during revalidation so its draft survives.
  // Cached targets never authorize actions: the entire editor stays hidden
  // and receives canCorrect=false until metadata succeeds again.
  const permitted = (divisions.data?.results ?? [])
    .filter(row => row.can_submit === true && row.division_type === "directorate");
  const requestedDivision = searchParams.get("submitDivision");
  const selectedDivision = requestedDivision !== null
    ? permitted.find(row => String(row.id) === requestedDivision) ?? null
    : permitted.length === 1 ? permitted[0] : null;

  const setBusinessDate = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      // Умолчание в адрес не пишется: ссылка на нетронутый экран чистая.
      if (value === "" || value === defaultDate) next.delete("businessDate");
      else next.set("businessDate", value);
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`, {
        scroll: false,
      });
    },
    [router, pathname, searchParams, defaultDate]
  );
  const setDivision = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete("submitDivision");
    else next.set("submitDivision", value);
    const query = next.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
  };

  // Пока права грузятся — ничего: мигнувшая и исчезнувшая панель хуже, чем
  // появившаяся с задержкой. Без права сдачи (наблюдатель, оператор
  // отдела) блока нет вовсе — обещание действия, которое сервер отклонит,
  // хуже его отсутствия.
  if (access.isLoading || !canSubmit) return null;

  const window = submitWindow(todayLocalIso());

  return (
    <section
      aria-label="Сдача дня за управление"
      className="grid gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Сдача расхода</h2>
        <p className="text-xs text-muted-foreground">Подготовьте статусы → проверьте расход → сдайте день</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(180px,220px)_minmax(0,1fr)] sm:items-start">
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <label htmlFor="status-business-date" className="text-muted-foreground">Расход на дату</label>
            {isOverridden ? (
              <button
                type="button"
                className="text-xs text-primary underline underline-offset-4"
                onClick={() => setBusinessDate("")}
              >
                Вернуть завтра
              </button>
            ) : businessDate !== null && dateReady && (
              <span className="text-xs text-muted-foreground">Завтра</span>
            )}
          </div>
          <input
            id="status-business-date"
            aria-describedby="status-report-date-help"
            type="date"
            className="h-10 min-w-0 w-full rounded-md border bg-background px-3 text-sm tabular-nums"
            value={businessDate ?? ""}
            min={window[0]}
            max={window[window.length - 1]}
            onChange={(event) => {
              if (event.target.value) setBusinessDate(event.target.value);
            }}
          />
        </div>
        {metadataReady && permitted.length === 1 && selectedDivision !== null ? (
          <div className="grid min-w-0 gap-1.5 text-sm">
            <span className="text-muted-foreground">Управление</span>
            <p className="py-2 font-medium">{[...(selectedDivision.ancestors ?? []), selectedDivision.name].join(" / ")}</p>
          </div>
        ) : metadataReady && permitted.length > 0 && (
          <label className="grid min-w-0 gap-1.5 text-sm">
            <span className="text-muted-foreground">Управление</span>
            <select
              aria-label="Управление для сдачи дня"
              className="h-10 min-w-0 w-full rounded-md border bg-background px-3"
              value={selectedDivision === null ? "" : String(selectedDivision.id)}
              onChange={event => setDivision(event.target.value)}
            >
              <option value="">Выберите управление</option>
              {permitted.map(row => (
                <option key={row.id} value={row.id}>
                  {[...(row.ancestors ?? []), row.name].join(" / ")}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p id="status-report-date-help" className="text-xs text-muted-foreground">
        Дата относится только к расходу и сдаче дня. Текущие статусы в таблице меняются с сегодняшнего дня.
      </p>

      {dateError ? (
        <div role="alert" className="text-sm text-destructive-ink">
          <p>Не удалось загрузить дату расхода.</p>
          <button type="button" className="mt-2 rounded-md border px-3 py-1.5" disabled={isRetryingDate} onClick={() => void retryDate()}>
            {isRetryingDate ? "Загрузка даты…" : "Повторить загрузку даты"}
          </button>
        </div>
      ) : divisions.isError ? (
        <div role="alert" className="text-sm text-destructive-ink">
          <p>Не удалось загрузить доступные управления.</p>
          <button type="button" className="mt-2 rounded-md border px-3 py-1.5" onClick={() => void divisions.refetch()}>Повторить загрузку</button>
        </div>
      ) : !dateValid || !metadataReady ? (
        <p role="status" className="text-sm text-muted-foreground">
          {dateValid && dateReady ? "Загрузка доступных управлений…" : "Загрузка даты расхода…"}
        </p>
      ) : selectedDivision !== null ? null : (
        <p role={requestedDivision !== null ? "alert" : "status"} className="text-sm text-muted-foreground">
          {requestedDivision !== null
            ? "Выбранное управление недоступно для сдачи дня. Выберите доступное управление."
            : permitted.length === 0
              ? "Нет доступных управлений для сдачи дня."
              : "Выберите управление, чтобы проверить расход и сдать день."}
        </p>
      )}
      {selectedDivision !== null && dateValid && (
        <div hidden={!metadataReady}>
          <SelectedDayClose
            key={`${selectedDivision.id}-${businessDate}`}
            divisionId={String(selectedDivision.id)}
            businessDate={businessDate as string}
            canCorrect={metadataReady && selectedDivision.can_correct === true}
            metadataReady={metadataReady}
          />
        </div>
      )}
    </section>
  );
}

function SelectedDayClose({ divisionId, businessDate, canCorrect, metadataReady }: { divisionId: string; businessDate: string; canCorrect: boolean; metadataReady: boolean }) {
  const submissions = useQuery({
    queryKey: ["ops-daily", "day-submission", divisionId, businessDate],
    enabled: metadataReady,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => parseSubmissionList(await opsApiClient.get<unknown>(
      `${DAILY_SUBMISSIONS_PATH}?division_id=${encodeURIComponent(divisionId)}&business_date=${encodeURIComponent(businessDate)}&limit=200`
    )),
  });
  const report = useQuery<StrengthReport>({
    queryKey: ["ops-daily", "expense-preview", divisionId, businessDate],
    enabled: metadataReady,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () => apiClient.getStrengthReport({ businessDate, divisionId: Number(divisionId) }),
  });
  const list = submissions.data ?? [];
  const loading = submissions.isPending || submissions.isFetching || report.isPending || report.isFetching;
  const failed = submissions.isError || report.isError || (!report.isPending && !report.data);
  return (
    <div className="grid items-start gap-3 border-t pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,auto)]">
      <ExpensePreview businessDate={businessDate} data={report.data} isLoading={report.isPending || report.isFetching} isError={report.isError} />
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Загрузка состояния сдачи дня…</p>
      ) : failed ? (
        <div role="alert" className="text-sm text-destructive-ink">
          <p>Не удалось загрузить состояние сдачи дня.</p>
          <button type="button" className="mt-2 rounded-md border px-3 py-1.5" onClick={() => {
            void submissions.refetch();
            void report.refetch();
          }}>Повторить загрузку</button>
        </div>
      ) : null}
      <div hidden={loading || failed || !metadataReady}>
        <DaySubmissionPanel
          embedded
          divisionId={divisionId}
          businessDate={businessDate}
          dateValid={true}
          rowCount={report.data?.totals.list_total ?? 0}
          dirtyCount={0}
          localDrift={[]}
          submission={currentSubmission(list)}
          submissions={list}
          isLoading={loading || !metadataReady}
          isError={failed}
          canCorrect={canCorrect}
        />
      </div>
    </div>
  );
}

/** Одна цифра расхода: подпись сверху, число снизу — так же читаются плитки
 *  шапки страницы (`StatCard`), только компактнее. */
function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[72px]">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums leading-tight">{value}</dd>
    </div>
  );
}

/**
 * Расход управления на деловую дату — то, что уйдёт в снимок при сдаче.
 *
 * Показываются «Список», «В строю» (колонка `IN_SERVICE`) и все НЕНУЛЕВЫЕ
 * колонки расхода в порядке сервера с его же подписями (`column_labels`):
 * свой словарь разошёлся бы с выгрузками. Нулевые колонки не печатаются —
 * начальнику нужно увидеть, кто отсутствует, а не пересчитать тринадцать
 * нулей.
 */
function ExpensePreview({
  businessDate,
  data,
  isLoading,
  isError,
}: {
  businessDate: string;
  data: StrengthReport | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  let body: ReactNode;
  if (isLoading) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        Считаем расход на {formatIsoDate(businessDate)}…
      </p>
    );
  } else if (isError || !data) {
    body = (
      <p role="alert" className="text-sm text-destructive-ink">
        Расход на {formatIsoDate(businessDate)} не загрузился. Обновите данные перед сдачей дня.
      </p>
    );
  } else {
    const { totals, columns, column_labels: labels } = data;
    const inService = totals.columns["IN_SERVICE"] ?? 0;
    const absent = columns
      .filter((code) => code !== "IN_SERVICE" && (totals.columns[code] ?? 0) > 0)
      .map((code) => ({ code, label: labels[code] ?? code, value: totals.columns[code] }));
    body = (
      <dl className="flex flex-wrap gap-x-6 gap-y-3" aria-label="Числа расхода">
        <Figure label="Список" value={totals.list_total} />
        <Figure label="В строю" value={inService} />
        {absent.map((column) => (
          <Figure key={column.code} label={column.label} value={column.value} />
        ))}
        {totals.attached > 0 && <Figure label="Приданы" value={totals.attached} />}
        {absent.length === 0 && (
          <p className="self-end text-sm text-muted-foreground">
            Отсутствующих на эту дату нет — все в строю.
          </p>
        )}
      </dl>
    );
  }

  return (
    <section
      aria-label="Расход на дату"
      className="min-w-0"
    >
      {body}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">Что входит в расход</summary>
        <p className="mt-1 max-w-prose">
          Кадровые статусы и участие в ОМ, действующие на {formatIsoDate(businessDate)}.
          После изменения статусов в таблице ниже числа обновятся.
        </p>
      </details>
    </section>
  );
}
