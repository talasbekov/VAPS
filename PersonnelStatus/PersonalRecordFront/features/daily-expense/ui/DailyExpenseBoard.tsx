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
// никто ещё не открыл. Состояние сдачи дня подчиняется ТОМУ ЖЕ правилу —
// ревью 21.08 поймало нарушение (N безусловных запросов на состояние сдачи,
// по одному на управление, независимо от `open`) и потребовало починки:
// сейчас борд читает состояние сдачи ОДНИМ списочным запросом
// (`GET daily-submissions?business_date=`, без `division_id` — фильтр
// поддержан) и раздаёт его строкам; интерактивная панель `DaySubmissionPanel`
// (со своим собственным внутренним запросом истории версий) монтируется
// ТОЛЬКО при раскрытии строки — при схлопывании её место занимает лёгкий
// бейдж, собранный из ТОГО ЖЕ списочного ответа, без нового запроса.
import { useCallback, useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatIsoDate, formatIsoDateTime } from "@/shared/lib/date";
import { apiClient, type OpsEmployeeStatusRow } from "@/lib/api";
import { opsApiClient } from "@/lib/ops-api";
import { useStrengthReport } from "@/hooks/use-strength-report";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import {
  DAILY_DIVISIONS_PATH,
  DAILY_EMPLOYEES_PATH,
  DAILY_SUBMISSIONS_PATH,
  STATUS_LABEL_BY_CODE,
  currentSubmission,
  parseSubmissionList,
} from "@/entities/daily-grid";
import type { DaySubmission } from "@/entities/daily-grid";
import { DaySubmissionPanel } from "@/features/ops-daily";
import { SetStatusDialog } from "./SetStatusDialog";
import { useCreateOpsStatus } from "@/hooks/use-ops-status-write";
import { LeadershipStrip } from "./LeadershipStrip";
import { SummaryVersions } from "./SummaryVersions";

// Ярлык статуса — из ЕДИНСТВЕННОГО каталога раздела (`STATUS_LABEL_BY_CODE`,
// `entities/daily-grid`), свой словарь заводить нельзя. До ревью ветки 22.08
// эта карта строилась здесь дословной копией — и такие же копии стояли в
// `LeadershipStrip` и на экране профиля; теперь она одна.
const IN_SERVICE_LABEL = STATUS_LABEL_BY_CODE.get("IN_SERVICE") ?? "В строю";

// Цвет пилюли НАМЕРЕННО один на все статусы: каталог несёт только код и
// подпись, а колонка расхода (`report_column_code`, 11 колонок) и код статуса
// раздела (17 кодов) — разные пространства кодов; придумывать между ними
// раскраску значило бы завести локальный словарь, который и запрещён. Соседний
// вид того же экрана («Сбор сил») пилюли КРАСИТ — у него в руках кадровые коды
// `EMPLOYEE_STATUS_PAINT`, к кодам раздела не сводимые. Расхождение видно
// глазом, поэтому оно названо вслух подписью под списком (`PAINT_GAP_LINE`), а
// не оставлено читателю на догадку.
//
// Однострочная константа, а не текст прямо в JSX: JSX схлопывает переносы
// строк по своим правилам, а строка пинится e2e-пробой дословно.
const PAINT_GAP_LINE =
  "Статусы в списке показаны одной пилюлей без цвета: коды статусов раздела и колонки расхода — разные пространства кодов, и раскраска между ними была бы придуманным на фронте словарём; появится бэк-этапом.";

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
  /** Путь до подразделения СВЕРХУ ВНИЗ, без корня организации (Plane №235). */
  path: string[];
  listTotal: number;
  columns: Record<string, number>;
  /** Сдаёт ли ДЕНЬ ЗА ЭТО управление тот, кто смотрит (область права сдачи с
   * бэка, а не догадка фронта). Только он вправе раскрыть список ДО сдачи —
   * см. `expandable` в `DivisionGroup`. */
  canSubmit: boolean;
  /** Момент ПОСЛЕДНЕЙ сдачи любого дня, ISO с зоной, или null — «не сдавали
   * ни разу». Именно момент, а не деловой день: заказчик просил «дату
   * обновления» списка, а обновляет его сдача версии. */
  lastSubmittedAt: string | null;
}

