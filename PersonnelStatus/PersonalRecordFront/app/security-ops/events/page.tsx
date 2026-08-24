"use client";

// Реестр ОМ: поиск, фильтр по этапу, таблица, создание. Фильтры — в URL
// (обновление страницы не сбрасывает фильтр, ссылкой можно поделиться).
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { FilterBar } from "@/components/filter-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIsoDate } from "@/shared/lib/date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { CreateSecurityEventDialog } from "@/features/create-security-event";
import {
  SECURITY_EVENT_STAGES,
  STAGE_LABEL,
  StageBadge,
} from "@/entities/security-event";
import type {
  ListSecurityEventsParams,
  SecurityEvent,
  SecurityEventStage,
  VisitObject,
} from "@/entities/security-event";
import { OpsAccessDenied } from "@/components/ops-access-denied";

const PAGE_SIZE = 20;

const MONTH_NAME = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

function isStage(value: string | null): value is SecurityEventStage {
  return (SECURITY_EVENT_STAGES as readonly string[]).includes(value ?? "");
}

export default function SecurityEventsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Текущий отбор едет с человеком в карточку: возврат «← Назад» без него
  // приводил на голый корень реестра, и подобранный фильтр приходилось
  // набирать заново.
  const backSuffix = (() => {
    const query = searchParams.toString();
    return query === "" ? "" : `?back=${encodeURIComponent(query)}`;
  })();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();

  const stageParam = searchParams.get("stage");
  const params: ListSecurityEventsParams = {
    search: searchParams.get("search") ?? "",
    stage: isStage(stageParam) ? stageParam : "ALL",
    // Период и ответственный фильтрует СЕРВЕР: тот же фильтр на клиенте сузил
    // бы только загруженную страницу и врал бы про пустой результат.
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
    owner: searchParams.get("owner") ?? "",
    page: Number(searchParams.get("page") ?? "1") || 1,
    pageSize: PAGE_SIZE,
  };

  // Календарь показывает МЕСЯЦ целиком, а таблица — страницу отбора. Это два
  // разных запроса, и делать один на двоих нельзя: страница в 20 строк не
  // покрывает месяц, а месяц не знает о постраничности.
  const view = searchParams.get("view") === "calendar" ? "calendar" : "list";
  const query = useSecurityEvents(view === "calendar" ? { ...params, pageSize: 200 } : params);

  // Поиск фиксируется с задержкой: в URL и в запрос уезжает набранное слово, а
  // не каждая его буква. Само поле отвечает мгновенно — оно живёт в черновике.
  const [searchDraft, setSearchDraft] = useDebouncedCommit(
    params.search ?? "",
    (value) => updateParam("search", value)
  );

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page"); // фильтр меняется — начинаем с первой страницы
    const qs = next.toString();
    router.replace(qs === "" ? pathname : `${pathname}?${qs}`, { scroll: false });
  }

  if (!permissionsLoading && !hasPermission("event.view")) {
    return (
      <OpsAccessDenied what="реестра ОМ" />
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Реестр ОМ"
          description="Полный цикл: от бюллетеня и рекогносцировки до закрытия и архива"
          actions={
            <div className="flex gap-2">
              {/* Переключатель «Календарь ⇄ Список» из прототипа. Режим живёт
                  в URL рядом с фильтрами: ссылкой делятся вместе с отбором, а
                  возврат из карточки попадает в тот же вид, из которого ушли. */}
              <Button
                variant="outline"
                onClick={() =>
                  updateParam("view", view === "calendar" ? "" : "calendar")
                }
              >
                {view === "calendar" ? "К списку" : "Календарь"}
              </Button>
              <Button onClick={() => setDialogOpen(true)}>
                + Создать бюллетень
              </Button>
            </div>
          }
        />

        <FilterBar
          onReset={
            params.search !== "" ||
            params.stage !== "ALL" ||
            params.from !== "" ||
            params.to !== "" ||
            params.owner !== ""
              ? () => router.replace(pathname, { scroll: false })
              : undefined
          }
        >
          <Input
            className="min-w-56 flex-1"
            placeholder="Поиск по названию, объекту или ответственному"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          <select
            // Высота НЕ задаётся здесь: её навязывает сам ряд FilterBar
            // (`[&_select]:h-9`) — так e2e/prototype-skin.spec.ts, тест
            // «контролы фильтров одной высоты», действительно стережёт
            // правило компонента, а не совпадение дефолтов.
            className="rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Этап"
            value={params.stage}
            onChange={(e) =>
              updateParam("stage", e.target.value === "ALL" ? "" : e.target.value)
            }
          >
            <option value="ALL">Все этапы</option>
            {SECURITY_EVENT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABEL[stage]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            с
            <Input
              type="date"
              aria-label="Период с"
              className="w-auto"
              value={params.from}
              onChange={(e) => updateParam("from", e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            по
            <Input
              type="date"
              aria-label="Период по"
              className="w-auto"
              value={params.to}
              onChange={(e) => updateParam("to", e.target.value)}
            />
          </label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Ответственный"
            value={params.owner}
            onChange={(e) => updateParam("owner", e.target.value)}
          >
            <option value="">Все ответственные</option>
            {(query.data?.owners ?? []).map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </FilterBar>

        {view === "calendar" ? (
          <EventsCalendar
            backSuffix={backSuffix}
            isLoading={query.isLoading}
            isError={query.isError}
            events={query.data?.results ?? []}
          />
        ) : (
          <ResultsTable
            backSuffix={backSuffix}
            isLoading={query.isLoading}
            isError={query.isError}
            events={query.data?.results ?? []}
            isEmpty={query.data !== undefined && query.data.results.length === 0}
          />
        )}

        <CreateSecurityEventDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      </div>
    </DashboardLayout>
  );
}

function ResultsTable({
  backSuffix,
  isLoading,
  isError,
  events,
  isEmpty,
}: {
  /** Текущий отбор реестра — уезжает в карточку, чтобы вернуться на него. */
  backSuffix: string;
  isLoading: boolean;
  isError: boolean;
  events: SecurityEvent[];
  isEmpty: boolean;
}) {
  const router = useRouter();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Загрузка реестра…
        </CardContent>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-destructive-ink">
          Не удалось загрузить реестр ОМ. Попробуйте обновить страницу.
        </CardContent>
      </Card>
    );
  }
  if (isEmpty) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Мероприятия не найдены
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <Th>
                <span className="sr-only">Объекты посещения</span>
              </Th>
              <Th>ОМ</Th>
              <Th>Даты</Th>
              <Th>Локация</Th>
              <Th>Этап и готовность</Th>
              <Th>Потребность</Th>
              <Th>Ответственный</Th>
              <Th>
                <span className="sr-only">Действия</span>
              </Th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                backSuffix={backSuffix}
                onOpen={() =>
                  router.push(`/security-ops/events/${event.id}${backSuffix}`)
                }
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Колонки эталона, которых в таблице нет. Сноска, а не пустые столбцы:
          пустая колонка на всю таблицу — это не «честная пустота», а шум в
          каждой строке. */}
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Колонки «Старший» из прототипа здесь нет: старшего мероприятия модель
        показывает в карточке, а в реестре его место занял список объектов
        посещения — он раскрывается кнопкой в первой колонке и несёт
        охраняемое лицо каждого объекта.
      </p>
    </>
  );
}

