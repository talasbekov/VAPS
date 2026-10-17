"use client";

// Реестр ОМ: поиск, фильтр по этапу, таблица, создание. Фильтры — в URL
// (обновление страницы не сбрасывает фильтр, ссылкой можно поделиться).
import { Suspense, useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { formatIsoDate, localIsoDate } from "@/shared/lib/date";
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
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { useToast } from "@/shared/hooks/use-toast";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import {
  CreateSecurityEventDialog,
  EditBulletinDialog,
} from "@/features/create-security-event";
import { GvoVisitsRegistry } from "@/widgets/gvo-visits-registry";
import { GvoVisitsDialog } from "@/features/gvo-section-edit";
import {
  AddDeputyDialog,
  AssignChiefDialog,
  EventChiefDialog,
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
  remarkIsOpen,
} from "@/entities/security-event";
import type {
  ListSecurityEventsParams,
  SecurityEvent,
  SecurityEventStage,
  VisitObject,
} from "@/entities/security-event";
import { mayManageVisitObjects } from "@/entities/security-event/model/capabilities";
import { eventWorkspaceHref } from "@/entities/security-event/model/navigation";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { invalidateSecurityEvents } from "@/lib/ops-invalidate";
import { friendlyOpsErrorMessage } from "@/lib/ops-errors";
import { REMARKS, ruCount } from "@/lib/ru-plural";

const PAGE_SIZE = 20;

const MONTH_NAME = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/** Этапы, которые ВЫБИРАЮТСЯ в фильтре реестра (`[РЕЕ-01]`, Plane №440).
 *
 * «Потребность» и «Запрос сил» проходит сервер сам (Plane №110) — человек их
 * не выбирает. Список ОДИН на оба места: и на `<option>`, и на разбор адреса
 * (Plane №713). Пока разбор принимал ВСЕ этапы, ссылка `?stage=DEMAND` (из
 * закладки или из `backSuffix` старой карточки) отбирала реестр по этапу,
 * которого в поле «Этап» нет: управляемый `<select>` без подходящего
 * `<option>` рисуется пустым, и человек видел короткий список без единой
 * подсказки почему. Выйти можно было только сбросом фильтров.
 */
const FILTERABLE_STAGES = SECURITY_EVENT_STAGES.filter(
  (stage) => stage !== "DEMAND" && stage !== "FORCES"
);

function isStage(value: string | null): value is SecurityEventStage {
  return (FILTERABLE_STAGES as readonly string[]).includes(value ?? "");
}

/** «1 замечание · 2 замечания · 5 замечаний» — бейдж читают глазами, и
 *  «1 замечаний» в нём режет так же, как ошибка в цифре.
 *
 *  Правило переехало в `lib/ru-plural` и стало ОДНИМ на портал (Plane №585):
 *  здесь оно было верным, а в уведомлении о ТОМ ЖЕ возврате — своим и
 *  сломанным на втором десятке. Копия правила рядом с копией правила
 *  расходится не «если», а «когда». */
function remarksLabel(n: number): string {
  return ruCount(n, REMARKS);
}

export default function SecurityEventsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <SecurityEventsScreen />
    </Suspense>
  );
}

