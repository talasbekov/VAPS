"use client";

// Шаг 3 «Расстановка» — по экрану прототипа Smart Josparlau: панель сводки,
// слева дерево «Объекты и посты», в центре выбранный пост, справа подбор
// «Доступные сотрудники».
//
// Шаг покрывает ТРИ стадии бэкенда: DEMAND, FORCES и PLACEMENT. Сбор группы
// (строки потребности) и выделение сил перенесены внутрь этого экрана —
// отдельных шагов у них больше нет, как и в прототипе, где пул кандидатов
// строится из выделенных сил с их группой.
//
// Чего у бэка нет и что поэтому не нарисовано (вместо выдумки — прямая
// подпись на экране):
// * версии расстановки и «Сохранить расстановку» — назначение уходит на
//   сервер сразу, сохранять нечего;
// * «Старший сектора» — поля у назначения нет;
// * «Отменить ОМ» — ручки отмены нет;
// * поимённый состав выделенных сил — бэк хранит выделение ЧИСЛОМ, поэтому
//   подбор идёт по кадровому снимку, а числа выделения показаны чипами.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { ConflictDialog } from "@/features/ops-conflict-override";
import {
  useApproveDemand,
  useAssignPlacement,
  useCompleteForces,
  useCompletePlacement,
  usePersonnelPage,
  useUnassignPlacement,
  useUpdateForceAllocation,
  useUpdateRecon,
} from "@/hooks/use-security-event-stages";
import { useOperationalRatings } from "@/hooks/use-ops-ratings";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import type {
  PersonnelSummarySnapshot,
  PlacementAssignment,
  ReconSectorPost,
  SecurityEvent,
  StaffingDemandRow,
} from "@/entities/security-event";
import { FieldErrors, StageError } from "./StageErrors";

const SORT_OPTIONS = [
  "Рекомендуемые",
  "По соответствию",
  "По рейтингу",
  "По алфавиту",
] as const;

const RATE_OPTIONS = [
  "Все",
  "9,0–10,0",
  "8,0–8,9",
  "7,0–7,9",
  "Ниже 7,0",
  "Недостаточно данных",
] as const;

type SortOption = (typeof SORT_OPTIONS)[number];
type RateOption = (typeof RATE_OPTIONS)[number];

export function PlacementStage({ event }: { event: SecurityEvent }) {
  // Сбор группы и выделение сил — стадии DEMAND и FORCES: пока они не
  // пройдены, подбирать некого, поэтому экран открывается своей подготовкой.
  if (event.stage === "DEMAND") return <DemandPanel event={event} />;
  if (event.stage === "FORCES") return <ForcesPanel event={event} />;
  return <PlacementBoard event={event} />;
}

// ── Подготовка: потребность (группа по каждой строке) ────────────────────

function seedRows(event: SecurityEvent): StaffingDemandRow[] {
  if (event.demandRows.length > 0) return event.demandRows;
  return event.reconSectorPosts.map((post, index) => ({
    id: `demand-${index + 1}`,
    sector: post.sector,
    task: post.task !== "" ? post.task : post.post,
    shift: "",
    need: post.need,
    group: "",
    requirements: post.requirements,
    comment: "",
  }));
}