/**
 * Строка реестра = БЮЛЛЕТЕНЬ. Раскрытие показывает объекты посещения этого
 * мероприятия: куда едет охраняемое лицо и насколько закрыта расстановка.
 *
 * Строка кликабельна целиком, как в эталоне. Ссылки в ячейках остаются: они —
 * то, что видит скринридер и что открывается в новой вкладке средней кнопкой;
 * обработчик строки лишь избавляет мышь от прицеливания в текст. Клик по самой
 * ссылке сюда не доходит дважды — переход делает она, а router.push уже не
 * случается: событие останавливать не нужно, навигация одна.
 *
 * Раскрыватель — кнопка, а не клик по строке: сама строка уже ведёт в карточку,
 * и одно нажатие не может значить два разных действия. По той же причине
 * обработчик строки пропускает клики, пришедшие из кнопки, — иначе раскрытие
 * уводило бы со страницы.
 *
 * Детали живут ВТОРОЙ строкой таблицы, а не Accordion: внутрь `<tbody>` можно
 * положить только `<tr>`, и обёртка Radix ломала бы разметку таблицы.
 */
function EventRow({
  event,
  backSuffix,
  onOpen,
}: {
  event: SecurityEvent;
  backSuffix: string;
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const visits = event.visitObjects ?? [];

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={(clickEvent) => {
          const target = clickEvent.target as HTMLElement;
          if (target.closest("a") !== null) return;
          if (target.closest("button") !== null) return;
          onOpen();
        }}
      >
        <TableCell className="w-9 align-top">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? "Свернуть" : "Развернуть"} объекты посещения ${event.code}`}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </TableCell>
        <TableCell>
                  <Link
                    href={`/security-ops/events/${event.id}${backSuffix}`}
                    className="block"
                  >
                    <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-200">
                      {event.code}
                    </span>
                    <span className="mt-1 block font-semibold">{event.title}</span>
                  </Link>
                </TableCell>

                {/* Даты: начало крупно, продолжительность подписью — в
                    прототипе вторая строка ячейки несёт время смены, которого
                    у мероприятия нет; период же есть и говорит о том же
                    («сколько это длится»). */}
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatIsoDate(event.businessDate)}
                  <span className="mt-[3px] block text-[11px] text-muted-foreground/80">
                    {event.businessDateEnd === null ||
                    event.businessDateEnd === event.businessDate
                      ? "один день"
                      : `по ${formatIsoDate(event.businessDateEnd)}`}
                  </span>
                </TableCell>

                <TableCell className="text-muted-foreground">
                  {event.objectName}
                  <span className="mt-[3px] block text-[11px] text-muted-foreground/80">
                    {event.passportBinding === null
                      ? "паспорт не привязан"
                      : `паспорт вер. ${event.passportBinding.versionNumber}`}
                  </span>
                </TableCell>

                {/* Этап и готовность — одна колонка, как в эталоне: это один
                    ответ на вопрос «где мероприятие сейчас». Конфликты
                    показываются ТОЛЬКО когда они есть: колонка нулей была
                    шумом на всю таблицу, а сигнал в ней терялся. */}
                <TableCell className="min-w-[190px]">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StageBadge stage={event.stage} />
                    {event.conflictsCount > 0 && (
                      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950/60 dark:text-red-200">
                        конфликтов: {event.conflictsCount}
                      </span>
                    )}
                  </span>
                  <span className="mt-[7px] flex items-center gap-2">
                    <span
                      className="h-[5px] w-24 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={event.readinessPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Готовность ${event.code}`}
                    >
                      <span
                        className="block h-full bg-primary"
                        style={{ width: `${event.readinessPercent}%` }}
                      />
                    </span>
                    <span className="text-xs tabular-nums">
                      {event.readinessPercent}%
                    </span>
                  </span>
                </TableCell>

                <TableCell className="tabular-nums">{event.forceNeed}</TableCell>
                <TableCell>{event.ownerName}</TableCell>
        <TableCell className="text-center text-muted-foreground">
          <Link href={`/security-ops/events/${event.id}${backSuffix}`}>›</Link>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow id={detailsId} className="bg-muted/40 hover:bg-muted/40">
          <TableCell colSpan={8} className="p-0">
            <VisitObjectList visits={visits} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Объекты посещения раскрытого бюллетеня: куда едут, с кем и насколько закрыта
 * расстановка.
 *
 * Готовность НЕ выдумывается: `placementNeed === null` означает «расчёт постов
 * не размечен по объектам» (так у второго и последующих объектов, пока посты
 * ведутся на мероприятии целиком), и тогда вместо доли стоит причина, а не
 * ноль и не прочерк.
 */
