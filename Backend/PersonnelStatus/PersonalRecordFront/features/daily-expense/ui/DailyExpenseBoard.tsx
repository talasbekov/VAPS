"use client";

// «Ежедневный расход» — тот же департамент, что и «Сбор сил» (`/employees`),
// но привычной формой прототипа: управления раскрываются построчно, а не
// разрезом по статусу. Знаменатели (штат, список, колонки расхода) даёт
// РАСХОД (`useStrengthReport`) — свой счёт личного состава экран не заводит;
// деловая дата берётся ИЗ ЕГО ОТВЕТА, а не считается в браузере: в минусовых
// зонах «сегодня» клиента спрашивало бы вчера.
//
// Поимённый список управления грузится ЛЕНИВО — только по первому раскрытию
// строки (`enabled: open`): шесть управлений расхода на одну загрузку экрана
// иначе означали бы шесть запросов на людей и шесть на статусы, которые
// никто ещё не открыл.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";
import { cn } from "@/lib/utils";
import { formatIsoDate } from "@/shared/lib/date";
import { apiClient, type OpsEmployeeStatusRow } from "@/lib/api";
import { opsApiClient } from "@/lib/ops-api";
import { useStrengthReport } from "@/hooks/use-strength-report";
import {
  DAILY_EMPLOYEES_PATH,
  DAILY_SUBMISSIONS_PATH,
  STATUS_TYPE_OPTIONS,
  currentSubmission,
  parseSubmissionList,
} from "@/entities/daily-grid";
import { DaySubmissionPanel } from "@/features/ops-daily";
import { LeadershipStrip } from "./LeadershipStrip";

// Ярлык статуса — из ЕДИНСТВЕННОГО каталога раздела (STATUS_TYPE_OPTIONS),
// свой словарь заводить нельзя. Цвет пилюли НАМЕРЕННО один на все статусы:
// каталог несёт только код и подпись, а колонка расхода (`report_column_code`,
// 11 колонок) и код статуса раздела (17 кодов) — разные пространства кодов;
// придумывать между ними раскраску значило бы завести локальный словарь,
// который и запрещён.
const STATUS_LABEL_BY_CODE = new Map(
  STATUS_TYPE_OPTIONS.map((option) => [option.code, option.label])
);
const IN_SERVICE_LABEL = STATUS_LABEL_BY_CODE.get("IN_SERVICE") ?? "В строю";

/** Нет активного статуса на дату — не «нет данных», а derived «в строю»
 * (тот же инвариант, что в `use-forces-gathering.ts`). */
function statusLabel(code: string | null): string {
  if (code === null) return IN_SERVICE_LABEL;
  return STATUS_LABEL_BY_CODE.get(code) ?? code;
}

/** Строка управления для `DivisionGroup`. Экспортируется целиком — тот же
 * набор полей нужен «Сдаче дня» (Task 3/4): id, списочно, колонки расхода. */
export interface DivisionRowVM {
  id: number;
  name: string;
  listTotal: number;
  columns: Record<string, number>;
}

interface DailyEmployeesResponse {
  results: { id: string; full_name: string; rank_code: string }[];
}

const SKELETON_ROWS = 3;