/** Строка `/api/ops/daily/divisions/`. `can_submit` и `last_submitted_*`
 * добавлены бэкендом в Plane №295 — старые поля не тронуты, соседние
 * читатели (`LeadershipStrip`, аналитика) продолжают читать своё. */
interface DailyDivisionRow {
  id: string;
  name: string;
  ancestors?: string[];
  can_submit?: boolean;
  last_submitted_at?: string | null;
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

/** Состояние сдачи ОДНОГО управления — производная ОДНОГО списочного запроса
 * борда (`DailyExpenseBoard`), а не своего запроса группы: `isPending`/
 * `isError` тут ОБЩИЕ на все управления разом (запрос один), `submission`/
 * `submissions` — уже отфильтрованы по этому division_id. */
interface DivisionSubmissionSummary {
  isPending: boolean;
  isError: boolean;
  submission: DaySubmission | null;
  submissions: DaySubmission[];
}

/** Свёрнутая шапка группы: лёгкий бейдж БЕЗ интерактивности и БЕЗ своего
 * запроса — питается тем же `DivisionSubmissionSummary`, что и раскрытая
 * панель. Ошибка чтения показана СЛОВАМИ отдельно от «не сдал»: молчаливое
 * чтение отказа как «не сдал» было бы враньём (находка ревью).
 *
 * С Plane №295 бейдж несёт ещё и ПРИЧИНУ, по которой строка не раскрывается,
 * и дату: «не сдан» без даты не отличает «сдавали вчера, сегодня ещё нет» от
 * «не сдавали ни разу», а сводящему за департамент нужно ровно это — понять,
 * кого торопить. Причина стоит РЯДОМ с недоступной шапкой, а не всплывает
 * подсказкой: недоступный элемент без объяснения читается как поломка. */
function CollapsedSubmissionBadge({
  summary,
  row,
  expandable,
}: {
  summary: DivisionSubmissionSummary;
  row: DivisionRowVM;
  expandable: boolean;
}) {
  if (summary.isPending) {
    return <span className="text-muted-foreground">Загрузка состояния сдачи…</span>;
  }
  if (summary.isError) {
    return (
      <span role="alert" className="text-muted-foreground">
        Не удалось узнать, сдан ли день
      </span>
    );
  }
  if (summary.submission === null) {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <span>День не сдан</span>
        <span aria-hidden>·</span>
        <span>
          {row.lastSubmittedAt === null
            ? "список не сдавали ни разу"
            : `последняя сдача ${formatIsoDateTime(row.lastSubmittedAt)}`}
        </span>
        {/* Причина ОДНОЙ строкой со состоянием, а не абзацем под ним: на
            борде департамента несданных управлений бывает полсотни, и
            отдельная строка объяснения повторилась бы полсотни раз, забив
            экран собой. */}
        {!expandable && (
          <>
            <span aria-hidden>·</span>
            <span>список раскроется после сдачи</span>
          </>
        )}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        Сдан · v{summary.submission.version}
        {summary.submission.late && " · с опозданием"}
      </span>
      <span className="text-xs text-muted-foreground">
        Обновлено {formatIsoDateTime(summary.submission.submitted_at)}
      </span>
    </span>
  );
}

interface DivisionGroupProps {
  row: DivisionRowVM;
  columnLabels: Record<string, string>;
  businessDate: string;
  open: boolean;
  onToggle: () => void;
  submissionsSummary: DivisionSubmissionSummary;
}

function DivisionGroup({
  row,
  columnLabels,
  businessDate,
  open: openRequested,
  onToggle,
  submissionsSummary,
}: DivisionGroupProps) {
  // ПРАВИЛО СОСТОЯНИЯ, а не права (Plane №295). Сводящему за департамент
  // список НЕсданного управления не раскрывается: пока день не сдан, список —
  // черновик, и считать по нему расход значит считать по незаконченным
  // данным. Прятать строку целиком нельзя — тогда «сдано 4 из 6» остаётся
  // единственным следом отставших, и назвать их сводящий уже не может.
  //
  // Исключение ровно одно и оно обязательное: НАЧАЛЬНИК самого управления
  // (`row.canSubmit` — область права сдачи с бэка). Без него цепочка не
  // стартовала бы вовсе: статусы своим людям он проставляет ИМЕННО в этом
  // раскрытом списке, а сдать день, ни разу его не открыв, невозможно.
  //
  // Неизвестное состояние (`isPending`/`isError`) раскрытием НЕ считается:
  // «не смогли узнать» — не «сдано», и открывать по нему список значило бы
  // выдать догадку за факт. Строка при этом уже говорит словами, что
  // состояние прочитать не удалось.
  const expandable =
    row.canSubmit ||
    (!submissionsSummary.isPending &&
      !submissionsSummary.isError &&
      submissionsSummary.submission !== null);

  // Раскрыто ФАКТИЧЕСКИ — только если раскрытие вообще позволено. Строку
  // могли открыть, пока состояние сдачи ещё грузилось, а ответ пришёл
  // «не сдано» — оставить её открытой значило бы показать тот самый черновик
  // в обход правила.
  const open = openRequested && expandable;

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

  // Кому сейчас проставляют статус: null — окно закрыто. Состояние держит
  // ГРУППА, а не строка таблицы: окно одно на управление, и его состояние не
  // должно жить в каждой из сотен строк.
  const [statusFor, setStatusFor] = useState<{ id: string; name: string } | null>(
    null
  );
  const createStatus = useCreateOpsStatus();

  const isPending = employees.isPending || statuses.isPending;
  const isError = employees.isError || statuses.isError;
  const people = employees.data?.results ?? [];

  const nonZeroColumns = Object.entries(row.columns).filter(([, count]) => count > 0);

  return (
    // `role="group"` — оборачивает ВСЮ группу (шапку + сдачу + раскрытую
    // таблицу) ОДНИМ именем управления: без своего имени на контейнере пробе
    // было бы нечем отличить кнопку «Сдать день» ЭТОГО управления от кнопки
    // соседнего в плоском дереве ролей.
    <div
      className="rounded-lg border"
      role="group"
      // Имя группы несёт путь: три одноимённых управления в разных
      // департаментах иначе неразличимы ни для скринридера, ни для проб
      // (Plane №235).
      aria-label={row.path.length > 0 ? `${row.name} · ${row.path.join(" › ")}` : row.name}
    >
      <button
        type="button"
        // `aria-expanded` ставится ТОЛЬКО у раскрываемой строки: у кнопки,
        // которая ничего не раскрывает, оно врало бы про «свёрнуто, нажми».
        // `aria-disabled` вместо `disabled`: выключенная кнопка выпадает из
        // обхода клавиатурой, и причина «список появится после сдачи», которая
        // стоит внутри той же группы, до читающего с клавиатуры не доедет.
        aria-expanded={expandable ? open : undefined}
        aria-disabled={expandable ? undefined : true}
        onClick={expandable ? onToggle : undefined}
        className={cn(
          "flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left",
          expandable ? "hover:bg-muted/40" : "cursor-not-allowed opacity-70"
        )}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 transition-transform",
              open && "rotate-90",
              !expandable && "opacity-40"
            )}
            aria-hidden
          />
          <span className="flex flex-col">
            {row.name}
            {/* Имена подразделений уникальны только внутри родителя: на
                структуре из тридцати шести департаментов «Второе сквозное
                управление» встречается в каждом, и три одинаковые строки
                подряд не давали ответить, чей день сдаёшь (Plane №235). */}
            {row.path.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {row.path.join(" › ")}
              </span>
            )}
          </span>
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

      {/* Сдача ЭТОГО управления — рядом со счётчиками шапки, а не внутри
          раскрытой таблицы: решение координатора 21.08 — одна кнопка на весь
          департамент семантически невозможна без бэк-этапа (сдача
          версионируется ПО УПРАВЛЕНИЮ). Второе решение (после ревью 21.08):
          ИНТЕРАКТИВНАЯ панель (кнопка/подтверждение/amendment-форма) грузится
          ТОЛЬКО при раскрытии — она несёт СВОЙ внутренний запрос истории
          версий (см. восстановленный файл), и держать её смонтированной
          всегда означало бы вернуть N eager-запросов, которых правило
          ленивости файла как раз запрещает. Свёрнутая шапка получает лёгкий
          бейдж БЕЗ интерактивности и БЕЗ своего запроса — из ТОГО ЖЕ
          списочного ответа борда, что уже прочитан для сводки выше.
          Компонент панели НЕ переписан: бейдж «День сдан: vN · …» и кнопка
          «Исправить сдачу» внутри неё — её собственная восстановленная логика. */}
      <div className="border-t px-3 py-2 text-sm">
        {open ? (
          <DaySubmissionPanel
            key={`${row.id}-${businessDate}`}
            divisionId={String(row.id)}
            businessDate={businessDate}
            dateValid={true}
            rowCount={row.listTotal}
            dirtyCount={0}
            localDrift={[]}
            submission={submissionsSummary.submission}
            submissions={submissionsSummary.submissions}
            isLoading={submissionsSummary.isPending}
            isError={submissionsSummary.isError}
          />
        ) : (
          <CollapsedSubmissionBadge
            summary={submissionsSummary}
            row={row}
            expandable={expandable}
          />
        )}
      </div>

      {everOpened && (
        <div
          hidden={!open}
          role="region"
          aria-label={row.path.length > 0 ? `${row.name} · ${row.path.join(" › ")}` : row.name}
          className="border-t"
        >
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
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {statusLabel(statusByEmployee.get(Number(person.id)) ?? null)}
                        </Badge>
                        {/* ПРОСТАНОВКА СТАТУСА (Plane №274, Ш-4). Экрана для
                            этого не было вовсе: доска только показывала
                            статусы, и первый шаг суточного расхода
                            («начальник управления каждому проставляет
                            статус») проходился вызовами API. */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setStatusFor({
                              id: String(person.id),
                              name: person.full_name,
                            })
                          }
                        >
                          Проставить
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}

      {statusFor !== null && (
        <SetStatusDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setStatusFor(null);
              createStatus.reset();
            }
          }}
          employeeId={statusFor.id}
          employeeName={statusFor.name}
          businessDate={businessDate}
          isSaving={createStatus.isPending}
          failure={createStatus.error?.message ?? null}
          onSubmit={async ({ statusCode, participations }) => {
            await createStatus.mutateAsync({
              employee_id: Number(statusFor.id),
              status_type_code: statusCode,
              date_start: businessDate,
              // Полуинтервал бэка [начало, конец): статус на ОДИН день
              // закрывается СЛЕДУЮЩИМ днём, иначе строка пуста и статуса нет
              // ни одного дня.
              date_end: addOneDay(businessDate),
              participations,
            });
            setStatusFor(null);
          }}
        />
      )}
    </div>
  );
}