function DemandPanel({ event }: { event: SecurityEvent }) {
  const [rows, setRows] = useState<StaffingDemandRow[]>(() => seedRows(event));
  const [fieldErrors, setFieldErrors] = useState<Record<string, unknown> | null>(
    null
  );
  const approve = useApproveDemand(event.id, {
    onFormError: (details) => setFieldErrors(details),
  });

  function patch(id: string, next: Partial<StaffingDemandRow>): void {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...next } : row)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Расстановка · подготовка расчёта</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Группа по каждой строке — то, из чего собирается пул подбора. Строки
          преднаполнены расчётом рекогносцировки; смену и группу задайте вручную.
        </p>
        <div className="flex flex-col gap-2">
          {/* Шапка колонок: та же беда, что была у расчёта рекогносцировки —
              подписи жили только в aria-label, а плейсхолдер исчезает, как
              только в поле что-то введено. «Смена» от «Группы» глазом не
              отличались. Скринридеру шапка не нужна (у каждого поля своё имя). */}
          <div
            aria-hidden="true"
            className="text-muted-foreground hidden gap-2 px-1 text-[10px] font-bold uppercase tracking-wider md:grid md:grid-cols-[1fr_1.4fr_1fr_70px_1.2fr]"
          >
            <span>Направление</span>
            <span>Задача</span>
            <span>Смена</span>
            <span>Кол-во</span>
            <span>Группа</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-2 gap-2 border-b pb-2 last:border-0 md:grid-cols-[1fr_1.4fr_1fr_70px_1.2fr]"
            >
              <Input
                className="h-8 text-xs"
                aria-label={`Сектор строки ${row.id}`}
                value={row.sector}
                onChange={(e) => patch(row.id, { sector: e.target.value })}
              />
              <Input
                className="h-8 text-xs"
                aria-label={`Задача строки ${row.id}`}
                value={row.task}
                onChange={(e) => patch(row.id, { task: e.target.value })}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Смена"
                aria-label={`Смена строки ${row.id}`}
                value={row.shift}
                onChange={(e) => patch(row.id, { shift: e.target.value })}
              />
              <Input
                className="h-8 text-xs"
                type="number"
                min={1}
                aria-label={`Потребность строки ${row.id}`}
                value={row.need}
                onChange={(e) => patch(row.id, { need: Number(e.target.value) || 0 })}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Группа"
                aria-label={`Группа строки ${row.id}`}
                value={row.group}
                onChange={(e) => patch(row.id, { group: e.target.value })}
              />
            </div>
          ))}
        </div>
        <FieldErrors errors={fieldErrors} />
        <StageError error={approve.error} />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={approve.isPending}
            onClick={() => {
              setFieldErrors(null);
              approve.mutate({ rows });
            }}
          >
            {approve.isPending ? "Утверждение…" : "Утвердить потребность → выделение сил"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Подготовка: выделение сил по группам ─────────────────────────────────

function ForcesPanel({ event }: { event: SecurityEvent }) {
  const complete = useCompleteForces(event.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Расстановка · выделение сил</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Выделенная численность по группам — она же даёт размер пула подбора на
          расстановке.
        </p>
        {/* «Сбор сил на ОМ» — отдельный модуль (Tasks 1-2): кого отдали на
            мероприятия и кто остался. Экран выделения читает только числа по
            группам; поимённый список собирает тот модуль. */}
        <Link
          href="/employees?view=forces"
          className="inline-block text-xs font-semibold text-primary-ink"
        >
          Открыть «Сбор сил на ОМ» →
        </Link>
        {event.forceRequests.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Запросов нет — потребность не утверждена.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {event.forceRequests.map((request) => (
              <AllocationRow key={request.id} event={event} request={request} />
            ))}
          </div>
        )}
        <StageError error={complete.error} />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={complete.isPending}
            onClick={() => complete.mutate({})}
          >
            {complete.isPending ? "Завершение…" : "Завершить выделение → расстановка"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AllocationRow({
  event,
  request,
}: {
  event: SecurityEvent;
  request: SecurityEvent["forceRequests"][number];
}) {
  const [allocated, setAllocated] = useState(String(request.allocatedCount));
  const update = useUpdateForceAllocation(event.id, request.id);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2.5 text-sm">
      <span className="font-semibold">{request.group}</span>
      <span className="text-xs text-muted-foreground">
        запрошено {request.requestedCount}
      </span>
      <Input
        className="h-8 w-24 text-xs"
        type="number"
        min={0}
        aria-label={`Выделено: ${request.group}`}
        value={allocated}
        onChange={(e) => setAllocated(e.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={update.isPending}
        onClick={() =>
          update.mutate({ allocatedCount: Number(allocated) || 0, comment: "" })
        }
      >
        Выделить
      </Button>
      <StageError error={update.error} />
    </div>
  );
}

/** Размер страницы подбора. Крупнее окна выбора человека: здесь список не
 * выбирают одним кликом, а просматривают — отбор по рейтингу и автоподбор
 * работают по показанному, и страница в двадцать строк резала бы им основание. */
const CANDIDATE_PAGE_SIZE = 50;

// ── Расстановка: три колонки прототипа ───────────────────────────────────

function PlacementBoard({ event }: { event: SecurityEvent }) {
  const assign = useAssignPlacement(event.id);
  const unassign = useUnassignPlacement(event.id);
  const complete = useCompletePlacement(event.id);
  const updateRecon = useUpdateRecon(event.id);
  const { hasPermission } = useOpsPermissions();
  const canSeeRatings = hasPermission("rating.view_aggregate");
  const ratings = useOperationalRatings({ enabled: canSeeRatings });

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Запрос уходит на СЕРВЕР с задержкой (Plane №61): раньше экран тянул весь
  // кадровый снимок одним ответом и фильтровал его на клиенте — такой «поиск»
  // отвечает «никого не нашлось», имея в виду «нет в загруженном».
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortOption>("Рекомендуемые");
  const [band, setBand] = useState<RateOption>("Все");
  const [comment, setComment] = useState<string | null>(null);
  // Мероприятие, прошедшее «Сбор сил», расставляет ТОЛЬКО свой состав —
  // людей, которых штаб принял и отдал (Plane №73, шаг «СС-6»). Кадровый
  // список тогда не спрашивается вовсе: предлагать в подборе тех, кого сервер
  // всё равно откажется ставить, значит обещать невозможное.
  const fromRoster = event.forceRoster.length > 0;
  const roster = usePersonnelPage({
    search,
    page,
    pageSize: CANDIDATE_PAGE_SIZE,
    enabled: !fromRoster,
    // Статус спрашивается на день МЕРОПРИЯТИЯ: подбор отвечает на вопрос
    // «свободен ли он тогда», а не «свободен ли он сейчас» (Plane №65, «Р-2»).
    businessDate: event.businessDate,
  });
  /** Состав мероприятия в форме кадровой строки подбора. */
  const rosterPeople = useMemo(
    () =>
      event.forceRoster.map((member) => ({
        id: member.employeeId,
        name: member.name,
        rankLabel: "",
        unit: member.divisionName,
        statusCode: member.statusCode,
        statusLabel: member.statusLabel,
      })),
    [event.forceRoster]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const posts = event.reconSectorPosts;
  const selected = posts.find((p) => p.id === selectedPostId) ?? posts[0] ?? null;
  const assignmentsOf = (postId: string): PlacementAssignment[] =>
    event.placementAssignments.filter((a) => a.postId === postId);

  const ratingOf = (employeeId: string): number | null =>
    ratings.data?.results.find((r) => r.employeeId === employeeId)
      ?.aggregateRating ?? null;

  const allocated = event.forceRequests.reduce(
    (sum, request) => sum + request.allocatedCount,
    0
  );
  const assignedCount = event.placementAssignments.length;
  const totalNeed = posts.reduce((sum, post) => sum + post.need, 0);
  const unfilled = posts.filter((p) => assignmentsOf(p.id).length < p.need).length;
  const conflicts = event.placementAssignments.filter(
    (a) => a.ratingOverrideReason !== null
  ).length;
  const free = Math.max(0, allocated - assignedCount);

  const sectors = useMemo(() => {
    const list: { name: string; posts: ReconSectorPost[] }[] = [];
    for (const post of posts) {
      const found = list.find((s) => s.name === post.sector);
      if (found === undefined) list.push({ name: post.sector, posts: [post] });
      else found.posts.push(post);
    }
    return list;
  }, [posts]);

  const assignedIds = new Set(event.placementAssignments.map((a) => a.employeeId));

  /**
   * «Совпадение» — прозрачная арифметика, а не выдуманный балл: 60 базовых,
   * +25 за требование поста, встреченное в подразделении или звании
   * кандидата, +15 при рейтинге не ниже требуемого постом. Считается на
   * клиенте, потому что бэк такой оценки не даёт.
   */
  function fitOf(person: PersonnelSummarySnapshot): number {
    if (selected === null) return 0;
    let fit = 60;
    const req = selected.requirements.trim().toLowerCase();
    if (req !== "" && `${person.unit} ${person.rankLabel}`.toLowerCase().includes(req))
      fit += 25;
    const rating = ratingOf(person.id);
    if (selected.minRating !== null && rating !== null && rating >= selected.minRating)
      fit += 15;
    else if (selected.minRating === null) fit += 15;
    return Math.min(100, fit);
  }

  /** Предупреждение по кандидату — словами, до нажатия.
   *
   * Только то, что известно ТОЧНО: требование поста к рейтингу и его нехватка.
   * Занятость чужой службой сказана бейджем статуса, а не здесь: «в отпуске»
   * не запрещает поставить человека, это решение расстановщика.
   */
  function warnOf(person: PersonnelSummarySnapshot): string | null {
    if (selected === null || selected.minRating === null) return null;
    const rating = ratingOf(person.id);
    if (rating === null) return "рейтинга нет — требование поста не проверить";
    if (rating < selected.minRating)
      return `рейтинг ${rating} ниже требования поста ${selected.minRating}`;
    return null;
  }

  function inBand(rating: number | null): boolean {
    switch (band) {
      case "Все":
        return true;
      case "9,0–10,0":
        return rating !== null && rating >= 9;
      case "8,0–8,9":
        return rating !== null && rating >= 8 && rating < 9;
      case "7,0–7,9":
        return rating !== null && rating >= 7 && rating < 8;
      case "Ниже 7,0":
        return rating !== null && rating < 7;
      case "Недостаточно данных":
        return rating === null;
    }
  }

  /** Кандидаты СТРАНИЦЫ, а не всей базы: поиск и листание считает сервер.
   *
   * Отбор по рейтингу и сортировка остаются здесь и применяются к показанной
   * странице — рейтинг живёт в своей ручке под своим правом, и сервер кадров
   * о нём не знает. Панель говорит это вслух, а не делает вид, что отобрала
   * по всей базе; перенос отбора на сервер заведён отдельной карточкой. */
  const candidates = useMemo(() => {
    // Поиск по составу идёт НА КЛИЕНТЕ: состав — десятки строк, они уже на
    // руках, и круг к серверу за подстрокой в них ничего бы не уточнил.
    const source = fromRoster
      ? rosterPeople.filter((person) =>
          person.name.toLowerCase().includes(query.trim().toLowerCase())
        )
      : (roster.data?.results ?? []);
    const list = source.filter((person) => inBand(ratingOf(person.id)));
    const withFit = list.map((person) => ({
      person,
      fit: fitOf(person),
      rating: ratingOf(person.id),
      busy: assignedIds.has(person.id),
      warn: warnOf(person),
    }));
    switch (sort) {
      case "По рейтингу":
        return withFit.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
      case "По соответствию":
        return withFit.sort((a, b) => b.fit - a.fit);
      case "По алфавиту":
        return withFit.sort((a, b) => a.person.name.localeCompare(b.person.name, "ru"));
      default:
        return withFit.sort(
          (a, b) => Number(a.busy) - Number(b.busy) || b.fit - a.fit
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    roster.data,
    rosterPeople,
    fromRoster,
    query,
    sort,
    band,
    selected,
    ratings.data,
    assignedIds.size,
  ]);

  /** Автоподбор: реальные назначения свободных кандидатов на недобранные посты. */
  function autoFill(): void {
    const taken = new Set(assignedIds);
    for (const post of posts) {
      let missing = post.need - assignmentsOf(post.id).length;
      for (const candidate of candidates) {
        if (missing <= 0) break;
        if (taken.has(candidate.person.id)) continue;
        taken.add(candidate.person.id);
        missing -= 1;
        assign.mutate({ postId: post.id, employeeId: candidate.person.id });
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Расстановка</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {event.approvalStatus === "RETURNED" && event.approvalComment !== "" && (
          <Alert variant="destructive">
            <AlertDescription>
              Возвращено с согласования: {event.approvalComment}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap gap-4 text-xs">
            <Kpi label="постов" value={posts.length} />
            <Kpi label="требуется" value={totalNeed} />
            <Kpi label="назначено" value={assignedCount} />
            <Kpi label="свободно" value={free} />
            <Kpi label="незаполнено" value={unfilled} tone={unfilled > 0 ? "warn" : undefined} />
            <Kpi label="конфликтов" value={conflicts} tone={conflicts > 0 ? "bad" : undefined} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={assign.isPending || unfilled === 0}
              onClick={autoFill}
            >
              Сформировать автоматически
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={complete.isPending}
              onClick={() => complete.mutate({})}
            >
              {complete.isPending ? "Завершение…" : "Завершить этап и перейти далее"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Назначения уходят на сервер сразу — отдельного сохранения и версий
          расстановки у мероприятия нет.
        </p>

        {posts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Постов нет — расчёт формируется на этапе рекогносцировки.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(200px,240px)_1fr_minmax(240px,300px)]">
            <aside className="rounded-md border">
              <div className="border-b px-3 py-2">
                <p className="text-xs font-semibold">Объекты и посты</p>
                <p className="text-[11px] text-muted-foreground">
                  {posts.length} постов · назначено {assignedCount} из {totalNeed}
                </p>
              </div>
              <div className="max-h-[420px] overflow-y-auto p-2">
                {sectors.map((sector) => (
                  <div key={sector.name} className="mb-2">
                    <p className="px-1 py-1 text-xs font-semibold">{sector.name}</p>
                    <ul className="flex flex-col gap-1">
                      {sector.posts.map((post) => {
                        const count = assignmentsOf(post.id).length;
                        const full = count >= post.need;
                        return (
                          <li key={post.id}>
                            <button
                              type="button"
                              aria-current={selected?.id === post.id}
                              onClick={() => {
                                setSelectedPostId(post.id);
                                setComment(null);
                              }}
                              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                                selected?.id === post.id ? "bg-accent" : "hover:bg-muted"
                              }`}
                            >
                              <span
                                aria-hidden
                                className={`h-2 w-2 shrink-0 rounded-full ${full ? "bg-green-500" : "bg-amber-500"}`}
                              />
                              <span className="flex-1 truncate">{post.post}</span>
                              <span
                                className={`shrink-0 tabular-nums ${full ? "text-muted-foreground" : "text-amber-700"}`}
                              >
                                {count}/{post.need}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </aside>

            {selected !== null && (
              <section className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{selected.post}</p>
                    <p className="text-xs text-muted-foreground">{selected.sector}</p>
                  </div>
                  <span
                    className={
                      assignmentsOf(selected.id).length >= selected.need
                        ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
                        : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                    }
                  >
                    {assignmentsOf(selected.id).length} из {selected.need}
                  </span>
                </div>

                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Требования поста
                    </p>
                    <p className="text-xs">
                      {selected.requirements === "" ? "—" : selected.requirements}
                      {selected.minRating !== null
                        ? ` · мин. рейтинг ${selected.minRating}`
                        : ""}
                    </p>
                  </div>
                  {event.passportBinding !== null && (
                    <Link
                      href={`/security-ops/objects/${event.passportBinding.objectId}/passports/${event.passportBinding.versionId}`}
                      className="text-xs font-semibold text-primary-ink"
                    >
                      Паспорт поста →
                    </Link>
                  )}
                </div>
                <p className="mb-2 text-xs">
                  <b>Задача поста:</b> {selected.task === "" ? "—" : selected.task}
                </p>

                <ul className="mb-2 flex flex-col gap-1.5">
                  {assignmentsOf(selected.id).map((assignment) => (
                    <li
                      key={assignment.id}
                      className="flex flex-wrap items-start gap-2 rounded-md border p-2 text-sm"
                    >
                      <Initials
                        name={assignment.employeeName}
                        tone={statusTone(assignment.statusCode)}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">
                            {assignment.employeeName}
                          </span>
                          {ratingOf(assignment.employeeId) !== null && (
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                              {ratingOf(assignment.employeeId)}
                            </span>
                          )}
                          {assignment.ratingOverrideReason !== null && (
                            <span className="text-xs text-amber-700">
                              обход: {assignment.ratingOverrideReason}
                            </span>
                          )}
                        </span>
                        {/* Подразделение и статус дня приходят с сервера
                            (Plane №65, «Р-1»): без них строка называла человека,
                            но не говорила, откуда он и свободен ли в день ОМ. */}
                        <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {assignment.divisionName === ""
                              ? "подразделение не указано"
                              : assignment.divisionName}
                          </span>
                          <StatusBadge
                            code={assignment.statusCode}
                            label={assignment.statusLabel}
                          />
                        </span>
                      </span>
                      {/* Действия — колонкой справа, как в прототипе: в ряд
                          они съедают ширину у имени с подразделением, и то
                          обрезалось на «Отдел охраны объек…». */}
                      <span className="flex shrink-0 flex-col gap-1">
                      <select
                        aria-label={`Переместить: ${assignment.employeeName}`}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        value=""
                        onChange={(e) => {
                          const target = e.target.value;
                          if (target === "") return;
                          // Перемещение = снятие с поста и назначение на другой:
                          // своей операции «переместить» у бэка нет.
                          unassign.mutate({ assignmentId: assignment.id });
                          assign.mutate({
                            postId: target,
                            employeeId: assignment.employeeId,
                          });
                        }}
                      >
                        <option value="">Переместить…</option>
                        {posts
                          .filter((p) => p.id !== selected.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sector} · {p.post}
                            </option>
                          ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => unassign.mutate({ assignmentId: assignment.id })}
                      >
                        Удалить с поста
                      </Button>
                      </span>
                    </li>
                  ))}
                </ul>

                {assignmentsOf(selected.id).length < selected.need && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Свободно мест:{" "}
                    {selected.need - assignmentsOf(selected.id).length} — выберите
                    сотрудника из списка справа
                  </p>
                )}

                <label className="text-xs font-semibold" htmlFor="post-comment">
                  Комментарий к посту
                </label>
                <div className="flex gap-2">
                  <Input
                    id="post-comment"
                    className="h-8 text-xs"
                    placeholder="—"
                    value={comment ?? selected.comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={comment === null || updateRecon.isPending}
                    onClick={() =>
                      updateRecon.mutate({
                        checklist: event.reconChecklist,
                        sectorPosts: posts.map((p) =>
                          p.id === selected.id ? { ...p, comment: comment ?? "" } : p
                        ),
                      })
                    }
                  >
                    Сохранить
                  </Button>
                </div>
              </section>
            )}

            <aside className="rounded-md border">
              <div className="border-b px-3 py-2">
                <p className="text-xs font-semibold">Доступные сотрудники</p>
                <p className="text-[11px] text-muted-foreground">
                  Подбор по требованиям поста
                </p>
              </div>
              <div className="space-y-2 p-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Поиск по ФИО или подразделению"
                  aria-label="Поиск кандидатов"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="flex gap-2">
                  <label className="flex-1 text-[9px] font-bold uppercase text-muted-foreground">
                    Сортировка
                    <select
                      aria-label="Сортировка кандидатов"
                      className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-1 text-xs"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as SortOption)}
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex-1 text-[9px] font-bold uppercase text-muted-foreground">
                    Рейтинг
                    <select
                      aria-label="Фильтр по рейтингу"
                      className="mt-0.5 block h-8 w-full rounded-md border border-input bg-background px-1 text-xs"
                      value={band}
                      onChange={(e) => setBand(e.target.value as RateOption)}
                    >
                      {RATE_OPTIONS.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Chip tone="info">Выделено {allocated}</Chip>
                  <Chip>Свободны {free}</Chip>
                  <Chip>Назначены {assignedCount}</Chip>
                </div>
                {/* «Найдено N» считает СЕРВЕР, а не длина страницы: счётчик по
                    странице обещал бы, что список кончился, ровно на её краю.
                    Рядом сказано, что отбор по рейтингу и сортировка идут по
                    показанному, — иначе «нет кандидатов» читалось бы как «их
                    нет в кадрах». */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span aria-live="polite">
                    {fromRoster
                      ? `Состав мероприятия: ${rosterPeople.length} чел.`
                      : `Найдено ${roster.data?.count ?? 0} · страница ${page}`}
                  </span>
                  <span className={fromRoster ? "hidden" : "flex gap-1"}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={roster.data?.previous === null || roster.isFetching}
                      onClick={() => setPage((current) => Math.max(current - 1, 1))}
                    >
                      Назад
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      disabled={roster.data?.next === null || roster.isFetching}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Дальше
                    </Button>
                  </span>
                </div>
                {fromRoster && (
                  <p className="text-[11px] text-muted-foreground">
                    Кандидаты — люди, принятые штабом в «Сборе сил на ОМ».
                    Постороннего на пост сервер не поставит.
                  </p>
                )}
                {!fromRoster && (roster.data?.next !== null || page > 1) && (
                  <p className="text-[11px] text-muted-foreground">
                    Отбор по рейтингу, сортировка и автоподбор считаются по
                    показанной странице. Нужен конкретный человек — ищите его по
                    фамилии.
                  </p>
                )}
                <div className="max-h-[360px] space-y-1 overflow-y-auto">
                  {candidates.length === 0 ? (
                    <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                      {fromRoster
                        ? rosterPeople.length === 0
                          ? "Состав мероприятия пуст — соберите людей в «Сборе сил на ОМ»."
                          : "В составе никто не подходит под выбранный фильтр рейтинга"
                        : roster.isPending
                          ? "Загрузка кадрового списка…"
                          : roster.isError
                            ? "Кадровый список сейчас недоступен."
                            : (roster.data?.count ?? 0) === 0
                              ? "По запросу никого не нашлось."
                              : "На этой странице нет кандидатов под выбранный фильтр рейтинга"}
                    </p>
                  ) : (
                    candidates.map(({ person, fit, rating, busy, warn }) => (
                      <button
                        key={person.id}
                        type="button"
                        disabled={selected === null || assign.isPending}
                        onClick={() =>
                          selected !== null &&
                          assign.mutate({ postId: selected.id, employeeId: person.id })
                        }
                        className="flex w-full items-start gap-2 rounded-md border p-2 text-left text-xs hover:bg-muted disabled:opacity-50"
                      >
                        <Initials
                          name={person.name}
                          tone={statusTone(person.statusCode)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {person.rankLabel} {person.name}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {person.unit}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            <StatusBadge
                              code={person.statusCode}
                              label={person.statusLabel}
                            />
                            {rating !== null && (
                              <span className="rounded-full bg-secondary px-1.5 py-0.5 tabular-nums">
                                {rating}
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              Совпадение {fit}%
                            </span>
                          </span>
                          {busy && (
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">
                              уже назначен на пост этого мероприятия
                            </span>
                          )}
                          {/* Красным — то, что мешает поставить человека
                              ПРЯМО СЕЙЧАС: рейтинг ниже требования поста
                              сервер отдаст мягким конфликтом с обходом, и
                              честнее сказать это до нажатия. */}
                          {warn !== null && (
                            <span className="mt-0.5 block text-[10px] font-bold text-red-700">
                              {warn}
                            </span>
                          )}
                        </span>
                        <b className="tabular-nums">{fit}</b>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}

        <StageError error={assign.error} />
        <StageError error={unassign.error} />
        <StageError error={updateRecon.error} />
        <StageError error={complete.error} />

        <ConflictDialog
          conflict={assign.conflict}
          onOverride={(reason) => assign.confirmOverride(reason)}
          onCancel={() => assign.dismissConflict()}
        />
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "bad";
}) {
  return (
    <span className="flex items-baseline gap-1">
      <b
        className={`text-base tabular-nums ${
          tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : ""
        }`}
      >
        {value}
      </b>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** Тон статуса дня. Пары те же, что у дизайн-системы прототипа
 * (`bg-<цвет>-100 text-<цвет>-800`), и разложены ПО СМЫСЛУ, а не по коду:
 * человека либо можно ставить на пост, либо нет, и цвет обязан это сказать
 * раньше, чем прочтётся подпись. Неизвестный код — нейтральный тон: выдумывать
 * трактовку новой строки справочника хуже, чем промолчать. */
type StatusTone = "free" | "duty" | "away";

const AWAY_CODES = new Set([
  "VACATION",
  "SICK_LEAVE",
  "BUSINESS_TRIP",
  "TRAINING",
  "CONFERENCE",
  "COMPETITION",
  "LEAVE_BY_REPORT",
  "OTHER_ABSENCE",
  "SECONDED_TO",
]);
const DUTY_CODES = new Set([
  "ON_DUTY",
  "AFTER_DUTY",
  "EVENT_ASSIGNMENT",
  "IN_SERVICE",
  "SECONDED_FROM",
]);

function statusTone(code: string | null): StatusTone {
  if (code === null) return "free";
  if (AWAY_CODES.has(code)) return "away";
  if (DUTY_CODES.has(code)) return "duty";
  return "duty";
}

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  free: "bg-green-100 text-green-800",
  duty: "bg-blue-100 text-blue-800",
  away: "bg-amber-100 text-amber-800",
};

/** Бейдж статуса дня. `null` подписывается «в строю» ЗДЕСЬ: строки «в строю» в
 * справочнике нет — это отсутствие действующего статуса, и сервер честно
 * отдаёт null вместо выдуманного кода. */
function StatusBadge({
  code,
  label,
}: {
  code: string | null;
  label: string | null;
}) {
  return (
    <span
      className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE_CLASS[statusTone(code)]}`}
    >
      {label ?? "в строю"}
    </span>
  );
}

/** Аватар-инициалы из прототипа. Картинок сотрудников в системе нет, и
 * заглушка-силуэт не сказала бы ничего: инициалы отличают строки друг от
 * друга при беглом просмотре списка. Для скринридера он `aria-hidden` —
 * имя стоит рядом словами. */
function Initials({ name, tone }: { name: string; tone: StatusTone }) {
  const short = name
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold ${STATUS_TONE_CLASS[tone]}`}
    >
      {short === "" ? "—" : short}
    </span>
  );
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "info";
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        tone === "info" ? "bg-blue-100 text-blue-800" : "bg-secondary"
      }`}
    >
      {children}
    </span>
  );
}
