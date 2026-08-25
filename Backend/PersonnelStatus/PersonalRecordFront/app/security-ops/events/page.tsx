"use client";

// Реестр ОМ: поиск, фильтр по этапу, таблица, создание. Фильтры — в URL
// (обновление страницы не сбрасывает фильтр, ссылкой можно поделиться).
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/shared/hooks/use-toast";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { CreateSecurityEventDialog } from "@/features/create-security-event";
import { GvoVisitsRegistry } from "@/widgets/gvo-visits-registry";
import {
  AddDeputyDialog,
  AssignChiefDialog,
  AddVisitObjectsDialog,
  deleteSecurityEvent,
  removeVisitObject,
  removeVisitObjectChief,
  removeVisitObjectDeputy,
} from "@/features/event-visit-objects";
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
  // Три вида, а не два: «Визиты иностранных ОЛ» — вкладка, в которую переехал
  // снятый модуль «Реестр ГВО» (Plane «Реестр ОМ-35.8»). Вид живёт в адресе
  // рядом с фильтрами: ссылкой делятся вместе с отбором.
  const viewParam = searchParams.get("view");
  const view =
    viewParam === "calendar" ? "calendar" : viewParam === "gvo" ? "gvo" : "list";
  // Во вкладке визитов таблица реестра не рисуется, но запрос отменять
  // НЕЛЬЗЯ: из него берётся список ответственных для фильтра, и он же держит
  // счётчик страниц при возврате на список.
  const query = useSecurityEvents(
    view === "calendar" ? { ...params, pageSize: 200 } : params
  );

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
              {/* Календарь — про мероприятия; во вкладке визитов его нет:
                  кнопка «Календарь» там уводила бы из вкладки в сторону. */}
              {view !== "gvo" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    updateParam("view", view === "calendar" ? "" : "calendar")
                  }
                >
                  {view === "calendar" ? "К списку" : "Календарь"}
                </Button>
              )}
              <Button onClick={() => setDialogOpen(true)}>
                + Создать бюллетень
              </Button>
            </div>
          }
        />

        {/* Вкладки реестра. «Визиты иностранных ОЛ» — сводный взгляд снятого
            модуля «Реестр ГВО» (Plane «Реестр ОМ-35.8»): заказчик убрал пункт
            меню, но список «кто едет» оставил внутри реестра ОМ. */}
        <div
          role="tablist"
          aria-label="Вид реестра"
          className="inline-flex gap-[3px] rounded-[9px] bg-muted p-[3px]"
        >
          {(
            [
              ["", "Мероприятия"],
              ["gvo", "Визиты иностранных ОЛ"],
            ] as const
          ).map(([value, label]) => {
            const active = value === "gvo" ? view === "gvo" : view !== "gvo";
            return (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => updateParam("view", value)}
                className={
                  active
                    ? "h-[30px] rounded-[7px] bg-card px-3 text-[12.5px] font-semibold shadow-sm"
                    : "h-[30px] rounded-[7px] px-3 text-[12.5px] font-semibold text-muted-foreground"
                }
              >
                {label}
              </button>
            );
          })}
        </div>

        {view === "gvo" ? (
          <GvoVisitsRegistry />
        ) : (
        <>
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
        </>
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
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const detailsId = useId();
  const visits = event.visitObjects ?? [];
  const { hasPermission } = useOpsPermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Закрытое мероприятие — история: сервер маршрут в нём менять не даст, и
  // кнопка, которая гарантированно получит отказ, — обещание, а не действие.
  const canEditObjects =
    hasPermission("event.manage") && event.stage !== "CLOSED";
  // Закрытое ОМ сервер удалять отказывается по той же причине.
  const canDeleteEvent =
    hasPermission("event.delete") && event.stage !== "CLOSED";
  const removal = useMutation({
    mutationFn: deleteSecurityEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
      toast({ title: `Мероприятие ${event.code} удалено` });
      setDeleteOpen(false);
    },
    // Отказ ОБЪЯСНЯЕТСЯ: сервер не даёт стереть ОМ с расстановкой или
    // записями журнала, и человеку нужна эта причина, а не «не получилось».
    onError: (error: unknown) => {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      toast({
        title: "Мероприятие не удалено",
        description:
          message === ""
            ? "Сервис временно недоступен. Попробуйте ещё раз."
            : message,
        variant: "destructive",
      });
    },
  });

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
        {/* Раскрыватель и «добавить объекты» — рядом со строкой бюллетеня, как
            просил заказчик. Обе — кнопки: строка ведёт в карточку, и клик по
            ней не должен значить ни то, ни другое. */}
        <TableCell className="w-16 align-top">
          <span className="flex items-center gap-0.5">
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
            {canEditObjects && (
              <button
                type="button"
                onClick={() => {
                  setExpanded(true);
                  setAddOpen(true);
                }}
                aria-label={`Добавить объекты посещения ${event.code}`}
                title="Добавить объекты посещения"
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            {/* Удаление ошибочно заведённого бюллетеня. Отдельное право
                `event.delete`: ведущий мероприятие его правит, стирает из
                реестра администратор. Кнопки НЕТ у того, кто не может
                удалять, — кнопка, обречённая на 403, это обещание. */}
            {canDeleteEvent && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                aria-label={`Удалить мероприятие ${event.code}`}
                title="Удалить мероприятие"
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </span>
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
                  {/* Пустое имя — «объект не выбран», а не пустая ячейка: ОМ
                      заводят до согласования маршрута, и объекты дописывают
                      позже кнопкой в первой колонке. */}
                  {event.objectName === "" ? "объект не выбран" : event.objectName}
                  <span className="mt-[3px] block text-[11px] text-muted-foreground/80">
                    {event.objectName === ""
                      ? "объекты добавляются кнопкой «+»"
                      : event.passportBinding === null
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
            <VisitObjectList
              event={event}
              visits={visits}
              canEdit={canEditObjects}
              backSuffix={backSuffix}
              onAdd={() => setAddOpen(true)}
            />
          </TableCell>
        </TableRow>
      )}

      {addOpen && (
        <AddVisitObjectsDialog
          event={event}
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Подтверждение — окно, а не `confirm()`: удаление необратимо, и
          спросить надо ИМЕНЕМ того, что исчезнет, иначе человек соглашается
          вслепую. */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить {event.code}?</DialogTitle>
            <DialogDescription>
              «{event.title}» исчезнет из реестра вместе с объектами посещения и
              расчётом постов. Отменить это нельзя; след останется только в
              журнале действий. Мероприятия с расстановкой или записями журнала
              штаба сервер удалять не даёт — их проводят или закрывают.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
            {/* Окно закрывается ОТВЕТОМ сервера, а не кликом: отказ («есть
                расстановка») человек должен увидеть здесь же. */}
            <Button
              variant="destructive"
              disabled={removal.isPending}
              onClick={() => removal.mutate({ eventId: event.id })}
            >
              {removal.isPending ? "Удаление…" : "Удалить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
function VisitObjectList({
  event,
  visits,
  canEdit,
  backSuffix,
  onAdd,
}: {
  event: SecurityEvent;
  visits: VisitObject[];
  canEdit: boolean;
  backSuffix: string;
  onAdd: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const removal = useMutation({
    mutationFn: removeVisitObject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
      toast({ title: "Объект снят с мероприятия" });
    },
    // Отказ сервера ОБЪЯСНЯЕТСЯ: снять объект нельзя, пока за ним числятся
    // посты расчёта, и человеку нужно знать причину, а не «не получилось».
    onError: (error: unknown) => {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      toast({
        title: "Объект не снят",
        description:
          message === ""
            ? "Сервис временно недоступен. Попробуйте ещё раз."
            : message,
        variant: "destructive",
      });
    },
  });

  if (visits.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 pl-12 text-xs text-muted-foreground">
        <span>Объекты посещения не заведены.</span>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={onAdd}>
            Добавить объекты
          </Button>
        )}
      </div>
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
              {/* Клик по объекту открывает ЭТАПЫ мероприятия по этому
                  объекту, а не карточку объекта реестра: заказчик просил
                  «клик по объекту открывает этапы». Ссылка на сам объект
                  осталась рядом подписью — это другой адрес (паспорт против
                  этапов), и подменять один другим нельзя. */}
              <span className="min-w-52 font-medium">
                <Link
                  href={`/security-ops/events/${event.id}${
                    backSuffix === ""
                      ? `?visit=${visit.id}`
                      : `${backSuffix}&visit=${visit.id}`
                  }`}
                  className="hover:underline"
                >
                  {visit.objectName}
                </Link>
                {visit.objectId !== null && (
                  <Link
                    href={`/security-ops/objects/${visit.objectId}`}
                    // Имя ссылки называет ОБЪЕКТ: в раскрытой строке таких
                    // ссылок столько же, сколько объектов, и список ссылок
                    // скринридера был бы рядом одинаковых строк.
                    aria-label={`Карточка объекта ${visit.objectName}`}
                    className="ml-2 text-[11px] font-normal text-primary-ink hover:underline"
                  >
                    карточка объекта →
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

              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    removal.mutate({
                      eventId: event.id,
                      visitObjectId: visit.id,
                    })
                  }
                  disabled={removal.isPending}
                  aria-label={`Снять объект ${visit.objectName} с мероприятия`}
                  title="Снять объект с мероприятия"
                  className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}

              {/* Старший объекта — ПЕРВОЙ строкой врезки, до замещающих:
                  замещающий определяется относительно него («вместо
                  старшего»), и читать список замещающих раньше, чем имя того,
                  кого замещают, нельзя. */}
              <ChiefLine event={event} visit={visit} canEdit={canEdit} />

              {/* Замещающие — ВТОРАЯ строка объекта, а не ещё одна колонка:
                  их может не быть, может быть трое, и колонка переменной
                  длины ломала бы выравнивание остальных. Занимает всю ширину
                  врезки (basis-full), поэтому переносится под свой объект, а
                  не встраивается в поток. */}
              <DeputyLine
                event={event}
                visit={visit}
                canEdit={canEdit}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Старший ОБЪЕКТА посещения (Plane «Реестр ОМ-35.2»).
 *
 * Показывается всегда — и когда не назначен: у визита иностранного ОЛ объектов
 * несколько, и «на этом объекте старшего нет» такой же факт маршрута, как имя.
 * Пустое место вместо этой строки читалось бы как «данные не пришли».
 *
 * Кнопки назначения здесь пока нет — она приходит вместе с выпадающим списком
 * сотрудников с постраничкой и поиском (Plane «Реестр ОМ-35.3» и «ОМ-35.7»);
 * снятие уже здесь: ему список не нужен.
 */
function ChiefLine({
  event,
  visit,
  canEdit,
}: {
  event: SecurityEvent;
  visit: VisitObject;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [assignOpen, setAssignOpen] = useState(false);
  const removal = useMutation({
    mutationFn: removeVisitObjectChief,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
      toast({ title: "Старший снят с объекта" });
    },
    onError: (error: unknown) => {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      toast({
        title: "Старший не снят",
        description:
          message === ""
            ? "Сервис временно недоступен. Попробуйте ещё раз."
            : message,
        variant: "destructive",
      });
    },
  });

  return (
    // Своя группа с ИМЕНЕМ ОБЪЕКТА: строк «Старший объекта: …» в раскрытии
    // столько же, сколько объектов, и без имени ни человек со скринридером,
    // ни проба не отличат одну от другой. Подпись «не назначен» тоже входит
    // подстрокой в «Замещающие: не назначены» — ассерт по всей строке объекта
    // был бы вакуумным.
    <span
      role="group"
      aria-label={`Старший объекта ${visit.objectName}`}
      className="mt-0.5 flex basis-full flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
    >
      <span className="font-semibold uppercase tracking-wide">
        Старший объекта:
      </span>
      {visit.chiefEmployeeId === null ? (
        <span>не назначен</span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5">
          <span className="font-medium text-foreground">{visit.chiefName}</span>
          {canEdit && (
            <button
              type="button"
              onClick={() =>
                removal.mutate({
                  eventId: event.id,
                  visitObjectId: visit.id,
                })
              }
              disabled={removal.isPending}
              // Имя называет ОБЪЕКТ: таких кнопок в раскрытой строке столько
              // же, сколько объектов, и список скринридера был бы рядом
              // одинаковых «снять старшего».
              aria-label={`Снять старшего ${visit.chiefName} с объекта ${visit.objectName}`}
              title="Снять старшего с объекта"
              className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setAssignOpen(true)}
          // Имя называет ОБЪЕКТ: таких кнопок в раскрытой строке столько же,
          // сколько объектов, и на слух они были бы неразличимы.
          aria-label={
            visit.chiefEmployeeId === null
              ? `Назначить старшего объекта ${visit.objectName}`
              : `Заменить старшего объекта ${visit.objectName}`
          }
          className="rounded px-1.5 py-0.5 font-semibold text-primary-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visit.chiefEmployeeId === null ? "+ Старший" : "Заменить"}
        </button>
      )}
      {assignOpen && (
        <AssignChiefDialog
          event={event}
          visit={visit}
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
        />
      )}
    </span>
  );
}

/**
 * Замещающие на объекте посещения: кто может вести его расстановку вместо
 * старшего (Plane «Реестр ОМ-24»).
 *
 * Право показывается СЛОВОМ, а не только присутствием в списке: замещающий без
 * права правки — назначенный наблюдатель, и отличить его от правящего по одному
 * лишь имени в строке нельзя.
 */
function DeputyLine({
  event,
  visit,
  canEdit,
}: {
  event: SecurityEvent;
  visit: VisitObject;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const removal = useMutation({
    mutationFn: removeVisitObjectDeputy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-security-events"] });
      toast({ title: "Замещающий снят" });
    },
    onError: (error: unknown) => {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      toast({
        title: "Замещающий не снят",
        description:
          message === ""
            ? "Сервис временно недоступен. Попробуйте ещё раз."
            : message,
        variant: "destructive",
      });
    },
  });
  const deputies = visit.deputies ?? [];

  return (
    <span className="mt-0.5 flex basis-full flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide">Замещающие:</span>
      {deputies.length === 0 && <span>не назначены</span>}
      {deputies.map((deputy) => (
        <span
          key={deputy.id}
          className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5"
        >
          <span className="font-medium text-foreground">
            {deputy.employeeName}
          </span>
          <span>
            {deputy.canEditPlacement ? "правит расстановку" : "только просмотр"}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={() =>
                removal.mutate({
                  eventId: event.id,
                  visitObjectId: visit.id,
                  deputyId: deputy.id,
                })
              }
              disabled={removal.isPending}
              aria-label={`Снять замещающего ${deputy.employeeName} с объекта ${visit.objectName}`}
              title="Снять замещающего"
              className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          // Имя называет ОБЪЕКТ: таких кнопок в раскрытой строке столько же,
          // сколько объектов, и список скринридера был бы рядом одинаковых.
          aria-label={`Добавить замещающего на объект ${visit.objectName}`}
          className="rounded px-1.5 py-0.5 font-semibold text-primary-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          + Замещающий
        </button>
      )}
      {addOpen && (
        <AddDeputyDialog
          event={event}
          visit={visit}
          open={addOpen}
          onClose={() => setAddOpen(false)}
        />
      )}
    </span>
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

  // Мероприятие занимает ВЕСЬ свой период, а не только день начала. До этой
  // правки трёхдневное ОМ ставило отметку на первый день, и на второй-третий
  // календарь показывал пустой день — то есть врал ровно там, где его и
  // открывают: «что у нас в этот день».
  const byDate = new Map<string, SecurityEvent[]>();
  for (const event of events) {
    const last =
      event.businessDateEnd === null || event.businessDateEnd < event.businessDate
        ? event.businessDate
        : event.businessDateEnd;
    // Идём по календарным суткам UTC: даты у мероприятия — деловые, без часа,
    // и локальная полночь на минусовых зонах сдвинула бы период на день.
    for (
      let cursor = new Date(`${event.businessDate}T00:00:00Z`);
      cursor.toISOString().slice(0, 10) <= last;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const iso = cursor.toISOString().slice(0, 10);
      const list = byDate.get(iso) ?? [];
      list.push(event);
      byDate.set(iso, list);
    }
  }

  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // Понедельник — первый столбец: getUTCDay() отдаёт воскресенье нулём.
  const lead = (first.getUTCDay() + 6) % 7;

  const dayIso = (day: number): string =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // День МОЖЕТ быть не выбран — тогда справа стоят все мероприятия месяца, как
  // в эталоне («Все предстоящие мероприятия»). Прежняя редакция всегда
  // подставляла какой-нибудь день, и панель отвечала на вопрос, которого никто
  // не задавал; вернуться к обзору было нечем.
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  // Смена месяца снимает выбор: показывать «мероприятия 27 июля» над сеткой
  // августа было бы враньём заголовка.
  const listDate =
    selected !== null && selected.slice(0, 7) === monthKey ? selected : null;
  const monthEvents = Array.from(
    new Map(
      Array.from(byDate.entries())
        .filter(([iso]) => iso.slice(0, 7) === monthKey)
        .flatMap(([, list]) => list)
        .map((event) => [event.id, event] as const)
    ).values()
  ).sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const listEvents =
    listDate === null ? monthEvents : (byDate.get(listDate) ?? []);

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
                  // Повторный клик по выбранному дню СНИМАЕТ отбор (как в
                  // эталоне): иначе вернуться к обзору месяца было бы нечем —
                  // «показать всё» пришлось бы искать в смене месяца туда и
                  // обратно.
                  onClick={() => setSelected(isSelected ? null : iso)}
                  aria-pressed={isSelected}
                  aria-label={`${day} ${MONTH_NAME[month]}: мероприятий ${dayEvents.length}`}
                  className={`flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-xs transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : dayEvents.length > 0
                        ? "bg-primary/5 hover:bg-muted"
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
          {/* Легенда эталона. Отметка — единственное, что отличает день с
              мероприятием от пустого, и её значение должно быть названо, а не
              угадываться по цвету. */}
          <p className="mt-3 flex items-center gap-2 border-t pt-3 text-[11px] text-muted-foreground">
            <span className="bg-primary size-2.5 rounded-full" aria-hidden="true" />
            Есть мероприятие
            <span className="ml-auto">
              {listDate === null
                ? "день не выбран — справа весь месяц"
                : "повторный клик по дню снимает отбор"}
            </span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>
              {listDate === null
                ? "Все мероприятия месяца"
                : "Мероприятия дня"}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {listDate === null
                ? `${MONTH_NAME[month]} ${year}`
                : formatIsoDate(listDate)}
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
              {listDate === null
                ? "В этом месяце мероприятий нет."
                : "В этот день мероприятий нет."}
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
                    {/* Дата в строке нужна ИМЕННО в обзоре месяца: без неё
                        список выглядит как «мероприятия одного дня», хотя
                        собран со всего месяца. При выбранном дне она уже
                        стоит в заголовке панели и повторялась бы. */}
                    {listDate === null && (
                      <>
                        {formatIsoDate(event.businessDate)}
                        {event.businessDateEnd !== null &&
                          event.businessDateEnd !== event.businessDate &&
                          ` — ${formatIsoDate(event.businessDateEnd)}`}{" "}
                        ·{" "}
                      </>
                    )}
                    {event.objectName === "" ? "объект не выбран" : event.objectName} ·
                    потребность {event.forceNeed} · {event.ownerName}
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
