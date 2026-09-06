"use client";

// Реестр ОМ: поиск, фильтр по этапу, таблица, создание. Фильтры — в URL
// (обновление страницы не сбрасывает фильтр, ссылкой можно поделиться).
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
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
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { useToast } from "@/shared/hooks/use-toast";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import {
  CreateSecurityEventDialog,
  EditBulletinDialog,
} from "@/features/create-security-event";
import { GvoVisitsRegistry } from "@/widgets/gvo-visits-registry";
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
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { invalidateSecurityEvents } from "@/lib/ops-invalidate";
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

  if (!permissionsLoading && !hasPermission(MODULE_PERMISSION["/security-ops/events"])) {
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
      <Card>
        <Table>
          <TableHeader>
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
              <Th>Локация</Th>
              <Th>Этап и готовность</Th>
              <Th>Потребность</Th>
              <Th>Старший</Th>
              <Th>
                <span className="sr-only">Действия</span>
              </Th>
            </TableRow>
          </TableHeader>
          <TableBody>
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

/**
 * Строка реестра = БЮЛЛЕТЕНЬ. Раскрытие показывает объекты посещения этого
 * мероприятия: куда едет охраняемое лицо и насколько закрыта расстановка.
 *
 * КЛИК ПО СТРОКЕ РАСКРЫВАЕТ СПИСОК, А НЕ УВОДИТ В ЭТАПЫ — решение заказчика
 * 27.08.2026 (Plane №191), дословно: «При нажатии на бюллетень только список
 * должен раскрываться». Прежде строка вела в карточку, и раскрыватель был
 * единственным способом посмотреть объекты — то есть частое действие стоило
 * прицеливания в кнопку 24×24, а редкое случалось от любого промаха.
 *
 * САМ БЮЛЛЕТЕНЬ ТОЖЕ РАСКРЫВАЕТ (Plane №256, 28.08.2026). №191 снял переход с
 * фона строки, но код с названием остался ссылкой в этапы — а «нажать на
 * бюллетень» значит нажать именно туда, и заказчик поставил задачу второй раз
 * со словами «ты его не выполнил». Теперь раскрывают оба места: фон строки и
 * сам бюллетень.
 *
 * В карточку из строки ведёт ОДНА ссылка — стрелка «›» в конце, с внятным
 * именем «Открыть этапы мероприятия». Её нельзя убрать вслед за остальными:
 * этапы есть и у мероприятия без объектов, и без этой ссылки они стали бы
 * недостижимы. Второй путь — по объекту в раскрытии, как просил заказчик:
 * этапы открываются по конкретному объекту.
 *
 * Обработчик строки пропускает клики из ссылок и кнопок: иначе переход в
 * карточку заодно раскрывал бы список, а удаление — сворачивал.
 *
 * Детали живут ВТОРОЙ строкой таблицы, а не Accordion: внутрь `<tbody>` можно
 * положить только `<tr>`, и обёртка Radix ломала бы разметку таблицы.
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
      invalidateSecurityEvents(queryClient);
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
          setExpanded((value) => !value);
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
            {/* Действия строки — в меню «⋯» справа (`[РЕЕ-02]`, `[РЕЕ-10]`,
                Plane №440): четырёх иконок слева от кода больше нет; порядок
                пунктов — прежний (Plane №192): объект, бюллетень, удалить. */}
          </span>
        </TableCell>
        {/* Ширина названия ОГРАНИЧЕНА, и это не украшение. Колонок с №189
            девять, и длинное название в одну строку растягивало таблицу за
            край экрана — «Старший», крайняя правая колонка, уезжала в
            горизонтальную прокрутку.

            Потолок стоит на ВНУТРЕННЕМ блоке, а не на самой ячейке: в
            табличной раскладке `max-width` у `<td>` браузером не соблюдается
            — колонка остаётся широкой, а текст просто вылезает поверх соседней.
            Замерено на стенде: название наезжало на «Дата и время». */}
        <TableCell>
                  {/* САМ БЮЛЛЕТЕНЬ РАСКРЫВАЕТ СПИСОК, А НЕ ВЕДЁТ В ЭТАПЫ
                      (Plane №256, требование заказчика вторым разом).
                      Здесь была ссылка в карточку — и это и есть то, на что
                      он жаловался: код с названием — самое крупное и
                      очевидное место строки, «нажать на бюллетень» значит
                      нажать именно сюда. Правка №191 сняла переход с ФОНА
                      строки, но оставила его на самом бюллетене, и снаружи
                      выглядело, будто не изменилось ничего.

                      Кнопка, а не ссылка: раскрытие — не адрес, и `<a>` без
                      href обманывал бы и скринридер, и среднюю кнопку мыши.
                      Состояние объявлено (`aria-expanded`/`aria-controls`) —
                      иначе список раскрывается молча. */}
                  <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    className="block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-200">
                      {event.code}
                    </span>
                    {/* `whitespace-normal` обязателен: у `TableCell` умолчание
                        примитива — `whitespace-nowrap`, и один только
                        `max-w` название не переносит, а роняет его поверх
                        соседней колонки. */}
                    <span className="mt-1 block max-w-[300px] font-semibold whitespace-normal">
                      {event.title}
                    </span>
                  </button>
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
                <TableCell className="whitespace-nowrap text-muted-foreground">
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
                <TableCell className="text-muted-foreground">
                  {/* Пусто — пусто (`[РЕЕ-10]`, Plane №440): серых подсказок в
                      ячейках нет. */}
                  {event.protectedPersonName === "" ? null : (
                    <>
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

                {/* ЛОКАЦИЯ — это поле `location` бюллетеня, а не имя объекта.
                    Разошлось это молча: колонка называлась «Локация» и
                    показывала объект ещё до №189, а бланк бюллетеня под этим
                    словом понимает МЕСТО проведения («г. Астана»). Поймано
                    живой пробой правки бюллетеня (Plane №192): проба меняла
                    локацию через окно и не находила её в строке — потому что
                    строка показывала совсем другое поле.

                    Объект не выброшен, он ушёл подписью: у мероприятия он
                    один и он же ведёт паспорт, а объекты посещения со своими
                    паспортами живут в раскрытии строки.

                    Потолок ширины — на блоке, а не на ячейке: см. колонку
                    мероприятия выше. */}
                <TableCell className="text-muted-foreground">
                  <span className="block max-w-[210px] whitespace-normal">
                    {event.location === "" ? null : event.location}
                  </span>
                  <span className="mt-[3px] block max-w-[210px] whitespace-normal text-[11px] text-muted-foreground/80">
                    {/* Пустое имя — ПУСТАЯ ЯЧЕЙКА (Plane №715). Здесь стояло
                        обещание подписи «объект не выбран» и кнопки «+» в
                        первой колонке — ни того, ни другого в коде нет: строка
                        ниже рисует `null`, а добавление объектов переехало в
                        меню «⋯» (Plane №440). Подпись «объект не выбран» жива
                        в списке дня ниже, где строка одна и место есть; в
                        таблице на девять колонок она была бы шумом в каждой
                        строке нового ОМ. */}
                    {event.objectName === ""
                      ? null
                      : `${event.objectName} · ${
                          event.passportBinding === null
                            ? "паспорт не привязан"
                            : `паспорт вер. ${event.passportBinding.versionNumber}`
                        }`}
                  </span>
                </TableCell>

                {/* Этап и готовность — одна колонка, как в эталоне: это один
                    ответ на вопрос «где мероприятие сейчас». Конфликты
                    показываются ТОЛЬКО когда они есть: колонка нулей была
                    шумом на всю таблицу, а сигнал в ней терялся. */}
                <TableCell className="min-w-[150px]">
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

                {/* СТАРШИЙ, а не ведущий: колонка бланка называется
                    «Старший», и это разные люди — старший отвечает за наряд
                    на месте, ведущий ведёт карточку в системе. Прежде здесь
                    стоял ведущий под подписью «Ответственный», и совпадение
                    этих двух на стенде скрывало подмену. Ведущий не выброшен
                    — он ушёл подписью: реестр остаётся местом, где видно, с
                    кого спрашивать за карточку. */}
                <TableCell>
                  {/* Ячейка по `[РЕЕ-03]` (Plane №440): «не назначен» + «+ Назначить»
                      либо «Фамилия» + ✎; подпись под значением — роль по типу
                      ОМ. Позывной не печатается: у сотрудника его в модели нет
                      (Decisions). «ведёт: …» снято (`[РЕЕ-10]`) — ведущий
                      виден в карточке. */}
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
                  {canEditObjects && (
                    <button
                      type="button"
                      onClick={() => setChiefOpen(true)}
                      aria-label={
                        event.chiefName === ""
                          ? `Назначить старшего наряда ${event.code}`
                          : `Заменить старшего наряда ${event.code}`
                      }
                      className="ml-1 rounded px-1 py-0.5 text-[11px] font-semibold text-primary-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={event.chiefName === "" ? undefined : "Изменить"}
                    >
                      {event.chiefName === "" ? (
                        "+ Назначить"
                      ) : (
                        <Pencil className="inline h-3 w-3" aria-hidden="true" />
                      )}
                    </button>
                  )}
                  <span className="mt-[3px] block text-[11px] text-muted-foreground/80">
                    {event.kind === "FOREIGN" ? "ГВО" : "Старший наряда"}
                  </span>
                </TableCell>
        {/* Стрелка — ЕДИНСТВЕННЫЙ явный вход в карточку ОМ из строки, и
            поэтому она остаётся ссылкой: этапы бюллетеня, согласования и
            закрытия живут и у мероприятия БЕЗ объектов, и лишить их входа
            значило бы сделать половину цикла недостижимой. «›» скринридеру
            ничего не говорит — имя называет и действие, и адресата. */}
        <TableCell className="text-center text-muted-foreground">
          {(canEditObjects || canDeleteEvent) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Действия ${event.code}`}
                  title="Действия"
                  className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
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
                {canEditObjects && (
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
                {canEditObjects && (
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
          )}
          <Link
            href={`/security-ops/events/${event.id}${backSuffix}`}
            aria-label={`Открыть этапы мероприятия ${event.code}`}
            title="Открыть этапы мероприятия"
            className="rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ›
          </Link>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow id={detailsId} className="bg-muted/40 hover:bg-muted/40">
          <TableCell colSpan={9} className="p-0">
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

      {addOpen && (
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
      invalidateSecurityEvents(queryClient);
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
        {/* ПОДПИСЬ КНОПКИ ОДНА И ТА ЖЕ здесь и в шапке заполненного списка
            (`[РЕЕ-04]`): человек ищет действие по названию, и «Добавить
            объекты» в пустом состоянии против «+ Добавить объект» в шапке
            читались бы как два разных действия. */}
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
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
          className="font-medium text-primary-ink hover:underline"
        >
          Открыть этапы мероприятия →
        </Link>
      </div>
    );
  }
  return (
    // Врезка, а не «ещё одна таблица»: колонки раскрытия не совпадают с
    // колонками реестра, и попытка выровнять их друг под друга читалась бы
    // как сбитая вёрстка. Левая граница и отступ говорят «это внутри строки».
    <div className="ml-9 border-l-2 border-primary/30 py-2 pl-4 pr-4">
      {/* ЗАГОЛОВОК СО СВОИМ ДЕЙСТВИЕМ (`[РЕЕ-04]`, Plane №387): «+ Добавить
          объект» стоит там, где человек читает «объектов N», а не только
          иконкой «+» в колонке действий строки бюллетеня. Иконка остаётся —
          она короче для того, кто её уже нашёл, — но искать её глазами в
          ряду из четырёх одинаковых квадратов, чтобы дописать второй объект,
          человек не обязан. Лимита нет: объектов у бюллетеня столько,
          сколько мест посещает охраняемое лицо. */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
          Объекты посещения · {visits.length}
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={onAdd}
            // Имя называет МЕРОПРИЯТИЕ: таких кнопок на экране столько же,
            // сколько раскрытых строк, и на слух они были бы неразличимы.
            aria-label={`Добавить объект посещения в мероприятие ${event.code}`}
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-primary-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            + Добавить объект
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {visits.map((visit) => {
          const known = visit.placementNeed !== null;
          const need = visit.placementNeed ?? 0;
          const assigned = visit.placementAssigned ?? 0;
          const percent = need === 0 ? 0 : Math.round((assigned / need) * 100);
          // ЗАКРЫТЫЙ ОБЪЕКТ ПРАВИТСЯ НЕ БОЛЬШЕ, ЧЕМ ЗАКРЫТОЕ ОМ (Plane №607).
          // `canEdit` считается один раз на МЕРОПРИЯТИЕ, а этап мероприятия —
          // наименьший среди объектов: пока жив хоть один незакрытый, ОМ стоит
          // на «Проведении», и у ЗАКРЫТОГО объекта все кнопки оставались
          // включёнными. Сервер их теперь отбивает
          // (`VISIT_OBJECT_ALREADY_CLOSED`), и довод здесь тот же, которым
          // выше объяснён `canEdit` для закрытого ОМ: кнопка, которая
          // гарантированно получит отказ, — обещание, а не действие.
          const canEditVisit = canEdit && visit.stage !== "CLOSED";
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

              {/* ДАТА ПОСЕЩЕНИЯ — заказчик просил у объекта те же данные, что
                  у строки бюллетеня (Plane №194). Своя дата есть не у всякого
                  объекта: у однодневного ОМ она названа в бюллетене, и
                  дублировать её в каждой строке значило бы завести второй
                  ответ, который однажды разойдётся с первым. Поэтому здесь
                  ЛИБО собственный день объекта, ЛИБО прямая отсылка к дате
                  мероприятия — но не пусто: пустая ячейка читается как
                  «неизвестно», а известно. */}
              <span className="min-w-40 whitespace-nowrap text-[11px] text-muted-foreground">
                {visit.visitDay === null ? (
                  <>в дату мероприятия{" "}
                    <span className="text-xs text-foreground">
                      {formatIsoDate(event.businessDate)}
                    </span>
                  </>
                ) : (
                  <>Посещение:{" "}
                    <span className="text-xs text-foreground">
                      {formatIsoDate(visit.visitDay)}
                    </span>
                  </>
                )}
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

              {/* Статус объекта словами (`[РЕЕ-08]`/`[РЕК-08]`, Plane №423):
                  нейтральный чип ПЕРЕД полосой готовности и тревожными
                  бейджами — это состояние, а не предупреждение, и цветом с
                  «Возвращено»/«Срочно» оно не спорит. Подпись даёт сервер. */}
              <span
                className="inline-flex whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground/80"
                data-slot="visit-status-chip"
              >
                {visit.statusLabel}
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
                  {/* ПОТРЕБНОСТЬ названа словом, а не только долей: в строке
                      бюллетеня у неё своя колонка, и заказчик просил ту же
                      сводку у объекта (Plane №194). «3 из 3» без подписи
                      читается как что угодно — от постов до людей. */}
                  <span className="tabular-nums text-[11px] text-muted-foreground">
                    потребность {need}, назначено {assigned}
                  </span>
                </span>
              )}
              {/* Бейджи возврата (`[РЕЕ-08]`/`[ВОЗ-03]`, Plane №400): объект
                  вернули с согласования — реестр говорит это словами, не
                  заставляя открывать карточку. Считаются замечания БЕЗ ОТВЕТА:
                  именно их старшему чинить; «Срочно» — если хоть одно из них
                  срочное. Ширина ограничена nowrap: бейдж не переносится. */}
              {visit.approvalStatus === "RETURNED" && (
                <span
                  className="inline-flex whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                  data-slot="visit-returned-badge"
                >
                  Возвращено · {remarksLabel(
                    visit.approvalRemarks.filter(remarkIsOpen).length
                  )}
                </span>
              )}
              {visit.approvalRemarks.some((r) => remarkIsOpen(r) && r.urgent) && (
                <span
                  className="inline-flex whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[10.5px] font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-200"
                  data-slot="visit-urgent-badge"
                >
                  Срочно
                </span>
              )}
              {known && need === 0 && (
                <span className="text-[11px] text-muted-foreground">
                  посты не рассчитаны
                </span>
              )}
              {!known && (
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                  расчёт постов не размечен по объектам
                </span>
              )}

              {canEditVisit && (
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
              <ChiefLine event={event} visit={visit} canEdit={canEditVisit} />

              {/* Замещающие — ВТОРАЯ строка объекта, а не ещё одна колонка:
                  их может не быть, может быть трое, и колонка переменной
                  длины ломала бы выравнивание остальных. Занимает всю ширину
                  врезки (basis-full), поэтому переносится под свой объект, а
                  не встраивается в поток. */}
              <DeputyLine
                event={event}
                visit={visit}
                canEdit={canEditVisit}
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
      invalidateSecurityEvents(queryClient);
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
      invalidateSecurityEvents(queryClient);
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
