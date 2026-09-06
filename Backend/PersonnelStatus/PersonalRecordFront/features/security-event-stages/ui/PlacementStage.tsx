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
// Сверка с прототипом доведена до конца 26.08.2026 (Plane №65, шаги
// «Р-1»…«Р-8»); полный список расхождений и решение по каждому —
// obsidian-vault/WIKI/План-расстановка-по-прототипу.md.
//
// Чего у бэка нет и что поэтому НЕ нарисовано (вместо выдумки — прямая
// подпись на экране):
// * версии расстановки и «Сохранить расстановку» — назначение уходит на
//   сервер сразу, сохранять нечего;
// * «Отменить ОМ» — ручки отмены у мероприятия нет;
// * «⋯» и «⚙» — в прототипе это пустые декорации без поведения;
// * «Рекомендация автоподбора» переживает только сессию экрана: сервер не
//   помнит, поставлен человек рукой или автоподбором (шаг «Р-6»).
//
// Что появилось и больше отклонением НЕ является: поимённый состав
// мероприятия (шаг «СС-5» — подбор идёт по нему, а не по кадровому снимку),
// старший сектора (шаг «Р-4»), статус дня и подразделение у людей (шаги
// «Р-1»/«Р-2»), модалка рейтинга (шаг «Р-5»), смена поста (шаг «Р-7»).
import { useEffect, useMemo, useState } from "react";
import {
  useVisitObjectScope,
  UNASSIGNED_VISIT,
  VisitObjectPicker,
} from "./useVisitObjectScope";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AccessHints, RightGate } from "@/shared/ui/right-gate";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GripVertical, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ConflictDialog } from "@/features/ops-conflict-override";
// `OpsConflictError` СНЯТ из импорта (Plane №767): им перестали пользоваться,
// когда разбор конфликта переехал в `ConflictDialog`.
import { OpsApiError, OpsNetworkError } from "@/lib/ops-errors";
import { useToast } from "@/shared/hooks/use-toast";
import { RatingBriefDialog } from "./RatingBriefDialog";
import {
  PLACEMENT_MANAGE,
  useChainAccess,
  EVENT_MANAGE,
} from "@/features/forces-split/ui/chain-access";
import {
  useAssignPlacement,
  useMovePlacement,
  useCompletePlacement,
  useRemovePlacementPost,
  useSetSectorSenior,
  useUnassignPlacement,
  useUpdateRecon,
} from "@/hooks/use-security-event-stages";
import { useOperationalRatings } from "@/hooks/use-ops-ratings";
import { usePlacementRoles } from "@/hooks/use-placement-roles";
import { usePlacementSections } from "@/hooks/use-placement-sections";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import type {
  ApprovalRemark,
  PersonnelSummarySnapshot,
  PlacementAssignment,
  ReconSectorPost,
  SecurityEvent,
} from "@/entities/security-event";
import { StageError } from "./StageErrors";

const SORT_OPTIONS = [
  "Рекомендуемые",
  "По соответствию",
  "По рейтингу",
  "По алфавиту",
] as const;

// 🔴 `BAND_CODE` СНЯТА (Plane №652). Карта переводила подпись полосы в код
// параметра ручки кадровой базы — а ручка не спрашивается с `[РАС-04]`
// (Plane №428). Отбор по рейтингу идёт по составу и на клиенте (`inBand`),
// кода контракта ему не нужно.

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

/** Что везёт перетаскивание (`[РАС-03]`, Plane №445): кандидат из пула — только
 * сотрудник; строка с поста — ещё и её id, пост, роль и секция, чтобы на новом
 * посту назначение пересоздалось без потерь. */
type DragPayload = {
  employeeId: string;
  assignmentId?: string;
  fromPostId?: string;
  roleCode?: string | null;
  sectionCode?: string | null;
};
/**
 * Перенос, ожидающий обоснования (Plane №762).
 *
 * 🔴 ЗДЕСЬ БЫЛ `origin` — «откуда сняли и как он там стоял», — и он был нужен
 * ради ВОЗВРАТА: перенос выражался парой «снять + назначить», между которыми
 * человек не стоял нигде, и клиент возвращал его сам, если назначение не
 * состоялось (Plane №744, №703). Возвращать больше нечего: сервер переносит
 * одной транзакцией, и отказ не меняет НИЧЕГО. Вместе с `origin` ушли
 * `restoreMove` и его обоснование `RESTORE_REASON` — они стали вторым ответом
 * на вопрос, у которого теперь есть первый.
 *
 * Тип остался, потому что окно обоснования по-прежнему спрашивает «почему
 * усиление»: сервер отвечает 409 `OVER_NEED` и на перенос тоже.
 */
type PendingMove = {
  assignmentId: string;
  /** Куда ведём и с чем — то, что человек попросил. */
  toPostId: string;
  roleCode?: string;
  sectionCode?: string;
};
const DRAG_MIME = "application/x-placement";

/**
 * Довести до конца действие, запущенное из обработчика разметки (Plane №745).
 *
 * `mutateAsync` отклоняется на ЛЮБОЙ ошибке — независимо от того, что
 * `useOpsMutation.onError` уже развёл её по каналам (форма, окно обоснования,
 * тост, `mutation.error`). А обработчики разметки подвешены как
 * `onDrop={(e) => runPlacementAction(onDropPost(e, post.id))}`: `void` отклонение не ловит, он
 * лишь глушит правило «промис без обработки» у линтера. Отклонение уходило в
 * никуда — оверлей ошибки у `next dev` и красная консоль в смоуке.
 *
 * Раньше путь был достижим только через `RATING_DATA_MISSING`, который требует
 * `post.minRating !== null`, — а его не ставят ни сид, ни мок, поэтому дыра
 * спала. С `OVER_NEED` (Plane №414) это будничное событие.
 *
 * 🔴 ГЛОТАЕТСЯ ТОЛЬКО ТО, У ЧЕГО УЖЕ ЕСТЬ КАНАЛ. Отказ API человек видит и без
 * нас, второй показ был бы дублем. Всё остальное — ошибка программы, а не
 * сервера, и она обязана попасть в консоль: смоук смотрит на неё, и молчаливое
 * `catch {}` спрятало бы настоящую поломку экрана вместе с ожидаемым отказом.
 */
function runPlacementAction(action: Promise<unknown>): void {
  void action.catch((error: unknown) => {
    if (error instanceof OpsApiError || error instanceof OpsNetworkError) return;
    console.error("Расстановка: действие не завершилось", error);
  });
}

function readDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw =
      e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (raw === "") return null;
    const parsed = JSON.parse(raw) as Partial<DragPayload>;
    return typeof parsed.employeeId === "string" ? (parsed as DragPayload) : null;
  } catch {
    return null;
  }
}

export function PlacementStage({ event }: { event: SecurityEvent }) {
  // Шаг всегда открывается ДОСКОЙ подбора (задача заказчика Plane №110: «убери
  // с этапа Расстановка эти боксы они не нужны»). Двух подготовительных форм —
  // строк потребности и выделения сил по группам — здесь больше нет: стадии
  // `DEMAND` и `FORCES` проходит сервер расчётом рекогносцировки, и человек их
  // не видит вовсе. Состав мероприятия при этом собирается как собирался — на
  // экране «Сбор сил на ОМ», пока ОМ уже стоит на расстановке.
  return <PlacementBoard event={event} />;
}

// 🔴 `CANDIDATE_PAGE_SIZE` СНЯТА (Plane №652): страницами листался кадровый
// список, а он больше не спрашивается — состав мероприятия приходит целиком.

// ── Расстановка: три колонки прототипа ───────────────────────────────────

const REMARK_LABEL: Record<ApprovalRemark["status"], string> = {
  OPEN: "открыто",
  RESOLVED: "устранено",
  DISAGREED: "не согласен",
};

/**
 * Панель замечаний НАД деревом постов (`[РАС-07]`, Plane №397).
 *
 * Показывается только когда замечания есть: на «Расстановке» они появляются
 * ровно после возврата с согласования, и пустая панель «замечаний нет» была
 * бы шумом на каждом свежем ОМ. Клик по замечанию с постом подсвечивает пост
 * в дереве и открывает его карточку; общее замечание (без поста) — текст, не
 * кнопка: подсвечивать нечего, и кнопка без действия обманывала бы.
 *
 * Ответить на замечание здесь нельзя — намеренно: решение «Устранено / Не
 * согласен» принимается на экране согласования (№386), где виден маршрут и
 * версия документа. Здесь — где чинить, а не что ответить.
 */