function SecurityEventsScreen() {
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
  const { hasPermission, isLoading: permissionsLoading, error: permissionsError } = useOpsPermissions();
  const canReadEvents = !permissionsLoading && !permissionsError && hasPermission(MODULE_PERMISSION["/security-ops/events"]);

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
    view === "calendar" ? { ...params, pageSize: 200 } : params,
    { enabled: canReadEvents },
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

  if (permissionsLoading) {
    return <DashboardLayout><p role="status" className="text-sm text-muted-foreground">Проверяем доступ к реестру ОМ…</p></DashboardLayout>;
  }
  if (!canReadEvents) {
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
              {!permissionsLoading && hasPermission("event.create") && (
                <Button onClick={() => setDialogOpen(true)}>
                  + Создать бюллетень
                </Button>
              )}
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
            {/* Тот же список, что разбирает адрес (`FILTERABLE_STAGES`): два
                ответа на «какие этапы выбираются» и были дефектом №713. */}
            {FILTERABLE_STAGES.map((stage) => (
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
          {/* Фильтр отбирает по ВЕДУЩЕМУ карточки (`ownerName`), и с №189 он
              так и называется. Прежняя подпись «Ответственный» повторяла
              подпись колонки, которая теперь отдана СТАРШЕМУ наряда, — одно
              слово на две разные роли обещало бы отбор по старшему и
              отбирало бы по ведущему. */}
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Ведущий"
            value={params.owner}
            onChange={(e) => updateParam("owner", e.target.value)}
          >
            <option value="">Все ведущие</option>
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
      <Card className="gap-0 overflow-hidden py-0">
        <Table className="block w-full xl:table xl:table-fixed">
          <colgroup className="hidden xl:table-column-group">
            <col style={{ width: 56 }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "8%" }} />
            <col />
            <col style={{ width: 56 }} />
          </colgroup>
          <TableHeader className="hidden xl:table-header-group">
            <TableRow>
              <Th>
                <span className="sr-only">Объекты посещения</span>
              </Th>
              {/* Колонки — ПОЛЯ БЮЛЛЕТЕНЯ, в порядке его бланка: дата,
                  время, ОЛ, мероприятие, локация, старший (Plane №189,
                  образец заказчика «02 Бюллетень Орда-4»). Мероприятие стоит
                  первым, а не четвёртым: в бланке строку читают слева
                  направо целиком, в реестре — ищут глазами по названию.
                  Дата и время слиты в одну колонку: время — уточнение даты,
                  и отдельный столбец «09:00» на всю таблицу был бы шире
                  своего содержимого. */}
              <Th>Мероприятие</Th>
              <Th>Дата и время</Th>
              <Th>Охраняемое лицо</Th>
              <Th>Локация и объекты ОМ</Th>
              <Th>Этап и готовность</Th>
              <Th>Потребность</Th>
              <Th>Старший</Th>
              <Th>
                <span className="sr-only">Действия</span>
              </Th>
            </TableRow>
          </TableHeader>
          <TableBody className="block xl:table-row-group">
            {events.map((event) => (
              <EventRow key={event.id} event={event} backSuffix={backSuffix} />
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Колонки эталона, которых в таблице нет. Сноска, а не пустые столбцы:
          пустая колонка на всю таблицу — это не «честная пустота», а шум в
          каждой строке. */}
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Колонки повторяют поля бюллетеня: дата, время, охраняемое лицо,
        мероприятие, локация, старший. Локация и охраняемое лицо здесь — общие
        для мероприятия; у каждого объекта посещения они свои и видны в
        раскрытии строки.
      </p>
    </>
  );
}

/** Название и фон строки открывают рабочую карточку ОМ.
 * Список подробностей раскрывается отдельной кнопкой; ссылки площадок
 * выбирают объект внутри ОМ, сохраняя фильтры для возврата в реестр.
 */
function EventRow({
  event,
  backSuffix,
}: {
  event: SecurityEvent;
  backSuffix: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [chiefOpen, setChiefOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [visitsOpen, setVisitsOpen] = useState(false);
  const detailsId = useId();
  const visits = event.visitObjects ?? [];
  const router = useRouter();
  const backQuery = new URLSearchParams(backSuffix).get("back") ?? undefined;
  const eventHref = eventWorkspaceHref(event.id, { backQuery });
  const { hasPermission } = useOpsPermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Назначение старшим ОМ хранится в данных конкретного мероприятия и не
  // выражается глобальным кодом права: кнопки следуют capability сервера.
  const canManageVisitObjects = mayManageVisitObjects(
    event,
    hasPermission("event.manage"),
  );
  useEffect(() => { if (!canManageVisitObjects) setAddOpen(false); }, [canManageVisitObjects]);
  // Сведения бюллетеня правит и СОЗДАТЕЛЬ ОМ (Plane №951) — по слову сервера
  // (`canEditBulletin`, то же правило, что гейт `details`): создателя клиент
  // сам посчитать не может. Старый сервер поля не несёт — тогда по праву.
  const canEditBulletin =
    (event.canEditBulletin ?? hasPermission("event.manage")) &&
    event.stage !== "CLOSED";
  // Назначение старшего наряда — часть ведения конкретного бюллетеня, а не
  // выдача глобального event.manage. Сервер повторяет этот scoped-гейт в
  // `event_chief`; capability объектов его не расширяет (Plane №1131).
  const canManageEvent = canEditBulletin;
  // Закрытое ОМ сервер удалять отказывается по той же причине.
  const canDeleteEvent =
    hasPermission("event.delete") && event.stage !== "CLOSED";
  const removal = useMutation({
    mutationFn: deleteSecurityEvent,
    onSuccess: () => {
      invalidateSecurityEvents(queryClient);
      toast({ title: `Мероприятие ${event.code} удалено` });
      setDeleteOpen(false);
    },
    // Отказ ОБЪЯСНЯЕТСЯ: сервер не даёт стереть ОМ с расстановкой или
    // записями журнала, и человеку нужна эта причина, а не «не получилось».
    onError: (error: unknown) => {
      toast({
        title: "Мероприятие не удалено",
        description: friendlyOpsErrorMessage(
          error,
          "Нет права удалять это мероприятие.",
        ),
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <TableRow
        className="relative grid cursor-pointer grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-3 gap-y-2 p-3 xl:table-row xl:p-0"
        onClick={(clickEvent) => {
          const target = clickEvent.target as HTMLElement;
          if (target.closest('a,button,input,select,textarea,[role="menuitem"],[role="button"]') !== null) return;
          if (clickEvent.button !== 0 || clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.altKey || clickEvent.shiftKey) return;
          if (window.getSelection()?.toString()) return;
          router.push(eventHref);
        }}
      >
        {/* Раскрыватель и «добавить объекты» — рядом со строкой бюллетеня, как
            просил заказчик. Обе — кнопки: строка ведёт в карточку, и клик по
            ней не должен значить ни то, ни другое. */}
        <TableCell className="absolute left-3 top-3 block w-11 p-0 align-top xl:static xl:table-cell xl:w-14 xl:p-1.5">
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`${expanded ? "Свернуть" : "Развернуть"} объекты посещения ${event.code}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            {/* Действия строки — в меню «⋯» справа (`[РЕЕ-02]`, `[РЕЕ-10]`,
                Plane №440): четырёх иконок слева от кода больше нет; порядок
                пунктов — прежний (Plane №192): объект, бюллетень, удалить. */}
          </span>
        </TableCell>
        {/* На desktop название получает долю фиксированной таблицы; на
            телефоне занимает верх карточки между двумя контролами. */}
        <TableCell className="col-span-2 row-start-1 block min-w-0 p-0 pl-[52px] pr-[52px] whitespace-normal xl:table-cell xl:px-2.5 xl:py-[11px]">
                  <Link
                    href={eventHref}
                    aria-label={`Открыть мероприятие ${event.code}: ${event.title}`}
                    className="block min-h-11 w-full rounded text-left hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-200">
                      {event.code}
                    </span>
                    {/* `whitespace-normal` обязателен: у `TableCell` умолчание
                        примитива — `whitespace-nowrap`, и один только
                        `max-w` название не переносит, а роняет его поверх
                        соседней колонки. */}
                    <span className="mt-1 block font-semibold whitespace-normal break-words">
                      {event.title}
                    </span>
                  </Link>
                </TableCell>

                {/* Даты: начало крупно, продолжительность подписью — в
                    прототипе вторая строка ячейки несёт время смены, которого
                    у мероприятия нет; период же есть и говорит о том же
                    («сколько это длится»). */}
                {/* Дата и время бюллетеня. Время стоит РЯДОМ с датой, а не
                    подписью снизу: вторую строку ячейки занимает период, и
                    время, уехавшее туда же, читалось бы как время окончания.
                    Часа может не быть — тогда его нет и в ячейке: «—» здесь
                    означал бы «назначено на никогда». */}
                <TableCell className="col-start-1 row-start-2 block min-w-0 p-0 whitespace-normal text-muted-foreground xl:table-cell xl:px-2.5 xl:py-[11px]">
                  {formatIsoDate(event.businessDate)}
                  {event.eventTime !== null && (
                    <span className="ml-1.5 text-foreground">
                      {event.eventTime}
                    </span>
                  )}
                  <span className="mt-[3px] block text-[11px] text-muted-foreground/80">
                    {event.businessDateEnd === null ||
                    event.businessDateEnd === event.businessDate
                      ? "один день"
                      : `по ${formatIsoDate(event.businessDateEnd)}`}
                  </span>
                </TableCell>

                {/* Охраняемое лицо — своя колонка, а не строка под названием
                    мероприятия: в бюллетене это отдельное поле, по нему ищут
                    («кто едет»), и спрятанное в подпись оно перестаёт быть
                    находимым глазами. Пусто — ОТВЕТ: бюллетень заводят и без
                    лица, когда визит ещё не подтверждён. */}
                <TableCell className={`${event.protectedPersonName === "" ? "hidden" : "block"} col-span-2 min-w-0 p-0 whitespace-normal break-words text-muted-foreground xl:table-cell xl:px-2.5 xl:py-[11px]`}>
                  {/* Пусто — пусто (`[РЕЕ-10]`, Plane №440): серых подсказок в
                      ячейках нет. */}
                  {event.protectedPersonName === "" ? null : (
                    <>
                      <span className="text-[11px] xl:hidden">Охраняемое лицо: </span>
                      <span className="text-foreground">
                        {event.protectedPersonName}
                      </span>
                      {/* Лиц может быть НЕСКОЛЬКО (Plane №188). В строке
                          названо ГЛАВНОЕ, остальные — числом: перечислять
                          троих в узкой колонке значило бы растянуть строку
                          втрое ради сведения, которое читают в карточке.
                          Число — не украшение: без него строка с одним лицом
                          и строка с четырьмя выглядят одинаково. */}
                      {event.protectedPersons.length > 1 && (
                        <span className="mt-[3px] block text-[11px] text-muted-foreground/80">
                          и ещё {event.protectedPersons.length - 1}
                        </span>
                      )}
                    </>
                  )}
                </TableCell>

                {/* Маршрут виден в раскрытии; число площадок сохраняет строку компактной. */}
                <TableCell className="col-start-2 row-start-2 block min-w-0 p-0 whitespace-normal break-words text-muted-foreground xl:table-cell xl:px-2.5 xl:py-[11px]">
                  <span className="block whitespace-normal">
                    {event.location === "" ? null : event.location}
                  </span>
                  <span className="mt-1 block text-[11px]">Объекты ОМ: {visits.length}</span>
                </TableCell>

                {/* Этап и готовность — одна колонка, как в эталоне: это один
                    ответ на вопрос «где мероприятие сейчас». Конфликты
                    показываются ТОЛЬКО когда они есть: колонка нулей была
                    шумом на всю таблицу, а сигнал в ней терялся. */}
                <TableCell className="col-start-1 block min-w-0 p-0 whitespace-normal xl:table-cell xl:px-2.5 xl:py-[11px]">
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
                      className="h-[5px] min-w-0 max-w-24 flex-1 overflow-hidden rounded-full bg-muted"
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

                <TableCell className="col-start-2 block min-w-0 p-0 whitespace-normal tabular-nums xl:table-cell xl:px-2.5 xl:py-[11px]">
                  <span className="mb-1 block text-[11px] text-muted-foreground xl:hidden">Потребность</span>
                  {event.forceNeed}
                </TableCell>

                {/* СТАРШИЙ, а не ведущий: колонка бланка называется
                    «Старший», и это разные люди — старший отвечает за наряд
                    на месте, ведущий ведёт карточку в системе. Прежде здесь
                    стоял ведущий под подписью «Ответственный», и совпадение
                    этих двух на стенде скрывало подмену. Ведущий не выброшен
                    — он ушёл подписью: реестр остаётся местом, где видно, с
                    кого спрашивать за карточку. */}
                <TableCell className="col-span-2 block min-w-0 p-0 whitespace-normal break-words xl:table-cell xl:px-2.5 xl:py-[11px]">
                  {/* Ячейка по `[РЕЕ-03]` (Plane №440): «не назначен» + «+ Назначить»
                      либо «Фамилия» + ✎; подпись под значением — роль по типу
                      ОМ. Позывной не печатается: у сотрудника его в модели нет
                      (Decisions). «ведёт: …» снято (`[РЕЕ-10]`) — ведущий
                      виден в карточке. */}
                  <span className="text-[11px] text-muted-foreground xl:hidden">Старший: </span>
                  {event.chiefName === "" ? (
                    <span className="text-[11px] text-muted-foreground">не назначен</span>
                  ) : (
                    event.chiefName
                  )}
                  {/* Кнопка назначения — В САМОЙ КОЛОНКЕ, а не в первой
                      вместе с «+» и корзиной (Plane №190). Первая колонка
                      отвечает на вопрос «что сделать со строкой», а старший —
                      значение этой ячейки, и править его удобнее там, где он
                      написан. Кнопки нет у того, кто не может вести
                      мероприятие, и у закрытого ОМ: кнопка, обречённая на
                      отказ, — обещание. */}
                  {canManageEvent && (
                    <button
                      type="button"
                      onClick={() => setChiefOpen(true)}
                      aria-label={
                        event.chiefName === ""
                          ? `Назначить старшего наряда ${event.code}`
                          : `Заменить старшего наряда ${event.code}`
                      }
                      className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded px-1 text-[11px] font-semibold text-primary-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={event.chiefName === "" ? undefined : "Изменить"}
                    >
                      {event.chiefName === "" ? (
                        "+ Назначить"
                      ) : (
                        <Pencil className="inline h-3 w-3" aria-hidden="true" />
                      )}
                    </button>
                  )}
                  <span className="mt-[3px] hidden text-[11px] text-muted-foreground/80 xl:block">
                    {event.kind === "FOREIGN" ? "ГВО" : "Старший наряда"}
                  </span>
                </TableCell>
        {/* Меню доступно и читателю: нативная ссылка открывает этапы ОМ. */}
        <TableCell className="absolute right-3 top-3 block w-11 p-0 text-center text-muted-foreground xl:static xl:table-cell xl:w-14 xl:p-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Действия ${event.code}`}
                  title="Действия"
                  className="inline-flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="[&_[role=menuitem]]:min-h-11"
                // 🔴 ВСПЛЫТИЕ ГАСИТСЯ ЗДЕСЬ, А НЕ У КАЖДОГО ПУНКТА (Plane №712).
                // Содержимое меню рисуется ЧЕРЕЗ ПОРТАЛ, но синтетические
                // события React всплывают по дереву REACT, а не DOM: клик по
                // пункту доходил до `onClick` строки. Гард строки его не
                // накрывал — он спрашивает `target.closest("button")`, а Radix
                // рисует пункт как `div`, и предки этого `div` в DOM — контейнер
                // портала в `body`, не строка. Сам Radix `stopPropagation` не
                // зовёт. До №440 действия были настоящими кнопками ВНУТРИ
                // строки, и гард их накрывал — дыру открыл переезд в меню.
                //
                // На контейнере, а не на пунктах: пункт, дописанный завтра,
                // получит защиту сам, а забытый `stopPropagation` у одного из
                // четырёх воспроизвёл бы дефект в трудноуловимом виде.
                onClick={(clickEvent) => clickEvent.stopPropagation()}
              >
                <DropdownMenuItem asChild>
                  <Link href={eventHref} aria-label={`Открыть этапы мероприятия ${event.code}`}>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" /> Открыть ОМ
                  </Link>
                </DropdownMenuItem>
                {canManageVisitObjects && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setExpanded(true);
                      setAddOpen(true);
                    }}
                    aria-label={`Добавить объекты посещения ${event.code}`}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> Добавить объект
                  </DropdownMenuItem>
                )}
                {canEditBulletin && (
                  <DropdownMenuItem
                    onSelect={() => setEditOpen(true)}
                    aria-label={`Редактировать бюллетень ${event.code}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Редактировать бюллетень
                  </DropdownMenuItem>
                )}
                {canDeleteEvent && (
                  <DropdownMenuItem
                    onSelect={() => setDeleteOpen(true)}
                    aria-label={`Удалить мероприятие ${event.code}`}
                    className="text-destructive-ink"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Удалить
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow id={detailsId} className="block bg-muted/40 hover:bg-muted/40 xl:table-row">
          <TableCell colSpan={9} className="block min-w-0 p-0 whitespace-normal xl:table-cell">
            <VisitObjectList
              event={event}
              visits={visits}
              canManageObjects={canManageVisitObjects}
              canManageDeputies={canManageEvent}
              backSuffix={backSuffix}
              onAdd={() => setAddOpen(true)}
              onEdit={() => setVisitsOpen(true)}
            />
          </TableCell>
        </TableRow>
      )}

      {editOpen && (
        <EditBulletinDialog
          event={event}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}

      {chiefOpen && (
        <EventChiefDialog
          event={event}
          open={chiefOpen}
          onClose={() => setChiefOpen(false)}
        />
      )}

      {addOpen && canManageVisitObjects && (
        <AddVisitObjectsDialog
          event={event}
          open={addOpen}
          // Строку раскрывает САМ пункт меню (`setExpanded(true)` в `onSelect`),
          // и с №712 это наконец работает: раньше всплытие клика тут же
          // схлопывало её обратно, поэтому раскрытие пришлось повторять при
          // ЗАКРЫТИИ диалога. Обход снят вместе с причиной — иначе «Отмена»
          // в диалоге продолжала бы раскрывать строку, которую человек не
          // просил раскрывать.
          onClose={() => setAddOpen(false)}
        />
      )}

      {visitsOpen && (
        <GvoVisitsDialog event={event} onClose={() => setVisitsOpen(false)} />
      )}

      {/* Подтверждение — окно, а не `confirm()`: удаление необратимо, и
          спросить надо ИМЕНЕМ того, что исчезнет, иначе человек соглашается
          вслепую. */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
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
 * не размечен по объектам» — так у второго и последующих объектов, если в
 * расчёте остались строки без объекта. Тогда вместо доли стоит причина, а не
 * ноль и не прочерк.
 *
 * Подпись этой причины переписана вместе с `[РЕЕ-04]` (Plane №387): прежнее
 * «расстановка ведётся на мероприятии целиком» перестало быть правдой после
 * плана №385 — рекогносцировка (№409) и расстановка (№410) адресуются
 * ОБЪЕКТУ, и неизвестность означает теперь не «так устроена система», а
 * «в расчёте остались неразмеченные посты».
 */
function VisitObjectList({
  event,
  visits,
  canManageObjects,
  canManageDeputies,
  backSuffix,
  onAdd,
  onEdit,
}: {
  event: SecurityEvent;
  visits: VisitObject[];
  canManageObjects: boolean;
  canManageDeputies: boolean;
  backSuffix: string;
  onAdd: () => void;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const removal = useMutation({
    mutationFn: removeVisitObject,
    onSuccess: () => {
      invalidateSecurityEvents(queryClient);
      toast({ title: "Объект снят с мероприятия" });
    },
    // Отказ сервера ОБЪЯСНЯЕТСЯ: снять объект нельзя, пока за ним числятся
    // посты расчёта, и человеку нужно знать причину, а не «не получилось».
    onError: (error: unknown) => {
      toast({
        title: "Объект не снят",
        description: friendlyOpsErrorMessage(
          error,
          "Нет права снимать объект с мероприятия.",
        ),
        variant: "destructive",
      });
    },
  });

  if (visits.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 pl-12 text-xs text-muted-foreground">
        <span>Объекты посещения не заведены.</span>
        {/* ПОДПИСЬ КНОПКИ ОДНА И ТА ЖЕ здесь и в шапке заполненного списка
            (`[РЕЕ-04]`): человек ищет действие по названию, и «Добавить
            объекты» в пустом состоянии против «+ Добавить объект» в шапке
            читались бы как два разных действия. */}
        {canManageObjects && (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 min-w-11"
            onClick={onAdd}
            // Имя называет МЕРОПРИЯТИЕ — по той же причине, что у кнопки в
            // шапке заполненного списка: раскрытых строк на экране много.
            aria-label={`Добавить объект посещения в мероприятие ${event.code}`}
          >
            + Добавить объект
          </Button>
        )}
        {/* Раскрытие пустого списка не должно быть тупиком: этапы у такого
            мероприятия есть (бюллетень, согласование), и путь к ним обязан
            быть назван прямо здесь, а не только крохотной стрелкой в конце
            строки (Plane №256). */}
        <Link
          href={`/security-ops/events/${event.id}${backSuffix}`}
          className="inline-flex min-h-11 min-w-11 items-center rounded font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Открыть этапы мероприятия →
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-3 min-w-0 border-l-2 border-primary/30 py-2 pl-3 xl:ml-9 xl:pl-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          Объекты посещения · {visits.length}
        </p>
        {canManageObjects && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Добавить объект посещения в мероприятие ${event.code}`}
            className="inline-flex min-h-11 min-w-11 items-center rounded px-2 text-[11px] font-semibold text-primary-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            + Добавить объект
          </button>
        )}
      </div>
      <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-background">
        {visits.map((visit) => (
          <VisitObjectRow
            key={visit.id}
            event={event}
            visit={visit}
            canEdit={canManageObjects && visit.stage !== "CLOSED"}
            canEditDeputies={canManageDeputies && visit.stage !== "CLOSED"}
            backSuffix={backSuffix}
            onEdit={onEdit}
            onRemove={() => removal.mutate({ eventId: event.id, visitObjectId: visit.id })}
            removalPending={removal.isPending}
          />
        ))}
      </ul>
    </div>
  );
}

/** Одна площадка — краткая сводка; формы и редкие сведения открываются по запросу. */
function VisitObjectRow({
  event,
  visit,
  canEdit,
  canEditDeputies,
  backSuffix,
  onEdit,
  onRemove,
  removalPending,
}: {
  event: SecurityEvent;
  visit: VisitObject;
  canEdit: boolean;
  canEditDeputies: boolean;
  backSuffix: string;
  onEdit: () => void;
  onRemove: () => void;
  removalPending: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const need = visit.placementNeed;
  const assigned = visit.placementAssigned;
  const percent = need !== null && need > 0 && assigned !== null
    ? Math.round((assigned / need) * 100)
    : null;
  const backQuery = new URLSearchParams(backSuffix).get("back") ?? undefined;

  return (
    <li className="whitespace-normal text-xs">
      <div className="flex min-h-[76px] items-center gap-2 px-3 py-2" data-slot="visit-object-summary">
        <div className="grid min-w-0 flex-1 grid-cols-2 items-center gap-x-3 gap-y-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.75fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          <Link
            href={eventWorkspaceHref(event.id, { visitId: visit.id, backQuery })}
            className="order-1 col-span-2 flex min-h-11 min-w-11 items-center rounded font-semibold break-words text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:col-span-1"
          >
            {visit.objectName}
          </Link>
          <div className="order-2 flex min-w-0 flex-wrap items-center gap-1">
            <span
              className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground/80"
              data-slot="visit-status-chip"
            >
              {visit.statusLabel}
            </span>
            {visit.approvalStatus === "RETURNED" && (
              <span
                className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                data-slot="visit-returned-badge"
              >
                Возвращено · {remarksLabel(visit.approvalRemarks.filter(remarkIsOpen).length)}
              </span>
            )}
            {visit.approvalRemarks.some((remark) => remarkIsOpen(remark) && remark.urgent) && (
              <span
                className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10.5px] font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-200"
                data-slot="visit-urgent-badge"
              >
                Срочно
              </span>
            )}
          </div>
          <div className="order-4 col-span-2 min-w-0 break-words text-[11px] text-muted-foreground xl:order-3 xl:col-span-1">
            <span className="block tabular-nums">
              потребность {need === null ? "неизвестна" : need}, назначено {assigned === null ? "неизвестно" : assigned}
            </span>
            {need === 0 && <span className="block text-[10.5px]">посты не рассчитаны</span>}
            {need === null && <span className="block text-[10.5px]">расчёт постов не размечен по объектам</span>}
          </div>
          <div className="order-3 min-w-0 break-words text-[11px] xl:order-4">
            <span className="text-muted-foreground">Старший: </span>
            {visit.chiefEmployeeId === null ? <span className="text-muted-foreground">не назначен</span> : visit.chiefName}
          </div>
        </div>
        <button
          type="button"
          aria-label={`Подробности объекта ${visit.objectName}`}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((value) => !value)}
          className="flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:self-center"
        >
          {detailsOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {detailsOpen && (
        <div id={detailsId} className="space-y-3 border-t border-border/70 bg-muted/20 p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
              {visit.photoUrl !== null ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL снимка приходит из медиа-хранилища.
                <img src={visit.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : <Building2 className="h-6 w-6" aria-hidden="true" />}
            </div>
            <div className="min-w-0 space-y-1 break-words text-[11px] text-muted-foreground">
              <p>{visit.passportBinding === null ? "паспорт не привязан" : `паспорт вер. ${visit.passportBinding.versionNumber}`}</p>
              <p>
                {visit.visitDay === null ? <>в дату мероприятия {formatIsoDate(event.businessDate)}</> : <>Посещение: {formatIsoDate(visit.visitDay)}</>}
              </p>
              <p>
                {visit.protectedPersonName === "" ? "охраняемое лицо не назначено" : `Охраняемое лицо: ${visit.protectedPersonName}`}
              </p>
              {visit.note !== "" && <p>Примечание: {visit.note}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {visit.description !== "" && <p className="min-w-0 break-words text-muted-foreground">{visit.description}</p>}
            {canEdit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onEdit}
                aria-label={`${visit.description === "" ? "Добавить" : "Редактировать"} описание объекта ${visit.objectName}`}
                className="min-h-11 min-w-11 whitespace-normal px-2 text-xs"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                {visit.description === "" ? "Добавить описание" : "Редактировать описание"}
              </Button>
            )}
          </div>
          {percent !== null && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span
                className="h-[5px] w-24 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Готовность расстановки: ${visit.objectName}`}
              >
                <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
              </span>
              <span>{percent}%</span>
            </div>
          )}
          <div className="space-y-2 border-t border-border/60 pt-2">
            <ChiefLine event={event} visit={visit} canEdit={canEdit} />
            <DeputyLine event={event} visit={visit} canEdit={canEditDeputies} />
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={onRemove}
              disabled={removalPending}
              aria-label={`Снять объект ${visit.objectName} с мероприятия`}
              className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded px-2 text-[11px] text-destructive-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Снять с мероприятия
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Старший ОБЪЕКТА посещения (Plane «Реестр ОМ-35.2»).
 *
 * Показывается всегда — и когда не назначен: у визита иностранного ОЛ объектов
 * несколько, и «на этом объекте старшего нет» такой же факт маршрута, как имя.
 * Пустое место вместо этой строки читалось бы как «данные не пришли».
 *
 * В подробностях доступны назначение, замена и снятие старшего.
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
      invalidateSecurityEvents(queryClient);
      toast({ title: "Старший снят с объекта" });
    },
    onError: (error: unknown) => {
      toast({
        title: "Старший не снят",
        description: friendlyOpsErrorMessage(
          error,
          "Нет права менять старшего объекта.",
        ),
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
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
    >
      <span className="font-semibold uppercase tracking-wide">
        Старший объекта:
      </span>
      {visit.chiefEmployeeId === null ? (
        <span>не назначен</span>
      ) : (
        <span className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-background px-2 py-0.5">
          <span className="min-w-0 max-w-full break-words font-medium text-foreground">{visit.chiefName}</span>
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 font-semibold text-primary-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      invalidateSecurityEvents(queryClient);
      toast({ title: "Замещающий снят" });
    },
    onError: (error: unknown) => {
      toast({
        title: "Замещающий не снят",
        description: friendlyOpsErrorMessage(
          error,
          "Нет права менять замещающих объекта.",
        ),
        variant: "destructive",
      });
    },
  });
  const deputies = visit.deputies ?? [];

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide">Замещающие:</span>
      {deputies.length === 0 && <span>не назначены</span>}
      {deputies.map((deputy) => (
        <span
          key={deputy.id}
          className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-background px-2 py-0.5"
        >
          <span className="min-w-0 max-w-full break-words font-medium text-foreground">
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 font-semibold text-primary-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  // Местная дата, а не срез UTC (Plane №927): `toISOString` в поясе +05
  // между 00:00 и 05:00 отдаёт вчерашний день, и календарь открывался бы не
  // на том месяце. Разбор — в `shared/lib/date.ts`.
  const todayIso = localIsoDate();
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
  return <TableHead className="px-2 whitespace-normal break-words">{children}</TableHead>;
}
