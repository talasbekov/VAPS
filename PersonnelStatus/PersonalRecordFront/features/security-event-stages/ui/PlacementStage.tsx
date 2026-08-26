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
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { ConflictDialog } from "@/features/ops-conflict-override";
import { RatingBriefDialog } from "./RatingBriefDialog";
import {
  PLACEMENT_MANAGE,
  useChainAccess,
} from "@/features/forces-split/ui/chain-access";
import {
  useAssignPlacement,
  useCompletePlacement,
  usePersonnelPage,
  useSetSectorSenior,
  useUnassignPlacement,
  useUpdateRecon,
} from "@/hooks/use-security-event-stages";
import { useOperationalRatings } from "@/hooks/use-ops-ratings";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import type {
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

/** Подпись полосы на экране → КОД контракта ручки (Plane №67, шаг РЙ-5).
 *
 * Подпись живёт на экране и переводится, код — контракт. Полоса `Все` кода не
 * имеет: «не отбирать» это отсутствие параметра, а не особое значение. */
const BAND_CODE: Record<string, string | undefined> = {
  Все: undefined,
  "9,0–10,0": "9_10",
  "8,0–8,9": "8_9",
  "7,0–7,9": "7_8",
  "Ниже 7,0": "below_7",
  "Недостаточно данных": "no_data",
};

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
  // Шаг всегда открывается ДОСКОЙ подбора (задача заказчика Plane №110: «убери
  // с этапа Расстановка эти боксы они не нужны»). Двух подготовительных форм —
  // строк потребности и выделения сил по группам — здесь больше нет: стадии
  // `DEMAND` и `FORCES` проходит сервер расчётом рекогносцировки, и человек их
  // не видит вовсе. Состав мероприятия при этом собирается как собирался — на
  // экране «Сбор сил на ОМ», пока ОМ уже стоит на расстановке.
  return <PlacementBoard event={event} />;
}

/** Размер страницы подбора. Крупнее окна выбора человека: здесь список не
 * выбирают одним кликом, а просматривают — отбор по рейтингу и автоподбор
 * работают по показанному, и страница в двадцать строк резала бы им основание. */
const CANDIDATE_PAGE_SIZE = 50;

// ── Расстановка: три колонки прототипа ───────────────────────────────────