function ReturnedRemarksPanel({
  remarks,
  posts,
  onPickPost,
}: {
  remarks: ApprovalRemark[];
  posts: ReconSectorPost[];
  onPickPost: (postId: string) => void;
}) {
  if (remarks.length === 0) return null;
  const postById = new Map(posts.map((post) => [post.id, post]));
  const open = remarks.filter((remark) => remark.status === "OPEN").length;
  return (
    <section
      className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
      aria-label="Замечания согласования"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-amber-200 px-3 py-2 dark:border-amber-900">
        <p className="text-xs font-semibold">Замечания согласования</p>
        <p className="text-[11px] text-muted-foreground">
          {open === 0
            ? `все ${remarks.length} с ответом`
            : `${open} без ответа · ${remarks.length} всего`}{" "}
          · клик по замечанию подсветит пост
        </p>
      </div>
      <ul className="divide-y divide-amber-200 dark:divide-amber-900">
        {remarks.map((remark) => {
          // 🔴 ОТВЯЗАННОЕ ЗАМЕЧАНИЕ — НЕ «ОБЩЕЕ» (Plane №510, найдено ревью
          // №825). При снятии поста замечание отвязывается от него, но имя
          // поста сохраняется в `detachedPost` — согласующий писал про
          // КОНКРЕТНЫЙ пост, и «общее» сказало бы неправду. Два соседних
          // читателя это уже показывают (экран согласующего и дело), а панель
          // старшего объекта — то место, куда смотрит человек, который
          // замечание и чинит, — печатала «общее».
          //
          // `undefined` проверяется наравне с `null`: у строк, заведённых до
          // №386, ключа `postId` нет вовсе — так же считает `ApprovalStage`.
          const unpinned = remark.postId === null || remark.postId === undefined;
          const detached = (remark.detachedPost ?? "").trim();
          const post = unpinned ? null : postById.get(remark.postId!) ?? null;
          const meta = (
            <span className="block text-[11px] text-muted-foreground">
              {remark.author} · {REMARK_LABEL[remark.status]}
              {remark.urgent ? " · срочно" : ""} ·{" "}
              {post === null
                ? unpinned
                  ? detached !== ""
                    ? `${detached} · пост снят с расчёта`
                    : "общее"
                  : "пост другого объекта"
                : `${post.sector} · ${post.post}`}
            </span>
          );
          return (
            <li key={remark.id} className="text-sm">
              {post === null ? (
                <div className="px-3 py-2">
                  <span className="block">{remark.text}</span>
                  {meta}
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-amber-900/40"
                  onClick={() => onPickPost(post.id)}
                >
                  <span className="block">{remark.text}</span>
                  {meta}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlacementBoard({ event }: { event: SecurityEvent }) {
  // Расстановку заказчик закрепил за старшим объекта/мероприятия (Plane №74).
  // Клиент гейтит по КОДУ права; «его ли это мероприятие» знает сервер — он же
  // и отвечает словами, если нет.
  const access = useChainAccess();
  const assign = useAssignPlacement(event.id);
  const unassign = useUnassignPlacement(event.id);
  // Перенос — ОДНА операция сервера (Plane №762), а не пара «снять + назначить».
  const move = useMovePlacement(event.id);
  const complete = useCompletePlacement(event.id);
  // Снятие ЛИШНЕГО поста при недоборе (Plane №259). Заказчик: «если на этапе
  // расстановки к посту привязан человек то нельзя удалять пост, а если он
  // пустой соответственно можно удалять этот пост с расстановки».
  const removePost = useRemovePlacementPost(event.id);
  const [postToRemove, setPostToRemove] = useState<ReconSectorPost | null>(null);
  const updateRecon = useUpdateRecon(event.id);
  const { hasPermission } = useOpsPermissions();
  // Роли наряда — из справочника раздела (Plane №239). Пустой справочник не
  // ломает экран: выбор просто не показывается, и это честно — назначать
  // нечего, пока роли не завели.
  const placementRoles = usePlacementRoles();
  const placementSections = usePlacementSections();
  const canSeeRatings = hasPermission("rating.view_aggregate");
  const ratings = useOperationalRatings({ enabled: canSeeRatings });

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 🔴 `search`, `page` И ЗАПРОС К КАДРОВОЙ БАЗЕ СНЯТЫ (Plane №652). `[РАС-04]`
  // выключил `usePersonnelPage` (`enabled: false`) — с тех пор запрос не
  // уходил никогда, а состояние под него, дребезг на 250 мс и целый блок
  // разметки «Найдено N · страница X» с пагинацией продолжали жить. Здесь
  // остаётся только то, что выполняется: поиск по составу идёт по `query` на
  // клиенте, страниц у состава нет.
  const [sort, setSort] = useState<SortOption>("Рекомендуемые");
  const [band, setBand] = useState<RateOption>("Все");
  // Фильтр по управлению (`[РАС-04]`) — по составу, принятому штабом: список
  // управлений берётся из самих строк, а не из справочника, чтобы не
  // предлагать управление, из которого никого не выделили.
  const [unitFilter, setUnitFilter] = useState("");
  const [comment, setComment] = useState<string | null>(null);
  const setSenior = useSetSectorSenior(event.id);
  /** Объяснение автоподбора живёт ТОЛЬКО в этой сессии экрана: сервер факта
   * «поставлено автоматически» не хранит, и заводить под него поле, которое
   * ни на что не влияет, значило бы врать про происхождение записи. После
   * перезагрузки блок исчезает — отклонение записано в решениях. */
  const [autoReasons, setAutoReasons] = useState<Record<string, string[]>>({});
  /** Чей рейтинг открыт: null — модалка закрыта. Человек, а не флаг: иначе
   * пришлось бы держать имя и подразделение отдельной парой полей. */
  const [ratingBriefFor, setRatingOf] = useState<{
    id: string;
    name: string;
    unit: string;
  } | null>(null);
  // Мероприятие, прошедшее «Сбор сил», расставляет ТОЛЬКО свой состав —
  // людей, которых штаб принял и отдал (Plane №73, шаг «СС-6»). Кадровый
  // список тогда не спрашивается вовсе: предлагать в подборе тех, кого сервер
  // всё равно откажется ставить, значит обещать невозможное.
  const fromRoster = event.forceRoster.length > 0;
  // Кандидаты — ТОЛЬКО состав, принятый штабом (`[РАС-04]`, Plane №428):
  // «поиска по всей базе нет; постороннего назначить нельзя». Без состава
  // колонка показывает пустое состояние `[РАС-05]` со ссылкой в «Сбор сил» —
  // ни списка, ни запроса.
  /** Состав мероприятия в форме кадровой строки подбора. */
  const rosterAll = useMemo(
    () =>
      event.forceRoster.map((member) => ({
        id: member.employeeId,
        name: member.name,
        rankLabel: "",
        unit: member.divisionName,
        statusCode: member.statusCode,
        statusLabel: member.statusLabel,
        visitObjectId: member.visitObjectId ?? null,
      })),
    [event.forceRoster]
  );

  /* Расстановка ведётся ПО ОБЪЕКТУ ПОСЕЩЕНИЯ (Plane №410, `[МД-04]`).
   *
   * До этого шага дерево постов и все счётчики этапа считались по
   * мероприятию целиком: у ОМ с двумя объектами «назначено 5 из 12»
   * складывало разные объекты в одно число, и понять, где именно недобор,
   * было нельзя. Разрез — тот же, что у рекогносцировки: одна реализация на
   * оба этапа (`useVisitObjectScope`).
   *
   * `allPosts` остаётся там, где вопрос ПРО МЕРОПРИЯТИЕ: завершение этапа
   * сервер проверяет по всем постам, и счётчик «свободно» считается от людей,
   * выделенных мероприятию, а не объекту (разделение состава по объектам —
   * задача №390). */
  const allPosts = event.reconSectorPosts;
  const scope = useVisitObjectScope(event, allPosts);
  /**
   * Кандидаты ПОКАЗАННОГО ОБЪЕКТА (Plane №579).
   *
   * 🔴 Штаб раздаёт состав объектам (`[СБС-13]`), и строка состава несёт
   * `visitObjectId` — кому человек отдан. Читать его было некому: подбор
   * показывал ВЕСЬ состав, и на пост объекта Б предлагался и принимался
   * любой, отданный объекту А. Сервер теперь такое назначение отбивает —
   * значит и предлагать его нельзя: подбор, обещающий невозможное, хуже
   * пустого.
   *
   * Нераспределённые (`null`) остаются видны везде: это обычное состояние
   * ОМ, где штаб раздачей не пользовался, и прятать их значило бы опустошить
   * подбор у всех таких мероприятий.
   */
  const rosterPeople = useMemo(() => {
    const shown = scope.visit?.id ?? null;
    if (shown === null) return rosterAll;
    return rosterAll.filter(
      (person) => person.visitObjectId === null || person.visitObjectId === shown
    );
  }, [rosterAll, scope.visit?.id]);
  // Причина возврата берётся у ПОКАЗАННОГО объекта (Plane №491); поля
  // мероприятия остаются ответом только там, где объектов нет вовсе.
  const returnedFrom = scope.visit ?? event;
  const returnedComment =
    returnedFrom.approvalStatus === "RETURNED"
      ? (returnedFrom.approvalComment ?? "")
      : "";
  const posts = scope.rows;
  // Замечания согласования ПОКАЗАННОГО объекта (`[РАС-07]`, Plane №397):
  // согласуют объект, и замечания живут у него (№386/№411). У ОМ без
  // объектов замечаний быть не может — согласование без объекта отбивается.
  const objectRemarks = scope.visit?.approvalRemarks ?? [];
  const remarksOfPost = (postId: string) =>
    objectRemarks.filter((remark) => remark.postId === postId);
  const openRemarksOf = (postId: string) =>
    remarksOfPost(postId).filter((remark) => remark.status === "OPEN").length;
  // Клик по замечанию ПОДСВЕЧИВАЕТ пост: выбирает его (тот же путь, что клик
  // в дереве) и прокручивает дерево к нему. Прокрутка плавная, но уважает
  // `prefers-reduced-motion` — иначе человек с укачиванием получал бы рывок.
  const focusPost = (postId: string) => {
    setSelectedPostId(postId);
    setComment(null);
    const node = document.getElementById(`placement-post-${postId}`);
    if (node === null) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  };
  const selected = posts.find((p) => p.id === selectedPostId) ?? posts[0] ?? null;
  const assignmentsOf = (postId: string): PlacementAssignment[] =>
    event.placementAssignments.filter((a) => a.postId === postId);

  /** Рейтинг сотрудника по КАДРОВОМУ id (Plane №96).
   *
   * Сверка идёт по `personnelId`, а не по `employeeId`: последний — код
   * участника рейтинга (`employee-1`, исторические коды сида), и сравнение с
   * кадровым id не совпадало НИКОГДА. Отсюда и симптом: бейдж не появлялся,
   * фильтр «Рейтинг» отбирал пустоту, требование поста не проверялось. На
   * моке коды совпадали с кадровыми — мок был зелен, живой стек молчал.
   *
   * Участник без связи (`personnelId === null`) не совпадает ни с кем: `null`
   * здесь значит «не знаем, чей это рейтинг», и молчание честнее подстановки.
   */
  const ratingOf = (employeeId: string): number | null =>
    ratings.data?.results.find((r) => r.personnelId === employeeId)
      ?.aggregateRating ?? null;

  /** Рейтинг СТРОКИ подбора (Plane №67, шаг РЙ-5).
   *
   * Кадровая ручка сама отдаёт `aggregateRating` — значение приходит с тем же
   * ответом, в котором пришёл человек, и доска больше ничего не вычисляет.
   *
   * `"aggregateRating" in person` — не придирка к стилю: ОТСУТСТВИЕ поля и
   * `null` тут разные ответы. Поля нет — у смотрящего нет права видеть балл;
   * `null` — балл видеть можно, но судить не по чему (нет оценок, мало оценок,
   * функция выключена). Сложить их через `??` значило бы нарисовать «нет
   * данных» тому, кому просто не показывают, — то есть соврать о сотруднике.
   *
   * Строки СОСТАВА мероприятия приходят не из кадровой ручки, а из карточки
   * ОМ, и своего балла не несут — для них рейтинг по-прежнему берётся из
   * сводки по `personnelId`. Это тоже сервер, просто другая его ручка. */
  const ratingOfRow = (person: PersonnelSummarySnapshot): number | null =>
    "aggregateRating" in person
      ? (person.aggregateRating ?? null)
      : ratingOf(person.id);

  const allocated = event.forceRequests.reduce(
    (sum, request) => sum + request.allocatedCount,
    0
  );
  // Назначено — НА ВИДИМЫХ ПОСТАХ: рядом стоит «требуется» того же объекта, и
  // два числа из разных областей читались бы как одно.
  const visiblePostIds = new Set(posts.map((post) => post.id));
  const assignedCount = event.placementAssignments.filter((a) =>
    visiblePostIds.has(a.postId)
  ).length;
  const assignedInEvent = event.placementAssignments.length;
  const totalNeed = posts.reduce((sum, post) => sum + post.need, 0);
  const unfilled = posts.filter((p) => assignmentsOf(p.id).length < p.need).length;
  const conflicts = event.placementAssignments.filter(
    (a) => a.ratingOverrideReason !== null && visiblePostIds.has(a.postId)
  ).length;
  // 🔴 ВТОРОЙ ОБХОД СЧИТАЕТСЯ ТАК ЖЕ, КАК ПЕРВЫЙ (Plane №746). Сервер требует
  // обоснование усиления поста сверх расчёта (`needOverrideReason`) и хранит
  // его — а показывал его НИКТО: грепом по фронту поле встречалось только в
  // типах и в моке. Оператор набирал объяснение, и оно исчезало; заявленная
  // цель правки №414 — «чтобы усиление осталось объяснимым в реестре» — не
  // выполнялась вовсе. У соседнего обхода (по рейтингу) есть и бейдж в
  // строке, и счёт в предупреждении; у этого теперь тоже.
  const overNeed = event.placementAssignments.filter(
    (a) =>
      (a.needOverrideReason ?? null) !== null && visiblePostIds.has(a.postId)
  ).length;
  // «Свободно» — про МЕРОПРИЯТИЕ: люди выделены ему, а не объекту, и вычитать
  // из общего состава назначения одного объекта значило бы показать человека
  // свободным на одном экране и занятым на другом.
  const free = Math.max(0, allocated - assignedInEvent);
  /** Что мешает завершить этап — словами и в одном месте.
   *
   * Порядок не случаен: недобор запирает завершение (сервер отбивает
   * `PLACEMENT_INCOMPLETE`), обходы рейтинга — нет, их просто надо видеть.
   * Пусто — значит завершать можно, и молчание здесь честнее «всё хорошо».
   */
  const placementWarning: string | null = (() => {
    const parts: string[] = [];
    if (posts.length > 0 && unfilled > 0)
      // Недобор БЛОКИРУЕТ не сам переход, а только его молчаливый вариант
      // (`[РАС-06]`, Plane №396): «Завершить» останется активной и попросит
      // подтверждения с причиной — этот текст только предупреждает заранее.
      parts.push(
        `не укомплектовано постов: ${unfilled} — завершение спросит подтверждения`
      );
    if (conflicts > 0)
      parts.push(`назначений с обходом предупреждения по рейтингу: ${conflicts}`);
    if (overNeed > 0)
      parts.push(`постов усилено сверх расчёта: ${overNeed}`);
    return parts.length === 0 ? null : parts.join("; ");
  })();

  /** Смена поста — У САМОГО ПОСТА, как в эталоне («Сектор A · смена
   * 07:00–15:00»); её задаёт старший наряда на рекогносцировке (Plane №123).
   *
   * Строки ПОТРЕБНОСТИ остаются запасным источником — и только им. По ним
   * смену вводили до того, как бокс потребности сняли (Plane №110); у
   * мероприятий, заведённых тогда, она лежит там и больше нигде, и перестать
   * её читать значило бы потерять уже введённое. Новые мероприятия строк
   * потребности с заполненной сменой не имеют вовсе — сервер собирает их сам
   * и оставляет смену пустой.
   *
   * Совпадение в запасном источнике ищется по сектору и задаче — по ним
   * строка потребности и заводилась. Совпадений нет — смена не показывается
   * вовсе, а не рисуется прочерком: прочерк читается как «смена не
   * назначена», а это другое утверждение.
   */
  function shiftOfPost(post: ReconSectorPost): string {
    const own = (post.shift ?? "").trim();
    if (own !== "") return own;
    const shifts = event.demandRows
      .filter(
        (row) =>
          row.sector.trim() === post.sector.trim() &&
          row.task.trim() === post.task.trim() &&
          row.shift.trim() !== ""
      )
      .map((row) => row.shift.trim());
    return [...new Set(shifts)].join(", ");
  }

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
  // «свободен / на посту K» (`[РАС-04]`): пост занятого — словами, а не
  // одним признаком занятости; ищется по ВСЕМ постам мероприятия, потому что
  // человек бывает занят на соседнем объекте.
  // 🔴 ВСЕ ПОСТЫ ЧЕЛОВЕКА, А НЕ ПОСЛЕДНИЙ (Plane №654). Здесь стоял
  // `new Map(assignments.map(a => [a.employeeId, a.postId]))`: у сотрудника,
  // назначенного на два поста (комментарий выше это прямо и предполагает —
  // «занят на соседнем объекте»), карта хранила только последнюю запись, и
  // строка сообщала про один пост, скрывая второй.
  const postsOfEmployee = new Map<string, string[]>();
  for (const a of event.placementAssignments) {
    postsOfEmployee.set(a.employeeId, [
      ...(postsOfEmployee.get(a.employeeId) ?? []),
      a.postId,
    ]);
  }
  const postTitleById = new Map(
    event.reconSectorPosts.map((post) => [post.id, `${post.sector} · ${post.post}`])
  );
  /** «на посту …» или «на постах …, …» (Plane №654): два назначения одного
   *  человека называются оба — умолчать о втором значит показать расстановку
   *  неполной ровно там, где её и проверяют. */
  function postsLabelOf(employeeId: string): string {
    const titles = (postsOfEmployee.get(employeeId) ?? []).map(
      (postId) => postTitleById.get(postId) ?? "—"
    );
    if (titles.length === 0) return "на посту —";
    return titles.length === 1
      ? `на посту ${titles[0]}`
      : `на постах ${titles.join(", ")}`;
  }
  const unitOptions = Array.from(
    new Set(rosterPeople.map((person) => person.unit).filter((unit) => unit !== ""))
  ).sort((a, b) => a.localeCompare(b, "ru"));
  /** Действующий фильтр управления (Plane №650).
   *
   * 🔴 `unitFilter` СВЕРЯЕТСЯ СО СПИСКОМ ВАРИАНТОВ. Варианты считаются по
   * ЖИВОМУ составу: штаб снял последнего человека выбранного управления,
   * карточка перезапросила данные — и выбранного значения в списке больше
   * нет. `<select>` без подходящего `<option>` рисует первый, то есть «Все
   * управления», а отбор продолжал резать по исчезнувшему значению: экран
   * показывал пустой список и все органы управления при этом говорили, что
   * фильтра нет.
   *
   * Значение ВЫВОДИТСЯ, а не чинится эффектом: эффект дал бы лишний кадр с
   * пустым списком, а вывод не даёт неверного состояния ни на один кадр.
   */
  const activeUnitFilter = unitOptions.includes(unitFilter) ? unitFilter : "";
  /** Фильтры, которые ДЕЙСТВИТЕЛЬНО стоят — словами (Plane №649). Пустой
   *  список кандидатов обязан назвать причину, иначе человек сбрасывает не
   *  тот отбор. */
  const activeFilters = [
    query.trim() === "" ? null : `поиск «${query.trim()}»`,
    activeUnitFilter === "" ? null : `управление «${activeUnitFilter}»`,
    band === "Все" ? null : `рейтинг «${band}»`,
  ].filter((part): part is string => part !== null);
  // Запрошено штабом — для пустого состояния (`[РАС-05]`).
  const requestedTotal = event.forceRequests.reduce(
    (sum, request) => sum + request.requestedCount,
    0
  );

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
    const rating = ratingOfRow(person);
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
    const rating = ratingOfRow(person);
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

  /** Кандидаты. Поиск, листание, ОТБОР ПО РЕЙТИНГУ и РАНЖИРОВАНИЕ по баллу
   * считает СЕРВЕР — по всей базе, а не по показанной странице (Plane №67).
   *
   * Клиенту осталось ровно то, чего сервер знать не может:
   * — сортировка «по соответствию»: соответствие считается против ВЫБРАННОГО
   *   поста, о котором кадровая ручка не знает;
   * — «рекомендуемые»: тот же расчёт плюс занятость на этом мероприятии;
   * — всё вместе для СОСТАВА мероприятия: он приходит карточкой ОМ целиком,
   *   десятками строк, и круг к серверу за отбором в них ничего бы не уточнил.
   *
   * Отбор по полосе применяется здесь ТОЛЬКО к составу. Для кадровой базы он
   * уже сделан сервером, и повторять его на клиенте нельзя: строка без права
   * на балл не несёт поля вовсе, и повторный отбор выкинул бы всех. */
  const candidates = useMemo(() => {
    // Поиск по составу идёт НА КЛИЕНТЕ: состав — десятки строк, они уже на
    // руках, и круг к серверу за подстрокой в них ничего бы не уточнил.
    const list = rosterPeople
      .filter(
        (person) =>
          person.name.toLowerCase().includes(query.trim().toLowerCase()) &&
          (activeUnitFilter === "" || person.unit === activeUnitFilter)
      )
      .filter((person) => inBand(ratingOfRow(person)));
    const withFit = list.map((person) => ({
      person,
      fit: fitOf(person),
      rating: ratingOfRow(person),
      busy: assignedIds.has(person.id),
      warn: warnOf(person),
    }));
    switch (sort) {
      case "По рейтингу":
        // Ветка «оставить порядок сервера» снята вместе с кадровым списком
        // (Plane №652): сортируется состав, он весь на руках, и порядка
        // сервера у него нет.
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
    rosterPeople,
    query,
    activeUnitFilter,
    sort,
    band,
    selected,
    ratings.data,
    assignedIds.size,
  ]);

  const { toast } = useToast();

  // ── Перетаскивание и окно «Роль и секция…» (`[РАС-03]`, Plane №445) ──────
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlacementAssignment | null>(null);
  /** Перенос, чьё назначение ждёт ответа в окне обоснования (Plane №744).
   * Человек уже снят с `fromPostId` — здесь лежит всё, чем его вернуть, И
   * куда его вести, если обоснование дадут. */

  function payloadOfAssignment(assignment: PlacementAssignment): DragPayload {
    return {
      employeeId: assignment.employeeId,
      assignmentId: assignment.id,
      fromPostId: assignment.postId,
      roleCode: assignment.roleCode,
      sectionCode: assignment.sectionCode,
    };
  }
  function startDrag(e: React.DragEvent, payload: DragPayload): void {
    const raw = JSON.stringify(payload);
    e.dataTransfer.setData(DRAG_MIME, raw);
    // Второй тип — для браузеров, которые свой MIME при переносе теряют.
    e.dataTransfer.setData("text/plain", raw);
    e.dataTransfer.effectAllowed = "move";
  }
  function dragOverPost(e: React.DragEvent, postId: string): void {
    if (!access.can(PLACEMENT_MANAGE)) return;
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(DRAG_MIME) && !types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== postId) setDropTarget(postId);
  }
  function leaveDrop(postId: string): void {
    setDropTarget((current) => (current === postId ? null : current));
  }
  async function onDropPost(e: React.DragEvent, postId: string): Promise<void> {
    e.preventDefault();
    setDropTarget(null);
    const payload = readDragPayload(e);
    if (payload === null || !access.can(PLACEMENT_MANAGE)) return;
    await placePayload(postId, payload);
  }
  /** Кандидат из пула — назначение; строка с другого поста — снятие и
   * назначение заново ПО ОЧЕРЕДИ, с ролью и секцией (Plane №242: всё, что не
   * передано, теряется молча). */
  async function placePayload(postId: string, payload: DragPayload): Promise<void> {
    const { assignmentId, fromPostId } = payload;
    if (assignmentId === undefined) {
      assign.mutate({ postId, employeeId: payload.employeeId });
      return;
    }
    if (fromPostId === postId) return;
    if (fromPostId === undefined) {
      // Строка с поста, у которой поста нет: вернуть человека будет НЕКУДА, а
      // перенос без возврата — ровно то, что чинит №744. Такой нагрузки
      // `payloadOfAssignment` не строит; появится — человек это увидит, а не
      // потеряет сотрудника молча.
      toast({
        variant: "destructive",
        description:
          "Не удалось определить пост, с которого переносят. Обновите страницу и повторите.",
      });
      return;
    }
    await movePerson({
      assignmentId,
      toPostId: postId,
      // Перетаскивание роль и секцию не меняет — они едут неизменными.
      ...(payload.roleCode ? { roleCode: payload.roleCode } : {}),
      ...(payload.sectionCode ? { sectionCode: payload.sectionCode } : {}),
    });
  }

  /**
   * ПЕРЕНОС — ОДИН ЗАПРОС (Plane №762).
   *
   * 🔴 ЗДЕСЬ БЫЛА ПАРА «снять + назначить» и весь механизм возврата вокруг
   * неё. Между двумя запросами человек не был назначен никуда; №744 научила
   * клиент возвращать его на прежний пост, если назначение не состоялось, —
   * но возврат делал КЛИЕНТ, и щель оставалась открытой на закрытую вкладку,
   * перезагрузку и обрыв связи. Восстанавливать в этих случаях некому, а
   * заметить потерю можно было только по несходящемуся числу «назначено» в
   * реестре — на этапе, после которого расстановку подписывают и печатают.
   *
   * Сервер переносит одной транзакцией, поэтому отказ не меняет ничего:
   * возвращать нечего, и `restoreMove` снят вместе с `origin` в `PendingMove`.
   *
   * Обоснование усиления никуда не делось: сервер отвечает 409 `OVER_NEED` и
   * на перенос. Повтор с обоснованием делает `move.confirmOverride` — он
   * повторяет ТО ЖЕ тело, и для переноса это ровно то, что нужно: тело
   * самодостаточно (назначение в пути, пост и роль с секцией в теле), в
   * отличие от прежней пары, где повторять пришлось бы только вторую половину.
   */
  async function movePerson(pending: PendingMove): Promise<void> {
    await move.mutateAsync({
      assignmentId: pending.assignmentId,
      postId: pending.toPostId,
      ...(pending.roleCode ? { roleCode: pending.roleCode } : {}),
      ...(pending.sectionCode ? { sectionCode: pending.sectionCode } : {}),
    });
  }

  async function saveEdit(next: {
    roleCode: string;
    sectionCode: string;
    postId: string;
  }): Promise<void> {
    if (editing === null) return;
    const changed =
      next.roleCode !== (editing.roleCode ?? "") ||
      next.sectionCode !== (editing.sectionCode ?? "") ||
      next.postId !== editing.postId;
    if (changed) {
      // Тот же перенос, что у перетаскивания, и с №762 — та же одна операция.
      // Окно правки меняет пост, роль и секцию ЗАОДНО, и раньше это требовало
      // описывать исток отдельно от цели (Plane №703): возврат обязан был
      // вернуть человека таким, каким он был ДО правки, иначе половина
      // отклонённой правки применялась бы молча. Возврата больше нет —
      // отклонённая правка не применяется вовсе, целиком, на сервере.
      //
      // ПОСТ, РАВНЫЙ ТЕКУЩЕМУ, — законный случай: смена одной роли или секции
      // это тот же перенос, и сервер не считает его усилением, потому что
      // исключает переносимого из счёта поста-приёмника.
      await movePerson({
        assignmentId: editing.id,
        toPostId: next.postId,
        ...(next.roleCode === "" ? {} : { roleCode: next.roleCode }),
        ...(next.sectionCode === "" ? {} : { sectionCode: next.sectionCode }),
      });
    }
    setEditing(null);
  }

  /** Автоподбор: реальные назначения свободных кандидатов на недобранные посты. */
  function autoFill(): void {
    const taken = new Set(assignedIds);
    const reasons: Record<string, string[]> = { ...autoReasons };
    for (const post of posts) {
      let missing = post.need - assignmentsOf(post.id).length;
      for (const candidate of candidates) {
        if (missing <= 0) break;
        if (taken.has(candidate.person.id)) continue;
        taken.add(candidate.person.id);
        missing -= 1;
        reasons[`${post.id}:${candidate.person.id}`] = autoReasonsFor(
          candidate,
          post
        );
        assign.mutate({ postId: post.id, employeeId: candidate.person.id });
      }
    }
    setAutoReasons(reasons);
  }

  /** Почему автоподбор выбрал ЭТОГО человека на ЭТОТ пост.
   *
   * Причины — те же числа, по которым он и выбирал: другой список означал бы
   * объяснение задним числом, не совпадающее с решением. */
  function autoReasonsFor(
    candidate: {
      person: PersonnelSummarySnapshot;
      fit: number;
      rating: number | null;
    },
    post: ReconSectorPost
  ): string[] {
    const list = [`совпадение ${candidate.fit}%`];
    // Статус попадает в причины ТОЛЬКО когда он в плюс. «✓ статус дня:
    // отпуск» читалось бы как довод за человека, хотя это довод против; сам
    // статус и так виден бейджем рядом.
    if (candidate.person.statusLabel === null) list.push("в строю в день ОМ");
    if (post.minRating === null) list.push("пост не требует рейтинга");
    else if (candidate.rating !== null && candidate.rating >= post.minRating)
      list.push(`рейтинг ${candidate.rating} не ниже ${post.minRating}`);
    return list;
  }

  return (
    // Область с именем вместо снятого заголовка — см. ReconStage (Plane №70).
    <Card role="region" aria-label="Расстановка сил">
      {/* Имени этапа здесь НЕТ намеренно (Plane №70): оно стоит НАД
          карточкой, в шапке страницы («Этап N из 5 · …»). Второй заголовок
          читался бы как вложенный раздел, которого нет, и отнимал строку у
          содержимого. Подзаголовки внутри карточки остаются — они называют
          блоки, а не этап. */}
      <CardContent className="space-y-4">
        {/* Причина недоступности — СЛОВАМИ и ОДИН РАЗ НА ШАГ (Plane №801).
            Действий у доски много (автоподбор, назначение, снятие, старший
            поста, роль и секция), и повтор одной строки у каждого превращает
            экран в частокол — именно это и вышло, когда обёртки `RightGate`
            стали печатать причину каждая: две из них стоят ВНУТРИ цикла по
            назначенным, то есть на шести назначенных строк было двенадцать.
            Теперь блок причин один, а кнопки ссылаются на него
            `aria-describedby`. Подсказки `title` с причиной здесь нет вовсе:
            на выключенной кнопке она не показывается НИ ПРИ КАКОМ поведении
            браузера. */}
        <AccessHints
          reasons={[
            access.reason(PLACEMENT_MANAGE),
            access.reason(EVENT_MANAGE),
          ]}
        >
        {/* 🔴 ПРИЧИНА ВОЗВРАТА — ПОКАЗАННОГО ОБЪЕКТА, А НЕ МЕРОПРИЯТИЯ
            (Plane №491). Баннер читал поля уровня ОМ, а с №411 у объекта
            посещения свои `approvalStatus`/`approvalComment` — и сам экран
            давно живёт в области объекта. На ОМ с двумя возвращёнными
            объектами оператор, переключившийся на объект А, читал причину
            возврата объекта Б и НЕ ИМЕЛ СПОСОБА увидеть свою: причина
            мероприятия берётся у одного из возвращённых, и какого именно —
            зависит от порядка объектов, а не от времени возврата.

            Объекта нет (ОМ без объектов посещения) — отвечают поля
            мероприятия: у него они действительно свои. */}
        {returnedComment !== "" && (
          <Alert variant="destructive">
            <AlertDescription>
              Возвращено с согласования: {returnedComment}
            </AlertDescription>
          </Alert>
        )}
        <ReturnedRemarksPanel
          remarks={objectRemarks}
          posts={posts}
          onPickPost={focusPost}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <div className="flex flex-wrap gap-4 text-xs">
            <Kpi label="постов" value={posts.length} />
            <Kpi label="требуется" value={totalNeed} />
            <Kpi label="назначено" value={assignedCount} />
            <Kpi label="свободно" value={free} />
            <Kpi label="незаполнено" value={unfilled} tone={unfilled > 0 ? "warn" : undefined} />
            <Kpi label="конфликтов" value={conflicts} tone={conflicts > 0 ? "bad" : undefined} />
            {/* Плитка появляется, ТОЛЬКО когда усиление есть (Plane №746):
                вечный ноль в ряду из шести чисел читается как шум, а не как
                факт, и ряд у этого экрана и без того плотный. */}
            {overNeed > 0 && (
              <Kpi label="сверх расчёта" value={overNeed} tone="warn" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <RightGate reason={access.reason(PLACEMENT_MANAGE)}>
              {(describedBy) => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    assign.isPending || unfilled === 0 || !access.can(PLACEMENT_MANAGE)
                  }
                  aria-disabled={!access.can(PLACEMENT_MANAGE)}
                  aria-describedby={describedBy}
                  onClick={autoFill}
                >
                  Распределить автоматически
                </Button>
              )}
            </RightGate>
            <RightGate reason={access.reason(EVENT_MANAGE)}>
              {(describedBy) => (
                <Button
                  type="button"
                  size="sm"
                  disabled={complete.isPending || !access.can(EVENT_MANAGE)}
                  aria-describedby={describedBy}
                  onClick={() =>
                    complete.mutate({ visitObjectId: scope.visit?.id })
                  }
                >
                  {complete.isPending ? "Завершение…" : "Завершить расстановку"}
                </Button>
              )}
            </RightGate>
          </div>
        </div>

        {/* Предупреждение этапа из прототипа: одной строкой то, что мешает
            завершить расстановку. Считается по тем же числам, что и сводка
            выше, — второй счёт разошёлся бы с ней на глазах. Нечего сказать —
            плашки НЕТ: постоянная плашка перестаёт читаться. */}
        {placementWarning !== null && (
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
            <span aria-hidden className="font-extrabold">
              ℹ
            </span>
            <span>{placementWarning}</span>
          </div>
        )}

        <VisitObjectPicker event={event} scope={scope} allRows={allPosts} />

        {posts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {scope.shown === UNASSIGNED_VISIT
              ? "Нераспределённых постов нет."
              : scope.visit === null
                ? "Постов нет — расчёт формируется на этапе рекогносцировки."
                : `У объекта «${scope.visit.objectName}» постов нет — расчёт формируется на этапе рекогносцировки.`}
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(200px,240px)_1fr_minmax(240px,300px)]">
            {/* Имя ОБЛАСТИ, а не только видимая подпись: подпись теперь
                называет объект («Посты объекта «Мейрам»»), и указывать на
                дерево текстом стало нельзя — проба ловила его по строке
                «Объекты и посты» (Plane №410). */}
            <aside className="rounded-md border" aria-label="Дерево постов">
              <div className="border-b px-3 py-2">
                <p className="text-xs font-semibold">
                  {scope.visit === null
                    ? "Объекты и посты"
                    : `Посты объекта «${scope.visit.objectName}»`}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {posts.length} постов · назначено {assignedCount} из {totalNeed}
                </p>
              </div>
              <div className="max-h-[420px] overflow-y-auto p-2">
                {sectors.map((sector) => {
                  // Счётчик сектора — как в прототипе: сколько людей уже стоит
                  // из скольких нужно. Без него сектор молчал о своей
                  // готовности, и её приходилось складывать глазами по постам.
                  const sectorNeed = sector.posts.reduce(
                    (sum, post) => sum + post.need,
                    0
                  );
                  const sectorAssigned = sector.posts.reduce(
                    (sum, post) => sum + assignmentsOf(post.id).length,
                    0
                  );
                  const sectorFull = sectorAssigned >= sectorNeed;
                  // Старший — на ПОСТ (`[РАС-03]`, Plane №445): в секторе их
                  // столько, сколько постов со старшим.
                  //
                  // 🔴 ИМЯ ИДЁТ С ПОСТОМ (Plane №705). Строка перечисляла одни
                  // имена под подписью «Старший:» в единственном числе — у
                  // сектора с двумя постами выходило, что старший сектора один,
                  // а имён у него два, и какой пост чьё — неизвестно. Пара
                  // «имя (пост)» отвечает на оба вопроса разом.
                  const sectorSeniors = sector.posts.flatMap((post) =>
                    assignmentsOf(post.id)
                      .filter((a) => a.isSectorSenior)
                      .map((a) => `${a.employeeName} (${post.post})`)
                  );
                  return (
                  <div key={sector.name} className="mb-2">
                    <p className="flex items-center justify-between gap-2 px-1 py-1 text-xs font-semibold">
                      <span className="min-w-0 truncate">{sector.name}</span>
                      <span
                        className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                          sectorFull
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {sectorAssigned}/{sectorNeed}
                      </span>
                    </p>
                    {/* Старшие постов названы в дереве: спрашивать доклад
                        будут с них, и знать это надо ДО того, как открыт
                        конкретный пост. */}
                    <p className="px-1 pb-1 text-[10px] text-muted-foreground">
                      {sectorSeniors.length > 1 ? "Старшие постов: " : "Старший поста: "}
                      {sectorSeniors.length === 0
                        ? "не назначен"
                        : sectorSeniors.join(", ")}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {sector.posts.map((post) => {
                        const placed = assignmentsOf(post.id);
                        const count = placed.length;
                        const full = count >= post.need;
                        return (
                          <li
                            key={post.id}
                            data-drop-post={post.id}
                            // Пост в дереве — цель перетаскивания (`[РАС-03]`):
                            // кандидата из пула или строку с другого поста.
                            onDragOver={(e) => dragOverPost(e, post.id)}
                            onDragLeave={() => leaveDrop(post.id)}
                            onDrop={(e) => void onDropPost(e, post.id)}
                            className={`flex items-start gap-1 rounded-md ${
                              dropTarget === post.id ? "bg-accent ring-2 ring-primary" : ""
                            }`}
                          >
                            <button
                              type="button"
                              id={`placement-post-${post.id}`}
                              aria-current={selected?.id === post.id}
                              onClick={() => {
                                setSelectedPostId(post.id);
                                setComment(null);
                              }}
                              className={`flex w-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                selected?.id === post.id ? "bg-accent" : "hover:bg-muted"
                              }`}
                            >
                              {/* Открытое замечание к посту видно В ДЕРЕВЕ
                                  (`[РАС-07]`): иначе «где чинить» читалось бы
                                  только по одному посту за раз. */}
                              {openRemarksOf(post.id) > 0 && (
                                <span
                                  className="inline-flex shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800"
                                  title={`Замечаний без ответа: ${openRemarksOf(post.id)}`}
                                  aria-label={`Замечаний без ответа: ${openRemarksOf(post.id)}`}
                                >
                                  !{openRemarksOf(post.id)}
                                </span>
                              )}
                              <span
                                aria-hidden
                                className={`h-2 w-2 shrink-0 rounded-full ${full ? "bg-green-500" : "bg-amber-500"}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{post.post}</span>
                                {shiftOfPost(post) !== "" && (
                                  <span className="block truncate text-[10px] text-muted-foreground">
                                    {shiftOfPost(post)}
                                  </span>
                                )}
                                {/* Кто на посту — прямо в дереве, как в
                                    прототипе: иначе «кто где стоит» читается
                                    только по одному посту за раз, а расстановку
                                    смотрят целиком. Больше двух имён —
                                    остаток числом, строка не растёт. */}
                                {count > 0 && (
                                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                    {placed
                                      .slice(0, 2)
                                      .map((a) => a.employeeName)
                                      .join(", ")}
                                    {count > 2 ? ` и ещё ${count - 2}` : ""}
                                  </span>
                                )}
                              </span>
                              <span
                                className={`shrink-0 self-start tabular-nums ${full ? "text-muted-foreground" : "text-amber-700"}`}
                              >
                                {count}/{post.need}
                              </span>
                            </button>
                            {/* СНЯТИЕ ЛИШНЕГО ПОСТА (Plane №259). Кнопка
                                показывается только тем, кто ведёт расстановку,
                                и только у ПУСТОГО поста: у занятого корзина НЕ
                                РЕНДЕРИТСЯ вовсе (`[РАС-02]`, Plane №445) — до
                                этого она стояла выключенной с подсказкой, и
                                занятый пост выглядел «почти удаляемым». Сервер
                                правило всё равно проверяет: кнопка — подсказка,
                                а не защита. */}
                            {access.can(PLACEMENT_MANAGE) && count === 0 && (
                              <button
                                type="button"
                                aria-label={`Снять пост ${post.post}`}
                                title="Снять пост с расстановки"
                                disabled={removePost.isPending}
                                onClick={() => setPostToRemove(post)}
                                className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  );
                })}
              </div>
            </aside>

            {selected !== null && (
              <section className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{selected.post}</p>
                    <p className="text-xs text-muted-foreground">
                      {selected.sector}
                      {shiftOfPost(selected) === ""
                        ? ""
                        : ` · ${shiftOfPost(selected)}`}
                    </p>
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
                {remarksOfPost(selected.id).length > 0 && (
                  <div
                    className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/40"
                    data-slot="post-remarks"
                  >
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                      Замечания по посту
                    </p>
                    <ul className="flex flex-col gap-1">
                      {remarksOfPost(selected.id).map((remark) => (
                        <li key={remark.id} className="text-xs">
                          <span className="font-semibold">{remark.text}</span>{" "}
                          <span className="text-muted-foreground">
                            — {remark.author} · {REMARK_LABEL[remark.status]}
                            {remark.urgent ? " · срочно" : ""}
                          </span>
                          {remark.response !== "" && (
                            <span className="block text-muted-foreground">
                              Ответ: {remark.response}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* СЛОТЫ ПОСТА по `[РАС-03]` (Plane №445): строка на каждого
                    назначенного и пустой слот «+ Назначить» на каждое свободное
                    место. Селектов «Роль / Секция / Переместить» в строке
                    больше нет: перемещение — перетаскиванием строки на пост в
                    дереве, роль и секция — в окне «Роль и секция…», где есть и
                    смена поста с клавиатуры (WCAG 2.2: у перетаскивания обязана
                    быть альтернатива одним указателем). Смена роли, секции и
                    поста по-прежнему = снятие и назначение заново, по очереди
                    (Plane №239/№242): своей операции «сменить» у бэка нет. */}
                <ul className="mb-2 flex flex-col gap-1.5" aria-label="Слоты поста">
                  {assignmentsOf(selected.id).map((assignment) => (
                    <li
                      key={assignment.id}
                      // Строка строго ОДНОГО назначения (Plane №415): якорь для
                      // проб — id назначения, а не имя (оно не единственно).
                      data-testid={`placement-assignment-${assignment.id}`}
                      draggable={access.can(PLACEMENT_MANAGE)}
                      onDragStart={(e) => startDrag(e, payloadOfAssignment(assignment))}
                      onDragEnd={() => setDropTarget(null)}
                      className="flex flex-wrap items-start gap-2 rounded-md border p-2 text-sm"
                    >
                      <GripVertical
                        aria-hidden="true"
                        className="mt-2 h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
                      />
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
                            <button
                              type="button"
                              // aria-label, а не title: у кнопки есть текст
                              // (само число), и title в доступное имя не
                              // попадает — кнопка звалась бы «8,4».
                              aria-label={`Открыть краткую информацию о рейтинге: ${assignment.employeeName}`}
                              title="Открыть краткую информацию о рейтинге"
                              className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums hover:brightness-95"
                              onClick={() =>
                                setRatingOf({
                                  id: assignment.employeeId,
                                  name: assignment.employeeName,
                                  unit: assignment.divisionName,
                                })
                              }
                            >
                              {ratingOf(assignment.employeeId)}
                            </button>
                          )}
                          {/* Бейдж зовётся ТАК ЖЕ, как переключатель в этой же
                              строке (Plane №705): он читался «Старший сектора»,
                              и у сектора с двумя постами обе строки заявляли
                              себя старшим сектора — должность, которой после
                              перехода на старших по постам не существует. */}
                          {assignment.isSectorSenior && (
                            <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-foreground">
                              Старший поста
                            </span>
                          )}
                          {assignment.ratingOverrideReason !== null && (
                            <span className="text-xs text-amber-700">
                              обход: {assignment.ratingOverrideReason}
                            </span>
                          )}
                          {/* Усиление поста сверх расчёта (Plane №746): та же
                              форма, что у обхода рейтинга рядом, — обоснование
                              стоит В СТРОКЕ, где видно, к кому оно относится.
                              Слово другое, потому что и обход другой: «сверх
                              расчёта» — про число людей на посту, «обход» —
                              про требование к рейтингу. */}
                          {(assignment.needOverrideReason ?? null) !== null && (
                            <span
                              className="text-xs text-amber-700"
                              data-slot="need-override-reason"
                            >
                              сверх расчёта: {assignment.needOverrideReason}
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
                          {/* Роль ВИДНА В СТРОКЕ, а не только в выпадающем
                              списке справа: по ней заполняется бланк, и
                              «кем человек идёт» должно читаться там же, где
                              «откуда он и свободен ли» (Plane №239). */}
                          {assignment.roleCode !== null && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
                              {placementRoles.data?.find(
                                (role) => role.code === assignment.roleCode
                              )?.label ?? assignment.roleCode}
                            </span>
                          )}
                          {/* Секция — рядом с ролью и в том же виде (Plane
                              №242): «кем» и «где» отвечают на один вопрос
                              вместе, и разносить их по разным местам строки
                              значило бы заставить читать дважды. Подпись
                              справочника длинная — в бейдже она обрезается,
                              полная остаётся в подсказке. */}
                          {assignment.sectionCode !== null && (
                            <span
                              className="max-w-[180px] truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
                              title={
                                placementSections.data?.find(
                                  (section) => section.code === assignment.sectionCode
                                )?.label ?? assignment.sectionCode
                              }
                            >
                              {placementSections.data?.find(
                                (section) => section.code === assignment.sectionCode
                              )?.label ?? assignment.sectionCode}
                            </span>
                          )}
                        </span>
                        {(
                          autoReasons[
                            `${assignment.postId}:${assignment.employeeId}`
                          ] ?? []
                        ).length > 0 && (
                          <span className="mt-1 block rounded-md border bg-muted/40 p-1.5">
                            <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              Рекомендация автоподбора
                            </span>
                            <span className="mt-1 flex flex-wrap gap-1">
                              {autoReasons[
                                `${assignment.postId}:${assignment.employeeId}`
                              ].map((reason) => (
                                <span
                                  key={reason}
                                  className="inline-flex whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground"
                                >
                                  ✓ {reason}
                                </span>
                              ))}
                            </span>
                          </span>
                        )}
                      </span>
                      {/* Действия — СВОЕЙ строкой под содержимым (снимок №445):
                          колонкой справа они делили ширину с бейджами статуса,
                          и «Привлечён на мероприятие (наряд)» налезал на
                          кнопки. */}
                      <span className="flex w-full flex-wrap items-center justify-end gap-1">
                        {/* Чип-переключатель «Старший поста» (`[РАС-03]`): старший
                            на пост ОДИН, сервер снимает прежнего сам. Состояние
                            — `aria-pressed`, а не второй текст кнопки. */}
                        <RightGate reason={access.reason(PLACEMENT_MANAGE)}>
                          {(describedBy) => (
                            <button
                              type="button"
                              aria-pressed={assignment.isSectorSenior}
                              aria-label={`Старший поста: ${assignment.employeeName}`}
                              disabled={setSenior.isPending || !access.can(PLACEMENT_MANAGE)}
                              aria-describedby={describedBy}
                              onClick={() =>
                                setSenior.mutate({
                                  assignmentId: assignment.id,
                                  senior: !assignment.isSectorSenior,
                                })
                              }
                              className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                                assignment.isSectorSenior
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input bg-background text-foreground hover:bg-muted"
                              }`}
                            >
                              {assignment.isSectorSenior ? "✓ " : ""}Старший поста
                            </button>
                          )}
                        </RightGate>
                        <span className="flex gap-1">
                          <RightGate reason={access.reason(PLACEMENT_MANAGE)}>
                            {(describedBy) => (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-xs"
                                aria-label={`Роль и секция: ${assignment.employeeName}`}
                                disabled={!access.can(PLACEMENT_MANAGE)}
                                aria-describedby={describedBy}
                                onClick={() => setEditing(assignment)}
                              >
                                Роль и секция…
                              </Button>
                            )}
                          </RightGate>
                          <button
                            type="button"
                            aria-label={`Удалить с поста: ${assignment.employeeName}`}
                            title="Удалить с поста"
                            disabled={unassign.isPending || !access.can(PLACEMENT_MANAGE)}
                            onClick={() => unassign.mutate({ assignmentId: assignment.id })}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted hover:text-destructive-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </span>
                      </span>
                    </li>
                  ))}
                  {Array.from(
                    { length: Math.max(0, selected.need - assignmentsOf(selected.id).length) },
                    (_, index) => (
                      <li
                        key={`slot-${index}`}
                        data-slot="placement-empty-slot"
                        onDragOver={(e) => dragOverPost(e, selected.id)}
                        onDragLeave={() => leaveDrop(selected.id)}
                        onDrop={(e) => runPlacementAction(onDropPost(e, selected.id))}
                        className={`flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2 py-2 text-xs ${
                          dropTarget === selected.id
                            ? "border-primary bg-accent"
                            : "border-muted-foreground/40"
                        }`}
                      >
                        <span className="font-semibold">+ Назначить</span>
                        <span className="text-muted-foreground">
                          выберите сотрудника справа или перетащите его сюда
                        </span>
                      </li>
                    )
                  )}
                </ul>

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
                    /* 🔴 ТЕЛО СТРОИТСЯ ИЗ `allPosts`, А НЕ ИЗ `posts`
                       (Plane №471). `posts` — строки ТОЛЬКО показанного
                       объекта посещения, а `update_recon` на сервере не
                       сливает списки, а ЗАМЕЩАЕТ `recon_sector_posts`
                       присланным целиком. Пока здесь стоял разрез, сохранение
                       комментария на объекте A удаляло все посты объекта B:
                       его потребность падала в ноль, назначения оставались
                       ссылаться на несуществующие id, и восстановить было
                       нечем — прежних строк нет ни в одной версии.
                       Разрез нужен ПОКАЗУ, а не отправке; соседний
                       `ReconStage` шлёт полный список ровно поэтому. */
                    onClick={() =>
                      updateRecon.mutate({
                        checklist: event.reconChecklist,
                        sectorPosts: allPosts.map((p) =>
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
                <p className="text-xs font-semibold">Выделено на объект штабом</p>
                {/* Откуда пул — словами. Форм потребности и выделения сил на
                    шаге больше нет (Plane №110), и без этой строки человек не
                    узнал бы, ПОЧЕМУ здесь именно эти люди и что делать, если
                    нужных нет. Две подписи, а не одна: состав мероприятия и
                    кадровый список — разные основания подбора. */}
                {/* 🔴 ОБЕ ПОЛОВИНЫ ФРАЗЫ — ИЗ ОДНОЙ ОБЛАСТИ (Plane №489).
                    `allocated` — сумма выделенного ШТАБОМ по всему
                    мероприятию (люди выделяются ему, а не объекту: так же
                    считают плашки состава и «свободно» ниже), а `totalNeed` с
                    №410 считается по ПОКАЗАННОМУ объекту. Сложенные в одну
                    строку, они давали «Выделено 12 из потребности 5» —
                    выдуманный избыток под заголовком «на объект».

                    Взята потребность МЕРОПРИЯТИЯ, а не выделенное по объекту:
                    выделенного по объекту не существует — штаб выделяет людей
                    на ОМ, и разложить их по объектам может только тот, кто
                    расставляет. Область названа словом прямо в строке, иначе
                    следующий читатель снова сравнит её с числом объекта. */}
                <p className="text-[11px] text-muted-foreground">
                  {fromRoster
                    ? `Выделено ${allocated} из потребности мероприятия ${event.forceNeed}`
                    : "Силы на объект ещё не выделены"}
                </p>
                {/* Потребность ПОКАЗАННОГО объекта — отдельной строкой, а не
                    вторым числом в той же фразе: именно её закрывает оператор
                    на этом экране, и без неё пул выглядел бы безадресным. */}
                {fromRoster && scope.visit !== null && (
                  <p
                    className="text-[11px] text-muted-foreground"
                    data-slot="object-need"
                  >
                    Потребность объекта «{scope.visit.objectName}»: {totalNeed}
                  </p>
                )}
                {/* Без состава ссылка стоит в пустом состоянии ниже, а не
                    дважды: две одинаковые ссылки в одной колонке — шум, и
                    пробы карточки читают её как одну. */}
                {fromRoster && (
                  <Link
                    href="/employees?view=forces"
                    className="mt-0.5 inline-block text-[11px] font-semibold text-primary-ink"
                  >
                    Открыть «Сбор сил на ОМ» →
                  </Link>
                )}
              </div>
              {!fromRoster ? (
                /* `[РАС-05]`: без состава списка нет ВОВСЕ — прежде под этой
                   подписью всё равно шла вся база. */
                <div className="p-3 text-xs" data-slot="placement-pool-empty">
                  <p className="font-semibold">Силы на объект ещё не выделены</p>
                  {/* 🔴 «ПРИСЛАНО X ИЗ N» СНЯТО (Plane №648). Числитель был
                      структурно нулём: у автозаявки сервер пишет
                      `allocatedCount = len(force_roster)`, а эта ветка
                      рисуется ровно тогда, когда состав ПУСТ. Человек читал
                      «прислано 0», когда департаменты уже выделили людей и не
                      хватало только приёмки штабом. Хуже того, при нулевой
                      потребности сервер держит `force_requests = []`, и экран
                      сообщал про заявку, которой нет вовсе.

                      Теперь названо то, что этот экран действительно знает:
                      сколько запрошено и что в составе никого. Сколько
                      выделили департаменты — вопрос «Сбора сил», и ссылка
                      ниже ведёт туда. */}
                  <p className="mt-1 text-muted-foreground">
                    {event.forceRequests.length === 0
                      ? `Заявки на силы по ${event.code} ещё нет.`
                      : `Заявка ${event.code}: запрошено ${requestedTotal} чел. В состав штаб пока никого не принял.`}
                  </p>
                  <Link
                    href="/employees?view=forces"
                    className="mt-1.5 inline-block font-semibold text-primary-ink"
                  >
                    Сбор сил на ОМ →
                  </Link>
                </div>
              ) : (
              <div className="space-y-2 p-2">
                <label className="block text-[9px] font-bold uppercase text-muted-foreground">
                  Управление
                  <select
                    aria-label="Фильтр по управлению"
                    className="mt-0.5 block h-8 w-full rounded-md border bg-background px-2 text-xs"
                    value={activeUnitFilter}
                    onChange={(e) => setUnitFilter(e.target.value)}
                  >
                    <option value="">Все управления</option>
                    {unitOptions.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  className="h-8 text-xs"
                  // 🔴 ПОИСК ИДЁТ ТОЛЬКО ПО ФИО (Plane №651). Серверную
                  // половину, которая искала и по подразделению, выключил
                  // `[РАС-04]`; обещание осталось, и набранное название
                  // управления давало «никого не подходит». Управление
                  // выбирается СВОИМ полем выше — дублировать его строкой
                  // поиска незачем.
                  placeholder="Поиск по ФИО"
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
                      onChange={(e) => {
                        // Сброса страницы больше нет и не нужно: страниц у
                        // состава не бывает — он весь на руках (Plane №652).
                        setSort(e.target.value as SortOption);
                      }}
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
                      onChange={(e) => {
                        setBand(e.target.value as RateOption);
                      }}
                    >
                      {RATE_OPTIONS.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1">
                  {/* Плашки состава — ПРО МЕРОПРИЯТИЕ: люди выделены ему, и
                      подбор предлагает их на любой его объект. Число объекта
                      стоит выше, в сводке этапа (Plane №410). */}
                  <Chip tone="info">Выделено {allocated}</Chip>
                  <Chip>Свободны {free}</Chip>
                  <Chip>Назначены {assignedInEvent}</Chip>
                </div>
                {/* 🔴 СЧЁТЧИК И ПАГИНАЦИЯ КАДРОВОЙ БАЗЫ СНЯТЫ (Plane №652).
                    Весь этот блок стоял ВНУТРИ ветки `fromRoster` и рисовал
                    ветки `!fromRoster` — недостижимые по определению
                    (`fromRoster === event.forceRoster.length > 0`). Вместе с
                    ними ушли `roster.isFetching` (всегда `false` у
                    выключенного запроса) и `aria-busy` по нему. Список
                    состава страницами не листается: он весь на руках. */}
                <p
                  className="text-[11px] text-muted-foreground"
                  aria-live="polite"
                >
                  {/* Число НАЗЫВАЕТ то, что показано (Plane №579): подбор
                      отбирает состав по объекту, и «состав мероприятия: 12»
                      над списком из четырёх читалось бы как потеря восьми.
                      Когда отбор что-то убрал, названы оба числа. */}
                  {rosterPeople.length === rosterAll.length
                    ? `Состав мероприятия: ${rosterAll.length} чел.`
                    : `Отдано этому объекту: ${rosterPeople.length} из ${rosterAll.length} чел. состава`}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Кандидаты — люди, принятые штабом в «Сборе сил на ОМ» и
                  отданные этому объекту. Постороннего на пост сервер не
                  поставит.
                </p>
                {/* `aria-busy` вместо подмены списка спиннером (правило скилла
                    «стабильный скелет с aria-busy; не мигать»): прежняя
                    страница остаётся на экране, пока едет новая — за это
                    отвечает `placeholderData` в хуке, — но пометка занятости
                    обязана быть, иначе список выглядит готовым, а показывает
                    прежний отбор. Полупрозрачность — ВТОРОЙ признак, не
                    единственный: одним цветом состояние не кодируется. */}
                <div className="max-h-[360px] space-y-1 overflow-y-auto">
                  {candidates.length === 0 ? (
                    /* 🔴 ПУСТОТА НАЗЫВАЕТ ТЕ ФИЛЬТРЫ, ЧТО ДЕЙСТВИТЕЛЬНО
                       СТОЯТ (Plane №649). Здесь было «никто не подходит под
                       выбранный фильтр рейтинга» — при том, что `[РАС-04]`
                       добавил рядом ещё два отбора: по управлению и по
                       фамилии. Человек выбирал управление, получал пустой
                       список и шёл сбрасывать рейтинг, который стоял на
                       «Все». Ветки кадровой базы сняты вместе с самим
                       запросом (Plane №652) — они были недостижимы. */
                    <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                      {rosterPeople.length === 0
                        ? rosterAll.length === 0
                          ? "Состав мероприятия пуст — соберите людей в «Сборе сил на ОМ»."
                          : "Этому объекту никого не отдали — раздайте состав по объектам в «Сборе сил на ОМ»."
                        : activeFilters.length === 0
                          ? "В составе мероприятия кандидатов нет."
                          : `Под выбранные фильтры (${activeFilters.join(", ")}) в составе никто не подходит.`}
                    </p>
                  ) : (
                    candidates.map(({ person, fit, rating, busy, warn }) => (
                      <RightGate
                        key={person.id}
                        reason={access.reason(PLACEMENT_MANAGE)}
                        className="w-full"
                      >
                        {(describedBy) => (
                      <button
                        type="button"
                        // Выключенная кнопка не тянется (drag на disabled не
                        // стартует), поэтому без выбранного поста кнопка живая:
                        // клик молчит, а перетащить на пост в дереве можно.
                        disabled={assign.isPending || !access.can(PLACEMENT_MANAGE)}
                        aria-disabled={!access.can(PLACEMENT_MANAGE)}
                        aria-describedby={describedBy}
                        // 🔴 Причины отказа по праву здесь НЕТ (Plane №801):
                        //    на выключенной кнопке `title` не показывается
                        //    вовсе. Причина сказана блоком шага, связь с
                        //    кнопкой держит `aria-describedby`. В подсказке
                        //    остаётся только рабочее объяснение — оно нужно
                        //    тому, у кого право ЕСТЬ.
                        title={
                          selected === null
                            ? "Выберите пост слева или перетащите сотрудника на пост"
                            : "Назначить на выбранный пост (или перетащите на пост)"
                        }
                        draggable={access.can(PLACEMENT_MANAGE)}
                        onDragStart={(e) => startDrag(e, { employeeId: person.id })}
                        onDragEnd={() => setDropTarget(null)}
                        onClick={() =>
                          selected !== null &&
                          assign.mutate({ postId: selected.id, employeeId: person.id })
                        }
                        className="flex w-full cursor-grab items-start gap-2 rounded-md border p-2 text-left text-xs hover:bg-muted disabled:opacity-50"
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
                            {" · "}
                            {busy ? postsLabelOf(person.id) : "свободен"}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            <StatusBadge
                              code={person.statusCode}
                              label={person.statusLabel}
                            />
                            {/* Отсутствие рейтинга сказано СЛОВАМИ, а не
                                пустым местом (правило скилла «бейдж сообщает
                                состояние; не кодировать состояние цветом»).
                                Ноль здесь был бы прямой ложью: ноль — плохая
                                оценка, а тут судить не по чему. Пустота же
                                читалась бы как «бейдж не загрузился».
                                Показывается только тем, кто вправе видеть
                                балл: у остальных строка поля не несёт вовсе, и
                                сообщать им о чужих оценках нечего. */}
                            {canSeeRatings &&
                              (rating !== null ? (
                                <span className="rounded-full bg-secondary px-1.5 py-0.5 tabular-nums">
                                  {rating}
                                </span>
                              ) : (
                                <span className="rounded-full border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-muted-foreground">
                                  нет оценок
                                </span>
                              ))}
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
                        )}
                      </RightGate>
                    ))
                  )}
                </div>
              </div>
              )}
            </aside>
          </div>
        )}

        <StageError error={assign.error} />
        <StageError error={unassign.error} />
        <StageError error={move.error} />
        <StageError error={updateRecon.error} />
        <StageError error={setSenior.error} />
        <StageError error={complete.error} />

        {/* Подтверждение НАЗЫВАЕТ ЧИСЛА: какой пост, из какого сектора и на
            сколько человек уменьшится потребность. Снятие поста меняет
            основание, по которому собирали людей, и «Удалить?» без чисел это
            не сообщает. */}
        <Dialog
          open={postToRemove !== null}
          onOpenChange={(open) => {
            if (!open) setPostToRemove(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Снять пост «{postToRemove?.post}»?</DialogTitle>
              <DialogDescription>
                {postToRemove === null
                  ? null
                  : `Сектор «${postToRemove.sector}». Пост уйдёт из расчёта, и потребность мероприятия уменьшится на ${postToRemove.need} чел. Заявка, ушедшая штабу, не меняется — она говорит, сколько людей запрашивали.`}
              </DialogDescription>
            </DialogHeader>
            <StageError error={removePost.error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setPostToRemove(null)}>
                Отмена
              </Button>
              {/* Окно закрывается ОТВЕТОМ сервера, а не кликом: отказ человек
                  должен увидеть здесь же. */}
              <Button
                variant="destructive"
                disabled={removePost.isPending}
                onClick={async () => {
                  if (postToRemove === null) return;
                  await removePost.mutateAsync({ postId: postToRemove.id });
                  setPostToRemove(null);
                }}
              >
                {removePost.isPending ? "Снятие…" : "Снять пост"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AssignmentEditDialog
          assignment={editing}
          posts={posts}
          roles={placementRoles.data ?? []}
          sections={placementSections.data ?? []}
          pending={assign.isPending || unassign.isPending || move.isPending}
          onClose={() => setEditing(null)}
          onSave={(next) => runPlacementAction(saveEdit(next))}
        />

        <RatingBriefDialog
          employeeId={ratingBriefFor?.id ?? null}
          employeeName={ratingBriefFor?.name ?? ""}
          unit={ratingBriefFor?.unit ?? ""}
          rating={
            ratingBriefFor === null ? null : ratingOf(ratingBriefFor.id)
          }
          onClose={() => setRatingOf(null)}
        />

        <ConflictDialog
          conflict={assign.conflict}
          onOverride={(reason) => assign.confirmOverride(reason)}
          onCancel={() => assign.dismissConflict()}
        />
        {/* Перенос спрашивает обоснование СВОИМ окном (Plane №762): у него своя
            ручка и своё тело, и повтор с обоснованием — обычный
            `confirmOverride`. Прежде окно было одно на обе операции, и его
            «Обосновать» приходилось учить отличать перенос от назначения из
            пула, а «Отмена» — возвращать человека на прежний пост. */}
        <ConflictDialog
          conflict={move.conflict}
          onOverride={(reason) => move.confirmOverride(reason)}
          onCancel={() => move.dismissConflict()}
        />
        <ConflictDialog
          conflict={complete.conflict}
          onOverride={(reason) => complete.confirmOverride(reason)}
          onCancel={() => complete.dismissConflict()}
        />
        </AccessHints>
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
  // Слияние статусов (Plane №486): цепочка пишет `IN_EVENT`. Старый код
  // оставлен читателем ради строк, не прошедших миграцию, — иначе
  // привлечённый человек показался бы свободным.
  "IN_EVENT",
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

/** Окно «Роль и секция…» строки назначения (`[РАС-03]`, Plane №445). Сюда же
 * ушла смена поста: это клавиатурная альтернатива перетаскиванию, без которой
 * перенос был бы доступен только мышью. Сохранение — снятие и назначение
 * заново на стороне доски. */
function AssignmentEditDialog({
  assignment,
  posts,
  roles,
  sections,
  pending,
  onClose,
  onSave,
}: {
  assignment: PlacementAssignment | null;
  posts: ReconSectorPost[];
  roles: { code: string; label: string }[];
  sections: { code: string; label: string }[];
  pending: boolean;
  onClose: () => void;
  /** Возвращает `void`, а не промис (Plane №745): ждать здесь нечего, а
   * отклонение ловит `runPlacementAction` у родителя — `void onSave(...)` в
   * этом месте было той же дырой этажом ниже. */
  onSave: (next: { roleCode: string; sectionCode: string; postId: string }) => void;
}) {
  const [roleCode, setRoleCode] = useState("");
  const [sectionCode, setSectionCode] = useState("");
  const [postId, setPostId] = useState("");
  useEffect(() => {
    if (assignment === null) return;
    setRoleCode(assignment.roleCode ?? "");
    setSectionCode(assignment.sectionCode ?? "");
    setPostId(assignment.postId);
  }, [assignment]);
  const field =
    "mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
  return (
    <Dialog
      open={assignment !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Роль и секция: {assignment?.employeeName}</DialogTitle>
          <DialogDescription>
            Роль — кем человек идёт в наряде, секция — где стоит в бланке. Пост
            можно сменить здесь же, без перетаскивания.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs font-semibold">
            Роль наряда
            <select
              aria-label="Роль наряда"
              className={field}
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value)}
            >
              <option value="">Роль не назначена</option>
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold">
            Секция бланка
            <select
              aria-label="Секция бланка"
              className={field}
              value={sectionCode}
              onChange={(e) => setSectionCode(e.target.value)}
            >
              <option value="">Секция не назначена</option>
              {sections.map((section) => (
                <option key={section.code} value={section.code}>
                  {section.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold">
            Пост
            <select
              aria-label="Пост"
              className={field}
              value={postId}
              onChange={(e) => setPostId(e.target.value)}
            >
              {posts.map((post) => (
                <option key={post.id} value={post.id}>
                  {post.sector} · {post.post}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={pending || assignment === null}
            onClick={() => onSave({ roleCode, sectionCode, postId })}
          >
            {pending ? "Сохранение…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
