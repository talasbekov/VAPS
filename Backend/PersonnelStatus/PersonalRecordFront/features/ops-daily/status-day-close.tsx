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
  DAILY_SUBMISSIONS_PATH,
  SUBMIT_HORIZON_DAYS,
  currentSubmission,
  parseSubmissionList,
  submitWindow,
  todayLocalIso,
} from "@/entities/daily-grid";
import { formatIsoDate } from "@/shared/lib/date";
import { DaySubmissionPanel } from "./day-submission-panel";

/** Роли, чья область — управление, за которое сдаётся день. Тот же набор,
 * что у сервера в `ops/my_assignments.py` (`_DIRECTORATE_HEAD_ROLES`). */
const DIRECTORATE_HEAD_ROLES = new Set([
  "DIRECTORATE_HEAD",
  "HEAD_DIRECTORATE_LINE",
  "HEAD_OPS_UNIT",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function StatusDayClose({ employeeCount }: { employeeCount: number }) {
  // `useSearchParams` — своя граница Suspense: у `/statuses` нет клиентского
  // layout, и без границы прод-сборка падает на пререндере (Plane №112).
  return (
    <Suspense fallback={null}>
      <StatusDayCloseInner employeeCount={employeeCount} />
    </Suspense>
  );
}

function StatusDayCloseInner({ employeeCount }: { employeeCount: number }) {
  const access = useOpsPermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get("businessDate") ?? undefined;
  // Умолчание — «завтра» СЕРВЕРА, а не часов браузера (Plane №988); выбор
  // руками живёт в адресе, как на борде расхода.
  const { businessDate, isOverridden, defaultDate } = useBusinessDate(selected);

  const canSubmit = access.hasPermission("daily_report.mark_update");
  const scopes = [
    ...new Set(
      access.roles
        .filter(
          (role) =>
            DIRECTORATE_HEAD_ROLES.has(role.code) && role.scope_division_id !== null
        )
        .map((role) => role.scope_division_id as number)
    ),
  ];
  const scopeRole = access.roles.find(
    (role) => DIRECTORATE_HEAD_ROLES.has(role.code) && role.scope_division_id !== null
  );
  const divisionId = scopes.length === 1 ? String(scopes[0]) : null;

  const dateValid = businessDate !== null && ISO_DATE.test(businessDate);
  const submissions = useQuery({
    queryKey: ["ops-daily", "day-submission", divisionId, businessDate],
    enabled: canSubmit && divisionId !== null && dateValid,
    queryFn: async () =>
      parseSubmissionList(
        await opsApiClient.get<unknown>(
          `${DAILY_SUBMISSIONS_PATH}?division_id=${encodeURIComponent(
            divisionId as string
          )}&business_date=${encodeURIComponent(businessDate as string)}&limit=200`
        )
      ),
  });

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

  // Пока права грузятся — ничего: мигнувшая и исчезнувшая панель хуже, чем
  // появившаяся с задержкой. Без права сдачи (наблюдатель, оператор
  // отдела) блока нет вовсе — обещание действия, которое сервер отклонит,
  // хуже его отсутствия.
  if (access.isLoading || !canSubmit) return null;

  const window = submitWindow(todayLocalIso());
  const list = submissions.data ?? [];

  return (
    <section
      aria-label="Сдача дня за управление"
      className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)] lg:items-start"
    >
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Деловая дата</h2>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Расход и сдача на день</span>
          <input
            id="status-business-date"
            type="date"
            className="h-11 rounded-md border bg-background px-3 text-base tabular-nums"
            value={businessDate ?? ""}
            min={window[0]}
            max={window[window.length - 1]}
            onChange={(event) => {
              if (event.target.value) setBusinessDate(event.target.value);
            }}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          {businessDate === null
            ? "Загрузка деловой даты…"
            : isOverridden
              ? `Выбрана дата ${formatIsoDate(businessDate)}. По умолчанию — завтра${
                  defaultDate ? ` (${formatIsoDate(defaultDate)})` : ""
                }.`
              : `По умолчанию — завтра, ${formatIsoDate(businessDate)}. Сдать можно любой день на ${SUBMIT_HORIZON_DAYS} дней вперёд.`}
        </p>
        {isOverridden && (
          <button
            type="button"
            className="w-fit rounded-md border px-3 py-1.5 text-sm"
            onClick={() => setBusinessDate("")}
          >
            Вернуть завтра
          </button>
        )}
        {scopeRole && (
          <p className="text-sm text-muted-foreground">
            Подразделение: {scopeRole.scope_division_name ?? `№${scopeRole.scope_division_id}`}
          </p>
        )}
      </div>

      {divisionId === null ? (
        <p role="alert" className="rounded-xl border bg-card p-4 text-sm text-destructive-ink">
          Сдача дня недоступна: у учётки не одно управление в области роли
          начальника ({scopes.length === 0 ? "область не назначена" : `областей: ${scopes.length}`}).
          Обратитесь к администратору.
        </p>
      ) : dateValid ? (
        <div className="grid gap-4">
          <ExpensePreview divisionId={divisionId} businessDate={businessDate as string} />
          <DaySubmissionPanel
            key={`${divisionId}-${businessDate}`}
            divisionId={divisionId}
            businessDate={businessDate as string}
            dateValid={true}
            rowCount={employeeCount}
            dirtyCount={0}
            localDrift={[]}
            submission={currentSubmission(list)}
            submissions={list}
            isLoading={submissions.isPending}
            isError={submissions.isError}
          />
        </div>
      ) : (
        <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Загрузка деловой даты…
        </p>
      )}
    </section>
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
 * нулей. Высота блока зарезервирована (`min-h`), чтобы числа не сдвигали
 * кнопку «Сдать день» при загрузке.
 */
function ExpensePreview({
  divisionId,
  businessDate,
}: {
  divisionId: string;
  businessDate: string;
}) {
  const report = useQuery<StrengthReport>({
    queryKey: ["ops-daily", "expense-preview", divisionId, businessDate],
    queryFn: () =>
      apiClient.getStrengthReport({ businessDate, divisionId: Number(divisionId) }),
  });

  let body: ReactNode;
  if (report.isPending) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        Считаем расход на {formatIsoDate(businessDate)}…
      </p>
    );
  } else if (report.isError || !report.data) {
    body = (
      <p role="alert" className="text-sm text-destructive-ink">
        Расход на {formatIsoDate(businessDate)} не загрузился. Сдавать день
        можно, но проверьте числа на экране ответственного.
      </p>
    );
  } else {
    const { totals, columns, column_labels: labels } = report.data;
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
      className="min-h-[96px] rounded-xl border bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">
          Расход на {formatIsoDate(businessDate)}
        </h3>
        <span className="text-xs text-muted-foreground">
          так день увидит ответственный за сбор сил
        </span>
      </div>
      {body}
      <p className="mt-3 text-xs text-muted-foreground">
        В расход входят кадровые статусы, действующие на эту дату (отпуск,
        больничный, командировка, дежурство…), и участие в ОМ. Поставьте
        статус в таблице ниже — числа обновятся.
      </p>
    </section>
  );
}