function PlacementBoard({ event }: { event: SecurityEvent }) {
  // Расстановку заказчик закрепил за старшим объекта/мероприятия (Plane №74).
  // Клиент гейтит по КОДУ права; «его ли это мероприятие» знает сервер — он же
  // и отвечает словами, если нет.
  const access = useChainAccess();
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
  // Отбор и порядок уезжают на СЕРВЕР только для кадровой базы (Plane №67,
  // шаг РЙ-5). У мероприятия со своим составом они остаются на клиенте
  // ОСОЗНАННО: состав — десятки строк, они уже на руках, и круг к серверу за
  // ними ничего бы не уточнил. Там же, где список листается страницами, отбор
  // по показанному был прямым враньём — «нет кандидатов» означало «нет на этой
  // странице».
  const roster = usePersonnelPage({
    search,
    page,
    pageSize: CANDIDATE_PAGE_SIZE,
    enabled: !fromRoster,
    ratingBand: canSeeRatings ? BAND_CODE[band] : undefined,
    ordering: canSeeRatings && sort === "По рейтингу" ? "rating" : undefined,
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
  const assignedCount = event.placementAssignments.length;
  const totalNeed = posts.reduce((sum, post) => sum + post.need, 0);
  const unfilled = posts.filter((p) => assignmentsOf(p.id).length < p.need).length;
  const conflicts = event.placementAssignments.filter(
    (a) => a.ratingOverrideReason !== null
  ).length;
  const free = Math.max(0, allocated - assignedCount);
  /** Что мешает завершить этап — словами и в одном месте.
   *
   * Порядок не случаен: недобор запирает завершение (сервер отбивает
   * `PLACEMENT_INCOMPLETE`), обходы рейтинга — нет, их просто надо видеть.
   * Пусто — значит завершать можно, и молчание здесь честнее «всё хорошо».
   */
  const placementWarning: string | null = (() => {
    const parts: string[] = [];
    if (posts.length > 0 && unfilled > 0)
      parts.push(
        `не укомплектовано постов: ${unfilled} — этап не завершится, пока на каждом посту есть люди`
      );
    if (conflicts > 0)
      parts.push(`назначений с обходом предупреждения по рейтингу: ${conflicts}`);
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
    const source = fromRoster
      ? rosterPeople.filter((person) =>
          person.name.toLowerCase().includes(query.trim().toLowerCase())
        )
      : (roster.data?.results ?? []);
    const list = fromRoster
      ? source.filter((person) => inBand(ratingOfRow(person)))
      : source;
    const withFit = list.map((person) => ({
      person,
      fit: fitOf(person),
      rating: ratingOfRow(person),
      busy: assignedIds.has(person.id),
      warn: warnOf(person),
    }));
    switch (sort) {
      case "По рейтингу":
        // Порядок кадровой базы задал СЕРВЕР — пересортировать страницу здесь
        // значило бы переставить её внутри себя и выдать это за ранжирование.
        return fromRoster
          ? withFit.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
          : withFit;
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
        {/* Причина недоступности — СЛОВАМИ и один раз на шаг: у доски действий
            много (автоподбор, назначение, снятие, старший сектора), и повтор
            одной строки у каждого превратил бы экран в частокол. Подсказка
            `title` остаётся у каждой кнопки — для тех, кто пришёл к ней
            напрямую с клавиатуры. */}
        {access.reason(PLACEMENT_MANAGE) !== "" && (
          <p
            className="text-[11px] text-muted-foreground"
            data-slot="access-note"
          >
            {access.reason(PLACEMENT_MANAGE)}
          </p>
        )}
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
              disabled={
                assign.isPending || unfilled === 0 || !access.can(PLACEMENT_MANAGE)
              }
              aria-disabled={!access.can(PLACEMENT_MANAGE)}
              title={access.reason(PLACEMENT_MANAGE)}
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
                  const sectorSenior = sector.posts
                    .flatMap((post) => assignmentsOf(post.id))
                    .find((a) => a.isSectorSenior);
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
                    {/* Старший сектора назван в дереве: спрашивать доклад с
                        сектора будут с него, и знать это надо ДО того, как
                        открыт конкретный пост. */}
                    <p className="px-1 pb-1 text-[10px] text-muted-foreground">
                      Старший:{" "}
                      {sectorSenior === undefined
                        ? "не назначен"
                        : sectorSenior.employeeName}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {sector.posts.map((post) => {
                        const placed = assignmentsOf(post.id);
                        const count = placed.length;
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
                          {assignment.isSectorSenior && (
                            <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-foreground">
                              Старший сектора
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
                      {/* Действия — колонкой справа, как в прототипе: в ряд
                          они съедают ширину у имени с подразделением, и то
                          обрезалось на «Отдел охраны объек…». */}
                      <span className="flex shrink-0 flex-col gap-1">
                      {/* Старший сектора — ОДИН: сервер снимает прежнего сам,
                          и кнопка не спрашивает «а кто сейчас старший». */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={setSenior.isPending || !access.can(PLACEMENT_MANAGE)}
                        aria-disabled={!access.can(PLACEMENT_MANAGE)}
                        title={access.reason(PLACEMENT_MANAGE)}
                        onClick={() =>
                          setSenior.mutate({
                            assignmentId: assignment.id,
                            senior: !assignment.isSectorSenior,
                          })
                        }
                      >
                        {assignment.isSectorSenior
                          ? "Снять старшего"
                          : "Старший сектора"}
                      </Button>
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
                        disabled={!access.can(PLACEMENT_MANAGE)}
                        aria-disabled={!access.can(PLACEMENT_MANAGE)}
                        title={access.reason(PLACEMENT_MANAGE)}
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
                {/* Откуда пул — словами. Форм потребности и выделения сил на
                    шаге больше нет (Plane №110), и без этой строки человек не
                    узнал бы, ПОЧЕМУ здесь именно эти люди и что делать, если
                    нужных нет. Две подписи, а не одна: состав мероприятия и
                    кадровый список — разные основания подбора. */}
                <p className="text-[11px] text-muted-foreground">
                  {fromRoster
                    ? "Состав мероприятия: те, кого штаб принял в «Сборе сил»"
                    : "Кадровый список: состав мероприятия ещё не собран"}
                </p>
                <Link
                  href="/employees?view=forces"
                  className="mt-0.5 inline-block text-[11px] font-semibold text-primary-ink"
                >
                  Открыть «Сбор сил на ОМ» →
                </Link>
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
                      onChange={(e) => {
                        setSort(e.target.value as SortOption);
                        // Порядок теперь считает сервер: остаться на третьей
                        // странице прежнего порядка значило бы показать кусок
                        // из середины другого списка.
                        setPage(1);
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
                        // Отбор считает сервер: страница прежнего отбора к
                        // новому отношения не имеет.
                        setPage(1);
                      }}
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
                    С РЙ-5 это число — результат ОТБОРА ПО ВСЕЙ БАЗЕ, поэтому
                    прежняя оговорка «отбор идёт по показанному» снята: она
                    лечила словами то, что теперь вылечено кодом. */}
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
                    Отбор по рейтингу и порядок по баллу считаются по всей базе.
                    «По соответствию» и автоподбор — по показанной странице:
                    соответствие считается против выбранного поста, о котором
                    кадровый список не знает.
                  </p>
                )}
                {/* `aria-busy` вместо подмены списка спиннером (правило скилла
                    «стабильный скелет с aria-busy; не мигать»): прежняя
                    страница остаётся на экране, пока едет новая — за это
                    отвечает `placeholderData` в хуке, — но пометка занятости
                    обязана быть, иначе список выглядит готовым, а показывает
                    прежний отбор. Полупрозрачность — ВТОРОЙ признак, не
                    единственный: одним цветом состояние не кодируется. */}
                <div
                  aria-busy={roster.isFetching}
                  className={`max-h-[360px] space-y-1 overflow-y-auto ${
                    roster.isFetching ? "opacity-60" : ""
                  }`}
                >
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
                            : band !== "Все"
                              ? `Во всей базе нет никого с рейтингом «${band}» — отбор считал сервер, а не эта страница.`
                              : "По запросу никого не нашлось."}
                    </p>
                  ) : (
                    candidates.map(({ person, fit, rating, busy, warn }) => (
                      <button
                        key={person.id}
                        type="button"
                        disabled={
                          selected === null ||
                          assign.isPending ||
                          !access.can(PLACEMENT_MANAGE)
                        }
                        aria-disabled={!access.can(PLACEMENT_MANAGE)}
                        title={access.reason(PLACEMENT_MANAGE)}
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
        <StageError error={setSenior.error} />
        <StageError error={complete.error} />

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