/** Следующий календарный день в ISO — для полуинтервала бэка. */
function addOneDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function DailyExpenseBoard() {
  // Гейт права — ТОТ ЖЕ, что у соседних экранов той же ручки: командный центр
  // (`command-center/page.tsx`) и аналитика (`analytics/page.tsx`) включают
  // `useStrengthReport` только при `status.view`. Ревью ветки 22.08 нашло, что
  // здесь стояло жёсткое `true` — единственная из четырёх точек вызова хука:
  // без права страница била в закрытые ручки и печатала 403 как «Ежедневный
  // расход не ответил», то есть винила сервер в нехватке права. `useOpsPermissions`
  // работает и вне `/security-ops` (запрос уходит безусловно, `enabled: true`).
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const canRead = hasPermission("status.view");
  const gateAllowed = !permissionsLoading && canRead;
  const strength = useStrengthReport(gateAllowed);
  const queryClient = useQueryClient();

  // Путь до подразделения приходит ОТДЕЛЬНЫМ лёгким списком
  // (`/api/ops/daily/divisions/`, Plane №235), а не полем строки расхода:
  // строка расхода собирается службой отчёта, которую читают ещё и выгрузки
  // DOCX/CSV/XLSX, и ради подписи на экране её контракт не трогаем.
  const divisionsQuery = useQuery<{ results: DailyDivisionRow[] }>({
    queryKey: ["daily-expense-board", "divisions"],
    queryFn: () =>
      opsApiClient.get<{ results: DailyDivisionRow[] }>(DAILY_DIVISIONS_PATH),
    staleTime: 5 * 60_000,
  });
  // Один индекс на все поля строки подразделения, а не карта на поле: с
  // Plane №295 их стало три (путь, право сдачи, последняя сдача), и три
  // параллельные карты по одному ключу разошлись бы при первом же четвёртом.
  const metaByDivision = useMemo(() => {
    const map = new Map<string, DailyDivisionRow>();
    for (const row of divisionsQuery.data?.results ?? []) {
      map.set(String(row.id), row);
    }
    return map;
  }, [divisionsQuery.data]);
  // Место управления в ОЧЕРЕДИ — позиция в списке подразделений, который
  // сервер отдаёт обходом дерева (Plane №296). Расход (`strength-report`)
  // сортирует свои строки ПО ИМЕНИ, и его контракт трогать нельзя — его
  // читают выгрузки DOCX/CSV/XLSX; поэтому очередь наводится здесь, на
  // экране, ключом из уже загруженного списка.
  const orderByDivision = useMemo(() => {
    const map = new Map<string, number>();
    let index = 0;
    for (const row of divisionsQuery.data?.results ?? []) {
      map.set(String(row.id), index);
      index += 1;
    }
    return map;
  }, [divisionsQuery.data]);
  // Подпись подразделения ДЛЯ ПЕРЕЧИСЛЕНИЯ — путь в СКОБКАХ, а не через «·»,
  // как в шапке группы: в списке через запятую «·» читался бы как ещё один
  // элемент. Ровно тот же формат, что у строки «Не сдали» выше (Plane №249).
  // Голого имени не хватает: одноимённых управлений на реальной структуре
  // трое (Plane №235).
  const labelOfDivision = useCallback(
    (divisionId: number): string => {
      const meta = metaByDivision.get(String(divisionId));
      if (meta === undefined) return `подразделение №${divisionId}`;
      const path = meta.ancestors ?? [];
      return path.length > 0 ? `${meta.name} (${path.join(" › ")})` : meta.name;
    },
    [metaByDivision]
  );
  const pathByDivision = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [id, row] of metaByDivision) {
      map.set(id, row.ancestors ?? []);
    }
    return map;
  }, [metaByDivision]);
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

  // Сводка сдачи дня — «Сдано N из M управлений» + кто не сдал, и state для
  // КАЖДОГО управления (бейдж/панель в `DivisionGroup`) — из ОДНОГО списочного
  // запроса, а не N: ревью 21.08 поймало нарушение файлового правила
  // ленивости («шесть управлений … иначе означали бы шесть запросов…», шапка
  // файла) — предыдущая версия читала состояние сдачи N запросами
  // (`useQueries`, по одному на управление) БЕЗУСЛОВНО, независимо от того,
  // раскрыта ли строка. Разбор факта: restored-панель `DaySubmissionPanel`
  // САМА заводит внутренний запрос истории версий на каждое монтирование
  // (`historyQuery`, `["ops-daily","division-submissions",divisionId]`,
  // `enabled: divisionId !== null && dateValid` — БЕЗ гейта на `open`) — то
  // есть N рождала САМА панель, будучи смонтированной у каждой группы сразу.
  // Починка (без правки восстановленного файла): панель теперь монтируется
  // ЛЕНИВО (см. `DivisionGroup`, только при `open`), а борд читает состояние
  // сдачи ВСЕХ управлений ОДНИМ запросом (`business_date`-фильтр без
  // `division_id` — поддержан живой ручкой), раздавая срез каждой строке.
  const businessDate = data?.business_date ?? null;
  const dateValid = businessDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(businessDate);
  const submissionsListQuery = useQuery({
    queryKey: ["daily-expense-board", "submissions", businessDate],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?business_date=${encodeURIComponent(
          businessDate as string
        )}&limit=200`
      ),
    // Гейт права — тот же, что у расхода выше: без `status.view` ручка
    // ответила бы 403, и сводка сдачи прочла бы отказ как «нечем посчитать».
    enabled: gateAllowed && dateValid,
  });

  // Свежесть после сдачи БЕЗ правки восстановленного файла: панель на
  // submit/amend success сама зовёт `invalidateQueries({queryKey:
  // ["ops-daily","day-submission",divisionId,businessDate]})` И
  // `invalidateQueries({queryKey: ["ops-daily","division-submissions",
  // divisionId]})` — второй ключ СОВПАДАЕТ с её же `historyQuery`, которая
  // РЕАЛЬНО есть в кэше, пока панель смонтирована (т.е. пока управление
  // раскрыто — единственное состояние, из которого вообще можно сдать день).
  // Подписка на `QueryCache` ловит ИМЕННО это событие (`action.type ===
  // "invalidate"` — вызывается ТОЛЬКО явным `invalidateQueries`, обычная
  // загрузка/рефетч такого action не порождает) и инвалидирует список борда.
  // Никакого колбэка в контракте панели заводить не пришлось.
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "invalidate") return;
      const key = event.query.queryKey;
      if (key[0] !== "ops-daily" || key[1] !== "division-submissions") return;
      void queryClient.invalidateQueries({
        queryKey: ["daily-expense-board", "submissions", businessDate],
      });
    });
  }, [queryClient, businessDate]);

  // Управления «по очереди» (Plane №296): порядок дерева, пришедший списком
  // подразделений. Пока список не ответил, порядок остаётся тем, что дал
  // расход, — переставлять строки на глазах у человека хуже, чем показать их
  // сразу в порядке источника.
  const orderedRows = useMemo(() => {
    const rows = data?.rows ?? [];
    if (orderByDivision.size === 0) return rows;
    return [...rows].sort((left, right) => {
      const leftIndex = orderByDivision.get(String(left.division_id));
      const rightIndex = orderByDivision.get(String(right.division_id));
      // Управление, которого нет в списке подразделений, уезжает в хвост, а
      // не наверх: «неизвестно где» — не «первым».
      if (leftIndex === undefined && rightIndex === undefined) return 0;
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      return leftIndex - rightIndex;
    });
  }, [data, orderByDivision]);

  const listIsPending = dateValid && submissionsListQuery.isPending;
  const listIsError = submissionsListQuery.isError;

  const submissionsByDivision = new Map<string, DaySubmission[]>();
  for (const submission of parseSubmissionList(submissionsListQuery.data)) {
    const list = submissionsByDivision.get(submission.division_id) ?? [];
    list.push(submission);
    submissionsByDivision.set(submission.division_id, list);
  }

  function summaryFor(divisionId: number): DivisionSubmissionSummary {
    const divisionSubs = submissionsByDivision.get(String(divisionId)) ?? [];
    return {
      isPending: listIsPending,
      isError: listIsError,
      submission: listIsPending || listIsError ? null : currentSubmission(divisionSubs),
      submissions: divisionSubs,
    };
  }

  // N/M — «неизвестно» вместо «не сдал» при ошибке/загрузке (находка ревью):
  // упавшая или ещё не ответившая ручка не должна молча читаться как «никто
  // не сдал» — пустые списки здесь означают именно «нечем посчитать», а не
  // «ноль сдач».
  // Считается по УПОРЯДОЧЕННЫМ строкам (Plane №296): перечисление «не сдали»
  // читается вместе со списком ниже, и две разные очереди в одном экране
  // заставляли бы искать управление дважды.
  const submittedRows =
    listIsPending || listIsError
      ? []
      : orderedRows.filter((row) => currentSubmission(submissionsByDivision.get(String(row.division_id)) ?? []) !== null);
  const notSubmittedRows =
    listIsPending || listIsError
      ? []
      : orderedRows.filter((row) => currentSubmission(submissionsByDivision.get(String(row.division_id)) ?? []) === null);

  // Права ещё грузятся / права нет — честная строка вместо кожи борда, как у
  // соседних экранов той же ручки («Светофор сдачи закрыт правом „Статусы:
  // просмотр"» в аналитике). Ветка обязана стоять ОТДЕЛЬНО от `strength.isError`:
  // без права запрос выключен, и `isPending` у выключенного запроса остаётся
  // true навсегда — борд крутил бы скелет, а не объяснял отказ.
  if (permissionsLoading) {
    return (
      <section role="region" aria-label="Ежедневный расход" className="space-y-4">
        <p className="text-sm text-muted-foreground">Загрузка прав…</p>
      </section>
    );
  }
  if (!canRead) {
    return (
      <section role="region" aria-label="Ежедневный расход" className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Ежедневный расход закрыт правом «Статусы: просмотр».
        </p>
      </section>
    );
  }

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
          кнопки на департамент быть не может). Три состояния явные: ждём
          ответ / не удалось узнать / готово — «не удалось» НЕ схлопнуто в
          «Сдано 0 из M» (это была бы видимая ложь при живой ошибке ручки). */}
      {data && (
        <div
          role="group"
          aria-label="Сводка сдачи дня"
          className="rounded-lg border bg-card p-3 text-sm"
        >
          {listIsPending && (
            <p className="text-muted-foreground">Загрузка сводки сдачи…</p>
          )}
          {!listIsPending && listIsError && (
            <p role="alert" className="text-muted-foreground">
              Не удалось узнать, кто сдал день — сводка недоступна
            </p>
          )}
          {!listIsPending && !listIsError && (
            <>
              <p className="font-medium">
                Сдано {submittedRows.length} из {data.rows.length} управлений на{" "}
                {formatIsoDate(data.business_date)}
              </p>
              {notSubmittedRows.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  {/* Имя + путь: одноимённых управлений на реальной структуре
                      трое, и перечисление одних имён читалось как «не сдало
                      одно и то же управление трижды» (Plane №249). */}
                  Не сдали:{" "}
                  {notSubmittedRows
                    .map((row) => {
                      const path = pathByDivision.get(String(row.division_id)) ?? [];
                      return path.length > 0
                        ? `${row.name} (${path.join(" › ")})`
                        : row.name;
                    })
                    .join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* «Суточный свод» (Task 5) — версии СВОДНОГО заявления департамента
          (составное подразделение, не листовые управления ниже). Стоит
          РЯДОМ со сводкой сдачи дня выше — оба блока рассказывают одну и ту
          же историю «кто отчитался», только на разных уровнях (управление /
          департамент целиком), и читателю естественно сравнить их одним
          взглядом. «Руководство» и построчный список ниже — другая история
          («кто сейчас на месте»), поэтому отделены. */}
      {data && (
        <SummaryVersions
          businessDate={data.business_date}
          boardDivisionIds={data.rows.map((row) => row.division_id)}
          // Подписи подразделений берутся из УЖЕ загруженного списка борда:
          // отказ сборки свода называет отставших числами, а человеку нужны
          // имена (Plane №297).
          labelOfDivision={labelOfDivision}
        />
      )}

      {/* «Руководство департамента» — ПЕРВЫМ среди рядовых управлений,
          раскрыт всегда (своя карточка, не строка в списке ниже). Своя дата —
          та же `data.business_date`, что и у управлений: оба блока обязаны
          говорить об одном дне. */}
      {data && <LeadershipStrip businessDate={data.business_date} />}

      {data && (
        <div className="space-y-2">
          {orderedRows.map((row) => {
            const meta = metaByDivision.get(String(row.division_id));
            const vm: DivisionRowVM = {
              id: row.division_id,
              name: row.name,
              path: meta?.ancestors ?? [],
              listTotal: row.list_total,
              columns: row.columns,
              // Пока список подразделений не ответил, право сдачи считается
              // ОТСУТСТВУЮЩИМ: «не знаем» здесь обязано читаться как «нельзя»,
              // иначе строка на мгновение раскрывалась бы всем.
              canSubmit: meta?.can_submit === true,
              lastSubmittedAt: meta?.last_submitted_at ?? null,
            };
            return (
              <DivisionGroup
                key={row.division_id}
                row={vm}
                columnLabels={data.column_labels}
                businessDate={data.business_date}
                open={openIds.has(row.division_id)}
                onToggle={() => toggle(row.division_id)}
                submissionsSummary={summaryFor(row.division_id)}
              />
            );
          })}
        </div>
      )}

      {/* Честная подпись — ПОД списком, как у «Руководства департамента» и у
          вкладок паспорта объекта. Расхождение видно глазом (соседний вид
          «Сбор сил» на этом же экране красит пилюли статусов), и молчать о
          нём значило бы оставить читателю догадку «почему тут серо». */}
      {data && <p className="text-xs text-muted-foreground">{PAINT_GAP_LINE}</p>}
    </section>
  );
}