function VisitObjectList({ visits }: { visits: VisitObject[] }) {
  if (visits.length === 0) {
    return (
      <p className="px-4 py-3 pl-12 text-xs text-muted-foreground">
        Объекты посещения не заведены.
      </p>
    );
  }
  return (
    // Врезка, а не «ещё одна таблица»: колонки раскрытия не совпадают с
    // колонками реестра, и попытка выровнять их друг под друга читалась бы
    // как сбитая вёрстка. Левая граница и отступ говорят «это внутри строки».
    <div className="ml-9 border-l-2 border-primary/30 py-2 pl-4 pr-4">
      <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        Объекты посещения · {visits.length}
      </p>
      <ul className="space-y-1.5">
        {visits.map((visit) => {
          const known = visit.placementNeed !== null;
          const need = visit.placementNeed ?? 0;
          const assigned = visit.placementAssigned ?? 0;
          const percent = need === 0 ? 0 : Math.round((assigned / need) * 100);
          return (
            <li
              key={visit.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs"
            >
              <span className="min-w-52 font-medium">
                {visit.objectId === null ? (
                  visit.objectName
                ) : (
                  <Link
                    href={`/security-ops/objects/${visit.objectId}`}
                    className="hover:underline"
                  >
                    {visit.objectName}
                  </Link>
                )}
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  {visit.passportBinding === null
                    ? "паспорт не привязан"
                    : `паспорт вер. ${visit.passportBinding.versionNumber}`}
                </span>
              </span>

              <span className="min-w-56 text-[11px] text-muted-foreground">
                {visit.protectedPersonName === "" ? (
                  "охраняемое лицо не назначено"
                ) : (
                  <>
                    Охраняемое лицо:{" "}
                    <span className="text-xs text-foreground">
                      {visit.protectedPersonName}
                    </span>
                  </>
                )}
              </span>

              {/* Полоса рисуется только когда есть что мерить: шкала с нулём
                  при нерассчитанных постах читается как «расстановка пуста»,
                  хотя постов ещё нет вовсе. */}
              {known && need > 0 && (
                <span className="flex items-center gap-2">
                  <span
                    className="h-[5px] w-24 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Готовность расстановки: ${visit.objectName}`}
                  >
                    <span
                      className="block h-full bg-primary"
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                  <span className="tabular-nums text-[11px] text-muted-foreground">
                    расстановка {assigned} из {need}
                  </span>
                </span>
              )}
              {known && need === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  посты не рассчитаны
                </span>
              )}
              {!known && (
                <span className="text-[11px] text-muted-foreground">
                  расстановка ведётся на мероприятии целиком — по объекту не
                  разнесена
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Календарь мероприятий из прототипа: месяц с отметками и список дня рядом.
 *
 * Месяц берётся от ПЕРВОГО мероприятия отбора, а не от «сегодня»: реестр
 * часто отфильтрован по периоду, и открывать пустой текущий месяц поверх
 * отобранного апреля значило бы прятать результат собственного фильтра.
 */
function EventsCalendar({
  backSuffix,
  isLoading,
  isError,
  events,
}: {
  backSuffix: string;
  isLoading: boolean;
  isError: boolean;
  events: SecurityEvent[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Смещение месяца от начального: календарь листается, но «начало» считается
  // от данных, а не от нуля — см. ниже.
  const [monthShift, setMonthShift] = useState(0);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Загрузка календаря…
        </CardContent>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-destructive-ink">
          Не удалось загрузить реестр ОМ. Попробуйте обновить страницу.
        </CardContent>
      </Card>
    );
  }
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-sm text-muted-foreground">
          Мероприятия не найдены
        </CardContent>
      </Card>
    );
  }

  // Открываемый месяц: ТЕКУЩИЙ, если в отборе есть его мероприятия, иначе
  // месяц ближайшего к сегодня. Брать просто самое раннее было ошибкой —
  // реестр открывался на июле, когда все живые мероприятия в августе.
  const dates = events.map((event) => event.businessDate).sort();
  const todayIso = new Date().toISOString().slice(0, 10);
  const thisMonth = todayIso.slice(0, 7);
  const anchor =
    dates.find((date) => date.slice(0, 7) === thisMonth) ??
    dates.find((date) => date >= todayIso) ??
    (dates[dates.length - 1] as string);
  const base = new Date(
    Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1 + monthShift, 1)
  );
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();

  const byDate = new Map<string, SecurityEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.businessDate) ?? [];
    list.push(event);
    byDate.set(event.businessDate, list);
  }

  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // Понедельник — первый столбец: getUTCDay() отдаёт воскресенье нулём.
  const lead = (first.getUTCDay() + 6) % 7;

  const dayIso = (day: number): string =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Список справа показывает выбранный день; пока день не выбран — тот, к
  // которому открылся календарь. Смена месяца выбор не переносит: показывать
  // «мероприятия 27 июля» над сеткой августа было бы враньём заголовка.
  const listDate =
    selected !== null && selected.slice(0, 7) === `${year}-${String(month + 1).padStart(2, "0")}`
      ? selected
      : anchor.slice(0, 7) === `${year}-${String(month + 1).padStart(2, "0")}`
        ? anchor
        : dayIso(1);
  const listEvents = byDate.get(listDate) ?? [];

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1.35fr_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>
              Календарь мероприятий · {MONTH_NAME[month]} {year}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Клик по дню с отметкой — список мероприятий справа
            </p>
          </div>
          <span className="flex shrink-0 gap-1">
            <Button
              variant="outline"
              size="sm"
              aria-label="Предыдущий месяц"
              onClick={() => setMonthShift((shift) => shift - 1)}
            >
              ‹
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Следующий месяц"
              onClick={() => setMonthShift((shift) => shift + 1)}
            >
              ›
            </Button>
          </span>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="pb-1 text-center text-[10px] font-bold text-muted-foreground"
              >
                {day}
              </div>
            ))}
            {Array.from({ length: lead }, (_, index) => (
              <div key={`lead-${index}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const iso = dayIso(day);
              const dayEvents = byDate.get(iso) ?? [];
              const isSelected = iso === listDate;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={dayEvents.length === 0}
                  onClick={() => setSelected(iso)}
                  aria-pressed={isSelected}
                  aria-label={`${day} ${MONTH_NAME[month]}: мероприятий ${dayEvents.length}`}
                  className={`flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-xs transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : dayEvents.length > 0
                        ? "hover:bg-muted"
                        : "text-muted-foreground/50"
                  }`}
                >
                  <span className="font-semibold tabular-nums">{day}</span>
                  {dayEvents.length > 0 && (
                    <span className="bg-primary size-1.5 rounded-full" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Мероприятия дня</CardTitle>
            <p className="text-xs text-muted-foreground">
              {formatIsoDate(listDate)}
            </p>
          </div>
          <span
            data-slot="events-day-count"
            className="bg-secondary text-secondary-foreground shrink-0 rounded-full px-3 py-1 text-xs font-semibold tabular-nums"
          >
            {listEvents.length}
          </span>
        </CardHeader>
        <CardContent>
          {listEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              В этот день мероприятий нет.
            </p>
          ) : (
            <ul className="divide-y">
              {listEvents.map((event) => (
                <li key={event.id} className="py-3 first:pt-0 last:pb-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-200">
                      {event.code}
                    </span>
                    <StageBadge stage={event.stage} />
                  </span>
                  <Link
                    href={`/security-ops/events/${event.id}${backSuffix}`}
                    className="mt-1 block text-sm font-semibold hover:underline"
                  >
                    {event.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {event.objectName} · потребность {event.forceNeed} ·{" "}
                    {event.ownerName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return <TableHead>{children}</TableHead>;
}