function SkeletonTableRows() {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <TableRow key={index}>
          <TableCell colSpan={4}>
            <div className="h-4 w-full animate-pulse rounded bg-muted" aria-hidden />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

interface DivisionGroupProps {
  row: DivisionRowVM;
  columnLabels: Record<string, string>;
  businessDate: string;
  open: boolean;
  onToggle: () => void;
}

function DivisionGroup({
  row,
  columnLabels,
  businessDate,
  open,
  onToggle,
}: DivisionGroupProps) {
  // Раскрытую строку НЕ размонтируем при повторном схлопывании — теряли бы
  // скролл и уже загруженные данные. До первого раскрытия таблицы в разметке
  // нет вовсе (запрос ещё не отправлялся, показывать нечего).
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);

  // Ключ НЕ "daily-employees" (тот занят `use-forces-gathering.ts`: тот хук
  // грузит людей по всем управлениям СРАЗУ и БЕЗУСЛОВНО, при любом виде
  // экрана). Совпадением ключа своя ленивая загрузка молча превратилась бы в
  // чужой уже тёплый кэш — раскрытие строки не делало бы запроса вовсе, и
  // фильтр `division_id` было бы нечем проверить.
  const employees = useQuery<DailyEmployeesResponse>({
    queryKey: ["daily-expense-board", "employees", row.id],
    queryFn: () =>
      opsApiClient.get<DailyEmployeesResponse>(
        `${DAILY_EMPLOYEES_PATH}?division_id=${row.id}`
      ),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const statuses = useQuery<OpsEmployeeStatusRow[]>({
    queryKey: ["daily-expense-board", "statuses", row.id, businessDate],
    queryFn: () => apiClient.getOpsStatusesOn({ businessDate, divisionId: row.id }),
    enabled: open,
  });

  const statusByEmployee = new Map<number, string>();
  for (const entry of statuses.data ?? []) {
    statusByEmployee.set(entry.employee_id, entry.status_type_code);
  }

  const isPending = employees.isPending || statuses.isPending;
  const isError = employees.isError || statuses.isError;
  const people = employees.data?.results ?? [];

  const nonZeroColumns = Object.entries(row.columns).filter(([, count]) => count > 0);

  // Состояние сдачи ЭТОГО управления — СВОЯ живая правда для его собственной
  // панели: без запроса панель лгала бы «день не сдан», даже когда он уже
  // сдан. Ключ СВОЙ (`daily-expense-board`), не занят `use-forces-gathering.ts`
  // (`daily-employees`) и отличается от ключей, которые заводит сама панель
  // (`ops-daily`). Не гейтим `enabled`: `businessDate` тут ВСЕГДА валидная
  // строка сервера (родитель монтирует группу только когда `data` уже есть).
  const submissionDivisionId = String(row.id);
  const daySubmissionQuery = useQuery({
    queryKey: [
      "daily-expense-board",
      "day-submission",
      submissionDivisionId,
      businessDate,
    ],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?division_id=${encodeURIComponent(
          submissionDivisionId
        )}&business_date=${encodeURIComponent(businessDate)}`
      ),
  });
  const daySubmissions = parseSubmissionList(daySubmissionQuery.data);
  const daySubmission = currentSubmission(daySubmissions);

  return (
    // `role="group"` — оборачивает ВСЮ группу (шапку + панель сдачи + раскрытую
    // таблицу) ОДНИМ именем управления: панель сдачи теперь ВСЕГДА видна и
    // живёт ВНЕ раскрываемого `role="region"` ниже — без своего имени на
    // контейнере пробе было бы нечем отличить кнопку «Сдать день» ЭТОГО
    // управления от кнопки соседнего в плоском дереве ролей.
    <div className="rounded-lg border" role="group" aria-label={row.name}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ChevronRight
            className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden
          />
          {row.name}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="tabular-nums">
            {row.listTotal} списочно
          </Badge>
          {nonZeroColumns.map(([code, count]) => (
            <Badge key={code} variant="secondary" className="tabular-nums">
              {columnLabels[code] ?? code}: {count}
            </Badge>
          ))}
        </span>
      </button>

      {/* Панель сдачи ЭТОГО управления — ВСЕГДА видна (не гейтится
          `open`/`everOpened`), рядом со счётчиками шапки, а не внутри
          раскрытой таблицы: решение координатора 21.08 — одна кнопка на весь
          департамент семантически невозможна без бэк-этапа (сдача
          версионируется ПО УПРАВЛЕНИЮ, `DaySubmission.division_id`), сводка
          «сдано N из M» живёт на уровне борда, а само действие — здесь.
          Компонент НЕ переписан: бейдж «День сдан: vN · …» и кнопка
          «Исправить сдачу» — его собственная, восстановленная логика. */}
      <div className="border-t px-3 py-2">
        <DaySubmissionPanel
          key={`${submissionDivisionId}-${businessDate}`}
          divisionId={submissionDivisionId}
          businessDate={businessDate}
          dateValid={true}
          rowCount={row.listTotal}
          dirtyCount={0}
          localDrift={[]}
          submission={daySubmission}
          submissions={daySubmissions}
          isLoading={daySubmissionQuery.isPending}
          isError={daySubmissionQuery.isError}
        />
      </div>

      {everOpened && (
        <div hidden={!open} role="region" aria-label={row.name} className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">№</TableHead>
                <TableHead>ФИО</TableHead>
                <TableHead>Звание</TableHead>
                <TableHead>Статус на {formatIsoDate(businessDate)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending && <SkeletonTableRows />}
              {!isPending && isError && (
                <TableRow>
                  <TableCell colSpan={4} className="whitespace-normal text-muted-foreground">
                    Расход раздела не ответил — список показать нечем
                  </TableCell>
                </TableRow>
              )}
              {!isPending && !isError && people.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="whitespace-normal text-muted-foreground">
                    людей в срезе нет
                  </TableCell>
                </TableRow>
              )}
              {!isPending &&
                !isError &&
                people.map((person, index) => (
                  <TableRow key={person.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {index + 1}
                    </TableCell>
                    <TableCell>{person.full_name}</TableCell>
                    <TableCell>{person.rank_code}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {statusLabel(statusByEmployee.get(Number(person.id)) ?? null)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function DailyExpenseBoard() {
  const strength = useStrengthReport(true);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Через локальный const, а не `strength.data` напрямую: TS не удерживает
  // сужение non-null через замыкание `.map`, обращённое к полю объекта.
  const data = strength.data;
  const totals = data?.totals;

  // Сводка сдачи дня — «Сдано N из M управлений» + кто не сдал. Кнопка
  // сдачи переехала В КАЖДУЮ группу управления (решение координатора 21.08,
  // журнал 21→22.08): сдача версионируется ПО УПРАВЛЕНИЮ
  // (`DaySubmission.division_id`) — одна кнопка на весь департамент была бы
  // семантической ложью (реально сдавала бы одно управление, выглядела бы
  // как «весь департамент сдан»). Источник N/M — ЖИВЫЕ ответы (та же ручка,
  // фильтр по `business_date` без `division_id`, `is_current: true`,
  // уникальные `division_id`, сверенные со строками расхода) — свой счёт не
  // заводим.
  const businessDate = data?.business_date ?? null;
  const dateValid = businessDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(businessDate);
  const submissionsSummaryQuery = useQuery({
    queryKey: ["daily-expense-board", "submissions", businessDate],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?business_date=${encodeURIComponent(
          businessDate as string
        )}&limit=200`
      ),
    enabled: dateValid,
  });
  const submittedDivisionIds = new Set(
    parseSubmissionList(submissionsSummaryQuery.data)
      .filter((submission) => submission.is_current)
      .map((submission) => submission.division_id)
  );
  const submittedRows =
    data?.rows.filter((row) => submittedDivisionIds.has(String(row.division_id))) ?? [];
  const notSubmittedRows =
    data?.rows.filter((row) => !submittedDivisionIds.has(String(row.division_id))) ?? [];

  return (
    <section role="region" aria-label="Ежедневный расход" className="space-y-4">
      {strength.isPending && (
        <div className="space-y-2">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div
              key={index}
              className="h-11 w-full animate-pulse rounded-lg bg-muted"
              aria-hidden
            />
          ))}
        </div>
      )}

      {strength.isError && (
        <p className="text-sm text-muted-foreground">
          Ежедневный расход не ответил — управления показать нечем.
        </p>
      )}

      {/* Сводная строка департамента: знаменатели РАСХОДА, те же плитки, что
          и у соседней вкладки «Сбор сил», но полный набор totals — здесь нет
          разреза по статусу, который сужал бы набор до пяти чисел. */}
      {totals && (
        <div
          role="group"
          aria-label="Сводка по департаменту"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          <StatCard
            label="По штату"
            value={totals.staff_total}
            caption="Штатных единиц по расходу"
          />
          <StatCard
            label="По списку"
            value={totals.list_total}
            caption="Занятых слотов — без вакансий"
          />
          <StatCard
            label="Вакансий"
            value={totals.vacancies}
            tone="warning"
            caption="Незанятые штатные единицы"
          />
          <StatCard
            label="Прикомандировано"
            value={totals.attached}
            tone="info"
            caption="Пришли из других подразделений"
          />
          <StatCard
            label="Вне списка"
            value={totals.off_list}
            tone="neutral"
            caption="Не входят в списочный состав"
          />
        </div>
      )}

      {/* Сводка сдачи дня — СРАЗУ под сводной строкой, там, где человек
          только что проверил цифры. Сама кнопка «Сдать день» — в шапке
          КАЖДОГО управления ниже (сдача версионируется по управлению, одной
          кнопки на департамент быть не может). */}
      {data && (
        <div
          role="group"
          aria-label="Сводка сдачи дня"
          className="rounded-lg border bg-card p-3 text-sm"
        >
          <p className="font-medium">
            Сдано {submittedRows.length} из {data.rows.length} управлений на{" "}
            {formatIsoDate(data.business_date)}
          </p>
          {notSubmittedRows.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              Не сдали: {notSubmittedRows.map((row) => row.name).join(", ")}
            </p>
          )}
        </div>
      )}

      {/* «Руководство департамента» — ПЕРВЫМ, над рядовыми управлениями,
          раскрыт всегда (своя карточка, не строка в списке ниже). Своя дата —
          та же `data.business_date`, что и у управлений: оба блока обязаны
          говорить об одном дне. */}
      {data && <LeadershipStrip businessDate={data.business_date} />}

      {data && (
        <div className="space-y-2">
          {data.rows.map((row) => {
            const vm: DivisionRowVM = {
              id: row.division_id,
              name: row.name,
              listTotal: row.list_total,
              columns: row.columns,
            };
            return (
              <DivisionGroup
                key={row.division_id}
                row={vm}
                columnLabels={data.column_labels}
                businessDate={data.business_date}
                open={openIds.has(row.division_id)}
                onToggle={() => toggle(row.division_id)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
