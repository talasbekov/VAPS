"use client";

// Тело профиля сотрудника (`[ПРФ-01…08]`): шапка, «Мои назначения», «Календарь»,
// «История». Живёт виджетом, а не страницей (Plane №449): его читают ДВЕ
// страницы — «Мой профиль» и профиль сотрудника для администратора (только
// чтение, `/security-ops/profile/[employeeId]`).
//
// Ключевой вопрос экрана — «а который сотрудник я». Отвечает на него СЕРВЕР
// (`/api/operations/my-employee/`): связь учётной записи с кадровой живёт
// только у него. Подбирать себя на клиенте по совпадению фамилии нельзя —
// однофамилец выдал бы чужую службу за свою.
//
// Связи МОГЕТ НЕ БЫТЬ, и это штатный исход: поле заполняется вручную, сид его
// не делает. Тогда экран показывает причину словами сервера, а не пустые
// плитки: нули здесь читались бы как «ничего не было».
//
// Всё остальное присоединяется к найденной записи по её ИДЕНТИФИКАТОРУ:
// статусы — серверным фильтром, назначения в ОМ и смены дежурств — по
// `employeeId` в уже загруженных коллекциях. По имени не соединяется ничего.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIsoDate } from "@/shared/lib/date";
// Арифметика дат берётся у расхода, а не пишется здесь второй раз: там же
// живёт правило «полуинтервал бэка ↔ включительный день на экране», и второй
// его экземпляр разошёлся бы с первым молча (Plane №657).
import { addDaysIso } from "@/entities/daily-grid";
import {
  useCoreDirectories,
  useEmployeeStatuses,
  useMyEmployee,
} from "@/hooks/use-my-employee";
import {
  useAcknowledgeMyAssignment,
  useDeclineMyAssignment,
  useMyAssignments,
} from "@/hooks/use-my-assignments";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, X } from "lucide-react";
import type { MyAssignmentRow } from "@/hooks/use-my-assignments";
import { useMyDutyShifts } from "@/hooks/use-duty-shifts";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useOpsStatusTypes } from "@/hooks/use-ops-status-types";
import { STAGE_LABEL } from "@/entities/security-event";
import { useAllEvaluationsOf } from "@/hooks/use-ops-ratings";
import { DUTY_STATE_LABEL } from "@/entities/duty-shift";
import type { DutyShift } from "@/entities/duty-shift";
import type { CoreEmployee, OpsEmployeeStatusRow } from "@/lib/api";
import type { SecurityEvent } from "@/entities/security-event";

// «История» стоит ПОСЛЕ «Моей статистики» — так просил заказчик (Plane
// «Реестр ОМ-40»). Порядок вкладок здесь и есть порядок на экране.
// Три вкладки спецификации `[ПРФ-03]` (Plane №434): «Моя статистика» и
// «Инструкции» сняты — источника в системе у них не было (`[ПРФ-01]`).
type ProfileTab = "events" | "calendar" | "history";

const TAB_LABEL: Record<ProfileTab, string> = {
  events: "Мои назначения",
  calendar: "Календарь",
  history: "История",
};

/* Подписи статусов берутся из СПРАВОЧНИКА СЕРВЕРА (`useOpsStatusTypes`) —
 * одного владельца на все экраны расхода. До Plane №342 здесь стояла карта
 * `STATUS_LABEL_BY_CODE` из `entities/daily-grid`: она сама была копией
 * серверного каталога, и заведённый в админке тип на этом экране печатался
 * голым кодом. Хук зовётся в КАЖДОМ из трёх мест, где нужна подпись, — ключ
 * запроса один, и второго обращения к серверу это не делает. */

/** Цвет отметки в календаре — по СОСТОЯНИЮ строки, а не по её типу: экран не
 * решает, какой статус «важнее», он показывает, что с ним сейчас. */
const STATE_DOT: Record<string, string> = {
  PLANNED: "bg-indigo-500",
  ACTIVE: "bg-blue-600",
  COMPLETED: "bg-muted-foreground",
  CANCELLED: "bg-red-600",
};

const STATE_LABEL: Record<string, string> = {
  PLANNED: "Запланирован",
  ACTIVE: "Действует",
  COMPLETED: "Завершён",
  CANCELLED: "Отменён",
};

const MONTH_NAME = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
] as const;
const MONTH_ABBR = [
  "ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН",
  "ИЮЛ", "АВГ", "СЕН", "ОКТ", "НОЯ", "ДЕК",
] as const;
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/** Цвет отметки СМЕНЫ: у смены свой набор состояний (есть «Ознакомлен»,
 *  которого у статуса нет), и подставлять сюда карту статусов значило бы
 *  печатать голый код там, где у службы дежурств есть подпись. */
const DUTY_DOT: Record<string, string> = {
  PLANNED: "bg-amber-500",
  ACKNOWLEDGED: "bg-amber-600",
  ACTIVE: "bg-emerald-600",
  COMPLETED: "bg-muted-foreground",
  CANCELLED: "bg-red-600",
};

/** Строка календаря: статус или смена, приведённые к одной форме. Приводятся
 *  ЗДЕСЬ, а не в двух разных списках, потому что и сетка, и панель дня, и
 *  список месяца задают им один и тот же вопрос — «что было в этот день». */
interface CalendarPeriod {
  key: string;
  kind: "status" | "shift" | "assignment";
  title: string;
  /** Чем эта строка отличается от соседней с тем же названием: мероприятие у
   *  статуса привлечения, объект у смены. Пустая строка — отличать нечем. */
  detail: string;
  from: string;
  to: string;
  state: string;
  stateLabel: string;
  dot: string;
  note: string;
}

const pad2 = (value: number) => String(value).padStart(2, "0");
const todayIsoValue = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};
/** ISO-дата по номеру месяца ОТ НУЛЯ — как его хранит курсор и отдаёт Date. */
const isoOf = (year: number, month: number, day: number) =>
  `${year}-${pad2(month + 1)}-${pad2(day)}`;
const coversDay = (period: CalendarPeriod, iso: string) =>
  iso >= period.from && iso <= (period.to ?? period.from);

/**
 * ПОСЛЕДНИЙ ДЕНЬ СТАТУСА по его `date_end` (Plane №657).
 *
 * 🔴 `date_end` — ГРАНИЦА ПОЛУИНТЕРВАЛА `[date_start, date_end)`, а не
 * последний день. Так его хранит сервер (`models_status.py`: действующим
 * считается статус с `date_end > business_date`) и так его пишет расход
 * (`daily-grid.toBulkRequest` прибавляет к введённому дню сутки). Профиль
 * печатал границу как включительную: «Отпуск до 15.09» при фактическом
 * последнем дне 14.09 — человек выходит на день позже, чем должен.
 *
 * Календарь этого же виджета читает `to` включительно (`coversDay`), поэтому
 * перевод нужен ОДИН и в одном месте — здесь, на входе данных в экран.
 *
 * Вырожденная строка (`date_end <= date_start`, нулевая длина) не уводится
 * ниже начала: показать «с 15-го по 14-е» хуже, чем показать один день.
 */
const lastDayOfStatus = (dateStart: string, dateEnd: string) => {
  const previous = addDaysIso(dateEnd, -1);
  return previous < dateStart ? dateStart : previous;
};

const MONTH_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
] as const;

/** «3 сентября 2026» из ISO — заголовок панели выбранного дня. */
function dayTitle(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)} ${MONTH_GENITIVE[Number(month) - 1]} ${year}`;
}

/** Подпись дня для озвучивания: точки цветом ничего не говорят без текста. */
function dayAriaLabel(iso: string, count: number): string {
  if (count === 0) return `${dayTitle(iso)} — ничего не назначено`;
  return `${dayTitle(iso)} — ${count} ${periodWord(count)}`;
}

function periodWord(count: number): string {
  const tail = count % 10;
  const teen = count % 100;
  if (teen >= 11 && teen <= 14) return "периодов";
  if (tail === 1) return "период";
  if (tail >= 2 && tail <= 4) return "периода";
  return "периодов";
}

export function ProfileBody({
  employee,
  readOnly = false,
}: {
  employee: CoreEmployee;
  /** Профиль ЧУЖОГО сотрудника (`[ПРФ-08]`, Plane №449): администратор читает,
   * кнопок ответа на назначение нет, назначения — по `?employee=`. */
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<ProfileTab>("events");
  const directories = useCoreDirectories();
  const statuses = useEmployeeStatuses(employee.id);
  // СВОИ назначения своей ручкой, а не реестр целиком (Plane №403): реестр
  // открыт держателю `event.view`, и рядовому сотруднику вкладка отвечала
  // «реестр недоступен» — назначения не показывались никогда.
  const events = useMyAssignments(readOnly ? String(employee.id) : undefined);
  // Оценки по закрытым ОМ (`[ПРФ-02]`, `[ПРФ-06]`): ВСЕ страницы реестра, а
  // не первая (Plane №660). Шапке нужен средний балл, истории — балл по
  // мероприятию, и оба считаются по полному списку: реестр отдаёт по десять
  // строк, и при одиннадцати оценённых ОМ старшие получали «не оценивалось»,
  // а «из N мероприятий» было занижено — молча, без признака обрезки.
  const evaluations = useAllEvaluationsOf(String(employee.id));
  /**
   * Мероприятия, по которым человека ОЦЕНИВАЛИ. Множество кодов, а не карта
   * «код → балл» (Plane №658).
   *
   * 🔴 БАЛЛА ЗА ОТДЕЛЬНОЕ МЕРОПРИЯТИЕ КЛИЕНТ НЕ ЗНАЕТ И ЗНАТЬ НЕ ДОЛЖЕН.
   * Здесь стояла карта `eventNumber → row.aggregateRating`, но
   * `aggregateRating` в строке реестра — АГРЕГАТ УЧАСТНИКА за период
   * методики: он одинаков во всех его строках. История печатала одно и то же
   * число напротив каждого мероприятия, а «средний балл» получался средним
   * из копий этого числа, то есть им же.
   *
   * Взять настоящий балл неоткуда, и это не пробел, а правило раздела:
   * `score` закрытых записей наружу не сериализуется нигде (§19.16, §19.21,
   * шапка `ratings.py`). Поэтому история говорит то, что реестр
   * действительно знает: оценивали ли человека по этому мероприятию.
   */
  const evaluatedEvents = useMemo(() => {
    const codes = new Set<string>();
    for (const row of evaluations.data?.results ?? []) {
      // 🔴 СВЕРКА ИДЁТ ПО КАДРОВОМУ ID (Plane №655). `employeeId` строки
      // реестра — КОД УЧАСТНИКА рейтинга (`employee-<id>`), и сравнение его с
      // кадровым id не совпадало НИКОГДА: чип рейтинга в шапке не
      // показывался, а в колонке «Балл» истории стояло «не оценивалось» у
      // всех. `personnelId` отдан сервером рядом ровно для таких читателей.
      if (String(row.personnelId) !== String(employee.id)) continue;
      if (row.aggregateRating === null) continue;
      codes.add(row.eventNumber);
    }
    return codes;
  }, [evaluations.data, employee.id]);
  /**
   * Средний балл — АГРЕГАТ, взятый как есть, а не пересчитанный на клиенте.
   * Сервер считает его сам (§19.19: среднее учтённых оценок периода
   * методики, округлённое там же), и второй расчёт здесь был бы вторым
   * ответом на тот же вопрос. Число одинаково во всех строках участника —
   * берём первое непустое.
   *
   * «Из N мероприятий» считается по РАЗНЫМ мероприятиям, а не по числу строк
   * реестра: у одного мероприятия оценок бывает несколько (направления,
   * исправления), и счёт строк завышал бы N.
   */
  const rating = useMemo(() => {
    const mine = (evaluations.data?.results ?? []).filter(
      // По кадровому id, а не по коду участника (Plane №655) — см. выше.
      (row) => String(row.personnelId) === String(employee.id)
    );
    const aggregate = mine.find((row) => row.aggregateRating !== null)?.aggregateRating;
    if (aggregate === undefined || aggregate === null) return null;
    return { average: aggregate, events: evaluatedEvents.size };
  }, [evaluations.data, employee.id, evaluatedEvents]);
  // СВОИ смены, а не реестр целиком: реестр открыт только держателю
  // `duty.view`, и рядовому сотруднику он отвечал 403 — смены в календаре не
  // показывались никогда, а ошибка гасилась молча (Plane №381).
  // Смены ЧУЖОГО сотрудника ручка «мои смены» не отдаёт — в чужом профиле
  // запрос не делается, а календарь говорит об этом словами.
  const shifts = useMyDutyShifts({ enabled: !readOnly });
  /**
   * Смены, которые календарь имеет право нарисовать (Plane №656).
   *
   * 🔴 `enabled: false` НЕ ОЧИЩАЕТ КЭШ. Ключ `['ops-duty-shifts','mine']`
   * общий на всё приложение: после захода в СВОЙ профиль смены смотрящего
   * лежат в кэше React Query, и в чужом профиле хук отдавал их как данные.
   * Календарь чужого человека рисовал полоски «Дежурство» — СВОИ смены
   * администратора, — пока баннер под ним уверял, что смены не показываются.
   * Экран утверждал две противоположные вещи, и картинка убедительнее текста.
   *
   * Пустой список тут — не «дежурств нет», а «мы про них не знаем», и это
   * сказано словами в `shiftsNote` рядом: молчаливый ноль читался бы как факт
   * о человеке.
   */
  const shownShifts = readOnly ? [] : (shifts.data?.results ?? []);

  const myAssignments = useMemo(
    () => (events.data?.results ?? []).map(toMyAssignment),
    [events.data]
  );

  // Почему смен не видно, если их не видно. Молчаливый ноль читается как
  // «дежурств нет», а это разные вещи.
  const shiftsNote = readOnly
    ? "смены дежурств другого сотрудника здесь не показываются."
    : shifts.isError
      ? "запрос к службе дежурств не прошёл, попробуйте обновить страницу."
      : (shifts.data?.unlinkedReason ?? null);

  return (
    <>
      <HeroCard
        employee={employee}
        rankLabel={directories.rankLabel(employee.rank_code)}
        positionLabel={directories.positionLabel(employee.position_code)}
        divisionLabel={directories.divisionLabel(employee.division)}
        statuses={statuses.data ?? []}
        statusesLoading={statuses.isPending}
        // Отказ запроса — НЕ факт о человеке (Plane №659). Без этого признака
        // `statuses.data ?? []` при 403 или обрыве давал пустой список, а
        // пустой список — законное «В строю»: сотрудник в отпуске был
        // неотличим от сотрудника в строю, и ошибка связи печаталась зелёным
        // чипом как утверждение.
        statusesFailed={statuses.isError}
        rating={rating}
      />

      <nav
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1"
        aria-label="Разделы профиля"
      >
        {(Object.keys(TAB_LABEL) as ProfileTab[]).map((code) => (
          <button
            key={code}
            type="button"
            className={
              tab === code
                ? "rounded-md bg-background px-3 py-1.5 text-sm font-semibold shadow-sm"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
            onClick={() => setTab(code)}
          >
            {/* В чужом профиле «мои» не подходит: читает не владелец. */}
            {readOnly && code === "events" ? "Назначения" : TAB_LABEL[code]}
          </button>
        ))}
      </nav>

      {tab === "events" && (
        <EventsTab
          assignments={myAssignments}
          loading={events.isPending}
          failed={events.isError}
          readOnly={readOnly}
        />
      )}
      {tab === "calendar" && (
        <CalendarTab
          statuses={statuses.data ?? []}
          shifts={shownShifts}
          assignments={myAssignments}
          shiftsNote={shiftsNote}
          loading={statuses.isPending || (!readOnly && shifts.isPending)}
          readOnly={readOnly}
        />
      )}
      {tab === "history" && (
        <HistoryTab
          assignments={myAssignments}
          evaluatedEvents={evaluatedEvents}
          rating={rating}
          scoresDenied={evaluations.isError}
          scoresLoading={evaluations.isPending}
          loading={events.isPending}
          failed={events.isError}
          readOnly={readOnly}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Карточка-шапка                                                      */
/* ------------------------------------------------------------------ */

/** Статус словами (`[ПРФ-02]`). */
function statusWords(
  statuses: OpsEmployeeStatusRow[],
  labelOf: (code: string) => string
): { text: string; inService: boolean } {
  const active = statuses.find((row) => row.state === "ACTIVE") ?? null;
  if (active !== null) {
    const participation = active.participations[0];
    if (participation !== undefined) {
      return {
        text: ["Участие в ОМ", participation.event_code, formatIsoDate(active.date_start)]
          .filter((part) => part)
          .join(" "),
        inService: false,
      };
    }
    const label = labelOf(active.status_type_code);
    return {
      text:
        active.status_type_code === "IN_SERVICE"
          ? label
          : `${label} до ${formatIsoDate(lastDayOfStatus(active.date_start, active.date_end))}`,
      inService: active.status_type_code === "IN_SERVICE",
    };
  }
  const planned = statuses
    .filter((row) => row.state === "PLANNED")
    .sort((a, b) => a.date_start.localeCompare(b.date_start))[0];
  if (planned !== undefined) {
    return {
      text: `В строю · с ${formatIsoDate(planned.date_start)} ${labelOf(planned.status_type_code).toLowerCase()}`,
      inService: true,
    };
  }
  return { text: "В строю", inService: true };
}

function eventsWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return "мероприятия";
  return "мероприятий";
}

function HeroCard({
  employee,
  rankLabel,
  positionLabel,
  divisionLabel,
  statuses,
  statusesLoading,
  statusesFailed,
  rating,
}: {
  employee: CoreEmployee;
  rankLabel: string | null;
  positionLabel: string | null;
  divisionLabel: string | null;
  statuses: OpsEmployeeStatusRow[];
  statusesLoading: boolean;
  /** Запрос статусов не прошёл (403, обрыв). Тогда статуса НЕТ — ни «В
   *  строю», ни любого другого: пустой ответ и отсутствие ответа это разные
   *  вещи (`[ПРФ-02]`, Plane №659). */
  statusesFailed: boolean;
  /** Средний балл по закрытым ОМ и число оценённых мероприятий; null —
   * оценок нет, и блока рейтинга нет (`[ПРФ-02]`, `[ПРФ-01]`). */
  rating: { average: number; events: number } | null;
}) {
  const statusTypes = useOpsStatusTypes();
  const initials = `${employee.last_name.slice(0, 1)}${employee.first_name.slice(0, 1)}`;
  // Статус СЛОВАМИ (`[ПРФ-02]`, Plane №434): действующий — с «до …», без
  // действующего — ближайший запланированный «с …», иначе «В строю».
  // «Действующих статусов нет» читалось как пустота, а это и есть строй.
  const statusLine = statusWords(statuses, statusTypes.labelOf);
  // Чипы только с данными (`[ПРФ-01]`: нет данных — нет блока).
  const chips: string[] = [
    employee.personnel_number === null ? "" : `Табельный № ${employee.personnel_number}`,
    divisionLabel ?? "",
    employee.hire_date === null ? "" : `В службе с ${formatIsoDate(employee.hire_date)}`,
    employee.is_active ? "" : "Не числится в учёте",
  ].filter((chip) => chip !== "");

  return (
    <Card className="bg-gradient-to-br from-card via-card to-primary/10">
      <CardContent className="flex flex-wrap items-center gap-6 p-6 lg:flex-nowrap">
        <span className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-2xl bg-primary text-3xl font-extrabold text-primary-foreground shadow-lg shadow-primary/25">
          {initials}
        </span>
        <div className="min-w-[16rem] flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight">{employee.full_name}</h2>
            {statusesLoading ? (
              <span className="text-xs text-muted-foreground">
                статус загружается…
              </span>
            ) : statusesFailed ? (
              // Ни зелёного, ни утверждения: сказано ровно то, что известно.
              <span
                data-testid="profile-status"
                role="status"
                title="Запрос статусов сотрудника не прошёл — обновите страницу"
                className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
              >
                статус не получен
              </span>
            ) : (
              <span
                data-testid="profile-status"
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  statusLine.inService
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                    : "bg-primary/10 text-primary-ink"
                }`}
              >
                {statusLine.text}
              </span>
            )}
            {rating !== null && (
              <span
                data-testid="profile-rating"
                title="Средний балл по закрытым мероприятиям"
                className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
              >
                {rating.average.toFixed(1).replace(".", ",")} · из {rating.events}{" "}
                {eventsWord(rating.events)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[rankLabel, positionLabel].filter(Boolean).join(" · ") ||
              "звание и должность не указаны"}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground"
              >
                {chip}
              </span>
            ))}
          </div>
          {(employee.work_phone || employee.work_email) && (
            <p className="mt-2.5 text-[11px] text-muted-foreground">
              {[
                employee.work_phone ? `Служебный телефон: ${employee.work_phone}` : "",
                employee.work_email ? `Служебная почта: ${employee.work_email}` : "",
              ]
                .filter((part) => part !== "")
                .join(" · ")}
            </p>
          )}
        </div>

      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Вкладка «Охранные мероприятия»                                      */
/* ------------------------------------------------------------------ */

type MyAssignmentEvent = Pick<
  SecurityEvent,
  | "id"
  | "code"
  | "title"
  | "stage"
  | "businessDate"
  | "businessDateEnd"
  | "objectName"
>;

interface MyAssignmentPost {
  sector: string;
  post: string;
  task: string;
  requirements: string;
  uniform?: string;
  weapon?: string;
}

interface MyAssignment {
  id: string;
  event: MyAssignmentEvent;
  /** Строка расчёта, к которой привязано назначение; null — расчёт её потерял.
   * Задача поста и есть «краткая инструкция» прототипа: своего документа-
   * инструкции в модели нет, а эта строка — то, что человеку велено делать. */
  post: MyAssignmentPost | null;
  postLabel: string;
  acknowledgedAt: string | null;
  /** Способ и автор отметки (`[ОЗН-05]`, Plane №722): «лично» — старший довёл
   * устно, и это ДРУГОЙ факт, чем «я прочитал в системе». Без них карточка
   * показывала оба одинаково. */
  acknowledgedVia: string;
  acknowledgedBy: string;
  /** «Не могу заступить» (Plane №405): отказ и подтверждение взаимоисключающи. */
  declinedAt: string | null;
  declineReason: string | null;
}

/**
 * Название мероприятия — ССЫЛКОЙ ТОЛЬКО ТОМУ, КОМУ КАРТОЧКА ОТКРЫТА
 * (Plane №595).
 *
 * 🔴 Карточка ОМ закрыта правом `event.view`, а ручка «мои назначения»
 * написана ровно для того, у кого его НЕТ: рядовой сотрудник видит свои
 * заступления, не видя реестра. Ссылка вела его на экран «Доступ закрыт» —
 * обещала то, чего не даёт.
 *
 * Без права ссылки нет ВОВСЕ, а не выключенной: у ссылки нет действия,
 * которое можно выключить, и «серая ссылка» читалась бы как неполадка. Для
 * этого человека карточки ОМ не существует, и текст без ссылки — честное
 * описание его мира. (Конвенция раздела «недоступное выключается, а не
 * прячется» — про ДЕЙСТВИЯ: там выключенная кнопка отвечает на вопрос
 * «почему я не могу», здесь вопроса не возникает.)
 */
function EventLink({
  eventId,
  className,
  children,
  hideWithoutAccess = false,
}: {
  eventId: string;
  className: string;
  children: React.ReactNode;
  /** Кнопка-ссылка, у которой нет смысла без перехода: без права её нет
   *  вовсе. Для НАЗВАНИЯ мероприятия остаётся текст — оно называет строку. */
  hideWithoutAccess?: boolean;
}) {
  const { hasPermission, isLoading } = useOpsPermissions();
  // Пока права грузятся — ссылка есть: мигать интерфейсом хуже, а переход
  // всё равно упрётся в тот же гейт страницы, что и раньше.
  if (!isLoading && !hasPermission("event.view")) {
    return hideWithoutAccess ? null : <span className={className}>{children}</span>;
  }
  return (
    <Link href={`/security-ops/events/${eventId}`} className={className}>
      {children}
    </Link>
  );
}

/** Плоская строка сервера → форма, которую читают вкладки. Мероприятие
 * здесь — срез полей, а не карточка ОМ: сотруднику без `event.view` карточка
 * и не положена. */
function toMyAssignment(row: MyAssignmentRow): MyAssignment {
  return {
    id: row.assignmentId,
    event: {
      id: row.eventId,
      code: row.eventCode,
      title: row.eventTitle,
      stage: row.eventStage,
      businessDate: row.businessDate,
      businessDateEnd: row.businessDateEnd,
      objectName: row.objectName,
    },
    post: row.postFound
      ? {
          sector: row.sector,
          post: row.post,
          task: row.task,
          requirements: row.requirements,
          uniform: row.uniform,
          weapon: row.weapon,
        }
      : null,
    postLabel: row.postFound
      ? `${row.sector} · ${row.post}`
      : "пост не найден в расчёте",
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedVia: row.acknowledgedVia ?? "",
    acknowledgedBy: row.acknowledgedBy ?? "",
    declinedAt: row.declinedAt ?? null,
    declineReason: row.declineReason ?? null,
  };
}

function EventsTab({
  assignments,
  loading,
  failed,
  readOnly = false,
}: {
  assignments: MyAssignment[];
  loading: boolean;
  failed: boolean;
  readOnly?: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Загрузка назначений…</p>;
  }
  if (failed) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Назначения сейчас недоступны — запрос к серверу не прошёл.
        </CardContent>
      </Card>
    );
  }
  // Граница «предстоящее / прошедшее» — по дате мероприятия и стадии: закрытое
  // ОМ не предстоит, даже если его дата ещё не наступила.
  // Порядок `[ПРФ-04]`: требуют действия → подтверждённые → готовятся
  // (расстановка ещё не согласована — кнопок нет).
  const rank = (item: MyAssignment) =>
    !isPreparing(item) && item.acknowledgedAt === null && item.declinedAt === null
      ? 0
      : item.acknowledgedAt !== null
        ? 1
        : isPreparing(item)
          ? 3
          : 2;
  const upcoming = assignments
    .filter((item) => item.event.stage !== "CLOSED")
    .sort((a, b) => rank(a) - rank(b) || a.event.businessDate.localeCompare(b.event.businessDate));
  const past = assignments.filter((item) => item.event.stage === "CLOSED");

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Предстоящие назначения</CardTitle>
              <p className="text-xs text-muted-foreground">
                {readOnly
                  ? "ОМ и посты, на которые назначен сотрудник"
                  : "ОМ и посты, на которые вы назначены"}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
              {countLabel(upcoming.length)}
            </span>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Действующих назначений нет.
              </p>
            ) : (
              <ul className="divide-y">
                {upcoming.map((item) => (
                  <AssignmentRow
                    // 🔴 КЛЮЧ — ID НАЗНАЧЕНИЯ (Plane №594). Пара «мероприятие
                    // + подпись поста» уникальной НЕ является: у двух строк
                    // одного ОМ пост мог уйти из расчёта (обе подписи пусты),
                    // а гард `DOUBLE_ASSIGNMENT` ловит только ДРУГОЙ пост.
                    // `AssignmentRow` держит своё состояние (окно отказа и
                    // причина), и React при совпавших ключах переиспользует
                    // чужой экземпляр: окно отказа и уходящий на сервер
                    // `assignmentId` относились бы к соседней строке.
                    key={item.id}
                    item={item}
                    readOnly={readOnly}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

      </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Вкладка «История»                                                   */
/* ------------------------------------------------------------------ */

/**
 * История заступлений на ОМ (Plane «Реестр ОМ-40»): где человек стоял, в чём и
 * с чем, и какой балл ему за это поставили.
 *
 * Раньше этот блок жил внутри вкладки «Охранные мероприятия» рядом с
 * действующими назначениями — заказчик потребовал вынести его в СВОЮ вкладку
 * после «Моей статистики»: у истории другой вопрос («что было») и другой
 * объём, и рядом с текущими назначениями она их отжимала.
 *
 * Форма одежды и вооружение берутся из СТРОКИ РАСЧЁТА поста, а не из
 * назначения: назначение — это связь «человек ↔ пост», а чем пост оснащён,
 * решает рекогносцировка. Пропавшая строка расчёта поэтому означает «пост не
 * найден», а не пустые ячейки.
 *
 * Балл приходит из реестра оценок участников ОМ и МОЖЕТ БЫТЬ НЕДОСТУПЕН:
 * оперативный рейтинг ведётся обезличенно, реестр открывается по своему праву
 * (`ratings.*`), и у человека без него запрос отвечает отказом. Тогда в
 * колонке стоит причина, а не прочерк: прочерк читался бы как «балла нет».
 */
function HistoryTab({
  assignments,
  evaluatedEvents,
  rating,
  scoresDenied,
  scoresLoading,
  loading,
  failed,
  readOnly = false,
}: {
  assignments: MyAssignment[];
  evaluatedEvents: Set<string>;
  rating: { average: number; events: number } | null;
  scoresDenied: boolean;
  scoresLoading: boolean;
  loading: boolean;
  failed: boolean;
  /** Чужой профиль (`[ПРФ-08]`, Plane №662): «с вашим участием» читает не
   *  владелец. */
  readOnly?: boolean;
}) {
  // Только закрытые ОМ (`[ПРФ-06]`), свежие сверху.
  const past = assignments
    .filter((item) => item.event.stage === "CLOSED")
    .sort((a, b) => b.event.businessDate.localeCompare(a.event.businessDate));

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Загрузка истории…
        </CardContent>
      </Card>
    );
  }
  if (failed) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-destructive-ink">
          Реестр мероприятий сейчас недоступен — историю показать не из чего.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>История заступлений на ОМ</CardTitle>
          <p className="text-xs text-muted-foreground" data-testid="history-summary">
            Участие в ОМ: {past.length} {eventsWord(past.length)}
            {rating !== null &&
              ` · средний балл ${rating.average.toFixed(1).replace(".", ",")}`}
          </p>
        </div>
        <Link
          href="/security-ops/events"
          className="shrink-0 text-sm font-semibold text-primary-ink hover:underline"
        >
          Реестр ОМ →
        </Link>
      </CardHeader>
      <CardContent>
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? "Закрытых мероприятий с участием сотрудника нет."
              : "Закрытых мероприятий с вашим участием нет."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[96px_1.6fr_1.1fr_1.1fr_150px_84px] gap-2 rounded-md bg-muted/60 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <span>Дата</span>
                <span>Мероприятие</span>
                <span>Объект</span>
                <span>Пост</span>
                <span>Ознакомление</span>
                <span>Балл</span>
              </div>
              {past.map((item) => (
                <div
                  // Ключ — id назначения, а не пара «ОМ + подпись поста»
                  // (Plane №594): подписи двух строк одного ОМ совпадают,
                  // если пост ушёл из расчёта у обеих.
                  key={item.id}
                  className="grid grid-cols-[96px_1.6fr_1.1fr_1.1fr_150px_84px] items-baseline gap-2 border-b px-3 py-2.5 last:border-0"
                >
                  <span className="text-xs tabular-nums">
                    {formatIsoDate(item.event.businessDate)}
                  </span>
                  <EventLink
                    eventId={item.event.id}
                    className="truncate text-sm font-semibold hover:underline"
                  >
                    {item.event.code} — {item.event.title}
                  </EventLink>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.event.objectName || "—"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.postLabel}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {item.acknowledgedAt === null
                      ? "—"
                      : formatIsoDate(item.acknowledgedAt.slice(0, 10))}
                  </span>
                  <ScoreCell
                    evaluated={evaluatedEvents.has(item.event.code)}
                    denied={scoresDenied}
                    loading={scoresLoading}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Балл за участие. Четыре РАЗНЫХ ответа, и путать их нельзя: «загрузка»,
 * «нет права», «оценки не было» и само число. Прочерк на все случаи сразу
 * читался бы как «ноль баллов». */
function ScoreCell({
  evaluated,
  denied,
  loading,
}: {
  evaluated: boolean;
  denied: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span data-slot="history-score" className="text-[11px] text-muted-foreground">
        …
      </span>
    );
  }
  if (denied) {
    return (
      <span
        data-slot="history-score"
        className="text-[11px] text-muted-foreground"
        title="Оперативный рейтинг ведётся обезличенно и открывается по своему праву."
      >
        нет доступа
      </span>
    );
  }
  if (!evaluated) {
    return (
      <span data-slot="history-score" className="text-[11px] text-muted-foreground">
        не оценивалось
      </span>
    );
  }
  // ЧИСЛА ЗДЕСЬ БОЛЬШЕ НЕТ (Plane №658): балл за конкретное мероприятие
  // закрыт (§19.16, §19.21), а стоявший тут агрегат участника одинаков во
  // всех строках — колонка «Балл» печатала одно и то же число напротив
  // каждого мероприятия. Средний балл остаётся в шапке, где он и есть
  // ответ на свой вопрос.
  return (
    <span
      data-slot="history-score"
      className="text-[11px] text-muted-foreground"
      title="Балл за отдельное мероприятие не раскрывается: рейтинг ведётся агрегатом за период."
    >
      оценён
    </span>
  );
}

/** Счётчик в шапке карточки — с русским согласованием: «1 назначение»,
 * «2 назначения», «5 назначений». */
function countLabel(count: number): string {
  const tail = count % 100;
  const last = count % 10;
  if (tail >= 11 && tail <= 14) return `${count} назначений`;
  if (last === 1) return `${count} назначение`;
  if (last >= 2 && last <= 4) return `${count} назначения`;
  return `${count} назначений`;
}

/**
 * «Допуски и подготовка» — блок прототипа без источника: квалификаций, их
 * сроков и отметок о подготовке модель не хранит вовсе. Карточка стоит на
 * своём месте раскладки пустой: перечислить здесь «Огневую подготовку до
 * 30.09» значило бы выдать человеку допуск, которого система не выдавала.
 */
function DateTile({ iso }: { iso: string }) {
  return (
    <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 leading-tight">
      <span className="text-base font-extrabold tabular-nums text-primary-ink">
        {iso.slice(8, 10)}
      </span>
      <span className="text-[10px] font-bold text-primary-ink">
        {MONTH_ABBR[Number(iso.slice(5, 7)) - 1] ?? ""}
      </span>
    </span>
  );
}

function AckBadge({
  acknowledgedAt,
  acknowledgedVia = "",
  acknowledgedBy = "",
  declinedAt = null,
  declineReason = null,
}: {
  acknowledgedAt: string | null;
  acknowledgedVia?: string;
  acknowledgedBy?: string;
  declinedAt?: string | null;
  declineReason?: string | null;
}) {
  // Отказ — отдельное состояние, а не «не подтверждено» (Plane №405): старший
  // читает причину здесь же, а карточка не зовёт подтвердить то, от чего
  // человек отказался.
  if (declinedAt !== null) {
    return (
      <span
        className="inline-flex w-fit max-w-[260px] rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-200"
        title={declineReason ?? undefined}
      >
        Не могу заступить{declineReason ? `: ${declineReason}` : ""}
      </span>
    );
  }
  return acknowledgedAt === null ? (
    <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
      Ознакомление не подтверждено
    </span>
  ) : (
    <span
      className="inline-flex w-fit rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800 dark:bg-green-950/60 dark:text-green-200"
      data-slot="ack-badge"
      /* СПОСОБ НАЗВАН (Plane №722): «лично» значит, что довели устно, и это
         другой факт, чем собственное подтверждение в системе. Автор отметки —
         в подсказке: в строке он занял бы место, а спрашивают его редко. */
      title={
        acknowledgedVia === "personal" && acknowledgedBy !== ""
          ? `Отметил лично: ${acknowledgedBy}`
          : undefined
      }
    >
      Ознакомлен{acknowledgedVia === "personal" ? " лично" : ""}:{" "}
      {formatIsoDate(acknowledgedAt.slice(0, 10))}
    </span>
  );
}

/** Назначение «готовится» — расстановка ещё не согласована (`[ПРФ-04]`):
 * этап мероприятия раньше «Ознакомления». */
function isPreparing(item: MyAssignment): boolean {
  return !["ACKNOWLEDGEMENT", "CONDUCT", "CLOSED"].includes(item.event.stage);
}

function AssignmentRow({
  item,
  readOnly = false,
}: {
  item: MyAssignment;
  readOnly?: boolean;
}) {
  const acknowledge = useAcknowledgeMyAssignment();
  const decline = useDeclineMyAssignment();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  /**
   * Начать ответ заново: снять ПРОТУХШУЮ ошибку соседней мутации (Plane
   * №590).
   *
   * 🔴 React Query чистит `error` только при повторе ТОЙ ЖЕ мутации. У строки
   * их две — подтверждение и отказ, — и красная строка от неудавшегося отказа
   * оставалась висеть на всю жизнь строки: человек нажимал «Ознакомлен,
   * заступлю», ответ проходил, бейдж зеленел, а рядом продолжала стоять
   * ошибка про отказ. `useOpsMutation` отдаёт `reset` ровно для этого, и его
   * не звал никто.
   */
  const clearAnswerErrors = () => {
    acknowledge.reset();
    decline.reset();
  };
  /**
   * ЕДИНСТВЕННАЯ дорога закрытия окна отказа (Plane №591).
   *
   * Способов закрыть три — кнопка «Отмена», Esc и клик вне окна, — и они
   * ходят РАЗНЫМИ путями: кнопка звала `setDeclineOpen(false)` напрямую, мимо
   * `onOpenChange`. Поэтому очистка, повешенная на один из них, не работала
   * для остальных; теперь путь один.
   */
  const closeDecline = () => {
    setDeclineOpen(false);
    setReason("");
    clearAnswerErrors();
  };
  // Ответить можно, пока мероприятие живо: закрытому ОМ ответ уже никому не
  // нужен, и сервер его не примет.
  const preparing = isPreparing(item);
  const answerable = item.event.stage !== "CLOSED" && !preparing;
  const busy = acknowledge.isPending || decline.isPending;
  const period =
    item.event.businessDateEnd !== null &&
    item.event.businessDateEnd !== item.event.businessDate
      ? `${formatIsoDate(item.event.businessDate)} — ${formatIsoDate(item.event.businessDateEnd)}`
      : formatIsoDate(item.event.businessDate);

  // Сетка прототипа: плитка даты | описание | столбец состояния. Бейдж и
  // кнопка стоят в СВОЁМ столбце (бейдж вверху, кнопка внизу) — в первой
  // версии переноса бейдж уехал в строку заголовка, и правый край карточки
  // разъезжался тем сильнее, чем длиннее название мероприятия.
  return (
    <li className="grid grid-cols-[60px_minmax(0,1fr)_auto] gap-3 py-3.5 first:pt-0 last:pb-1">
      <DateTile iso={item.event.businessDate} />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-[7px]">
          <span className="bg-secondary text-secondary-foreground inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums">
            {item.event.code}
          </span>
          <EventLink
            eventId={item.event.id}
            className="truncate text-xs font-bold hover:underline"
          >
            {item.event.title}
          </EventLink>
        </div>

        <h3 className="mt-2 mb-[3px] text-[13px] font-semibold">
          {item.postLabel}
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {item.event.objectName} · {period} · стадия:{" "}
          {STAGE_LABEL[item.event.stage]}
        </p>

        <p className="border-primary/40 bg-muted/50 mt-2 rounded border-l-[3px] px-2.5 py-[7px] text-[10.5px] leading-[1.45]">
          <span className="font-bold">Краткая инструкция:</span>{" "}
          {item.post === null || item.post.task.trim() === ""
            ? "задача поста в расчёте не заполнена"
            : item.post.task}
        </p>
      </div>

      <div
        className="flex flex-col items-end justify-between gap-2"
        data-testid={`my-assignment-${item.id}`}
      >
        {preparing ? (
          <span className="inline-flex w-fit rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            назначение готовится
          </span>
        ) : (
          <AckBadge
            acknowledgedAt={item.acknowledgedAt}
            acknowledgedVia={item.acknowledgedVia}
            acknowledgedBy={item.acknowledgedBy}
            declinedAt={item.declinedAt}
            declineReason={item.declineReason}
          />
        )}
        {/* Ответ сотрудника (Plane №405, `[ПРФ-04]`): «Ознакомлен, заступлю»
            ставит подтверждение, «Не могу заступить» просит причину. Уже
            данный ответ можно переменить — обстоятельства меняются. */}
        {answerable && !readOnly && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {item.acknowledgedAt === null && (
              <Button
                type="button"
                size="sm"
                className="h-[31px] text-[11px]"
                disabled={busy}
                onClick={() => {
                  // Новый ответ — чистый лист: ошибка ПРЕДЫДУЩЕГО ответа
                  // (в том числе соседней мутации) снимается до отправки.
                  clearAnswerErrors();
                  acknowledge.mutate({
                    eventId: item.event.id,
                    assignmentId: item.id,
                  });
                }}
              >
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Ознакомлен, заступлю
              </Button>
            )}
            {item.declinedAt === null && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-[31px] text-[11px]"
                disabled={busy}
                onClick={() => {
                  clearAnswerErrors();
                  setDeclineOpen(true);
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Не могу заступить
              </Button>
            )}
          </div>
        )}
        {(acknowledge.error || decline.error) && (
          <p className="text-[11px] text-destructive" role="alert">
            {(acknowledge.error ?? decline.error)?.message ??
              "Ответ не сохранён — попробуйте ещё раз."}
          </p>
        )}
        {/* «Инструкция по посту» ведёт в ту же закрытую карточку (Plane
            №595). Здесь это КНОПКА-ссылка, то есть действие: тому, у кого
            права нет, она не показывается вовсе — краткая инструкция и так
            стоит выше в строке, а нажатие приводило на «Доступ закрыт». */}
        <EventLink
          eventId={item.event.id}
          className="hover:bg-muted inline-flex h-[31px] shrink-0 items-center rounded-lg border bg-background px-3 text-[11px] font-medium whitespace-nowrap transition-colors"
          hideWithoutAccess
        >
          Инструкция по посту
        </EventLink>
      </div>

      {/* 🔴 ЗАКРЫТИЕ ОКНА ЧИСТИТ ПРИЧИНУ (Plane №591). Здесь стоял голый
          `setDeclineOpen`: «Отмена», Esc и клик вне окна закрывали его, не
          трогая текст, а чистила его только удачная отправка. При повторном
          открытии той же строки отменённая причина УЖЕ была вписана, и
          «Отправить отказ» уже включена — брошенный текст уходил на сервер
          одним нажатием. Заодно снимается протухшая ошибка (Plane №590):
          закрытое окно и красная строка про него рядом — разные утверждения. */}
      <Dialog
        open={declineOpen}
        onOpenChange={(open) => (open ? setDeclineOpen(true) : closeDecline())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Не могу заступить — {item.event.code}</DialogTitle>
            <DialogDescription>
              {item.postLabel}, {period}. Причина уйдёт старшему объекта: ему
              нужно понять, кого и почему заменять.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`decline-reason-${item.id}`}>Причина</Label>
            <Textarea
              id={`decline-reason-${item.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: болезнь, командировка, отпуск по приказу"
              rows={3}
            />
          </div>
          <DialogFooter>
            {/* Одна дорога закрытия на все три способа (кнопка, Esc, клик
                вне окна): кнопка ходила мимо `onOpenChange`, и очистка,
                повешенная туда, для неё не срабатывала. */}
            <Button variant="outline" onClick={closeDecline}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim() === "" || decline.isPending}
              onClick={() => {
                // Диалог закрывается только на успех: ошибка остаётся в
                // `decline.error` и показана под кнопками карточки.
                void decline
                  .mutateAsync({
                    eventId: item.event.id,
                    assignmentId: item.id,
                    reason: reason.trim(),
                  })
                  .then(() => {
                    // Окно закрывается своей дорогой — она же и чистит текст.
                    closeDecline();
                  })
                  .catch(() => undefined);
              }}
            >
              Отправить отказ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Вкладка «Инструкции»                                                */
/* ------------------------------------------------------------------ */

/**
 * Что человеку велено делать на его постах.
 *
 * Отдельного документа-инструкции и подтверждения по нему в модели нет — есть
 * ЗАДАЧА поста и ТРЕБОВАНИЯ к нему из расчёта ОМ. Вкладка показывает их как
 * есть, по мероприятиям: это то же, что читает начальник смены в расстановке,
 * и придумывать поверх этого «регламент» не из чего.
 */
/* ------------------------------------------------------------------ */
/* Вкладка «Мой календарь»                                             */
/* ------------------------------------------------------------------ */

function CalendarTab({
  statuses,
  shifts,
  assignments,
  shiftsNote,
  loading,
  readOnly = false,
}: {
  statuses: OpsEmployeeStatusRow[];
  shifts: DutyShift[];
  /** Назначения на посты — полоски «ОМ-11 · Пост 2» (`[ПРФ-05]`, Plane №449). */
  assignments: MyAssignment[];
  /** Почему смен не видно, если их не видно: причина от сервера («учётка не
   *  связана с кадровой») или сорванный запрос. null — смены пришли. */
  shiftsNote: string | null;
  loading: boolean;
  /** Чужой профиль (`[ПРФ-08]`, Plane №662): подписи от первого лица здесь
   *  врут — читает не владелец. Соседние вкладки переписаны ещё в №449,
   *  календарь и история остались с «моими». */
  readOnly?: boolean;
}) {
  // Хуки стоят ДО раннего выхода на загрузке — иначе между рендерами
  // разъезжается их порядок.
  const { labelOf } = useOpsStatusTypes();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  // Выбранный день: пока не выбран, справа стоит список месяца целиком.
  const [selectedIso, setSelectedIso] = useState<string | null>(null);

  const periods = useMemo<CalendarPeriod[]>(
    () => {
      const today = todayIsoValue();
      // Назначение на пост — своя полоска с кодом ОМ и постом. Статус
      // привлечения на то же ОМ полоску не дублирует: у одного дня одно
      // мероприятие, а не две строки о нём.
      const assignedCodes = new Set(assignments.map((item) => item.event.code));
      return [
        ...assignments.map((item) => {
          const from = item.event.businessDate;
          const to = item.event.businessDateEnd ?? item.event.businessDate;
          const state =
            item.event.stage === "CLOSED" || to < today
              ? "COMPLETED"
              : from <= today
                ? "ACTIVE"
                : "PLANNED";
          return {
            key: `assignment-${item.id}`,
            kind: "assignment" as const,
            // Подпись канона — «ОМ-11 · Пост 2»: код и ПОСТ, без сектора
            // (сектор — в панели дня, вместе с названием ОМ и объектом).
            title: `${item.event.code} · ${item.post?.post ?? item.postLabel}`,
            detail: [item.event.title, item.event.objectName]
              .filter((part) => part !== "")
              .join(" · "),
            from,
            to,
            state,
            stateLabel: STATE_LABEL[state] ?? state,
            dot: STATE_DOT[state] ?? "bg-muted-foreground",
            note: "",
          };
        }),
        ...statuses
          .filter((row) => {
            const event = row.participations[0];
            return event === undefined || !assignedCodes.has(event.event_code);
          })
          .map((row) => {
          // Подпись мероприятия у статуса привлечения: без неё десять строк
          // «Привлечён на мероприятие (наряд)» неразличимы (Plane №381).
          // `event_code`/`event_title` приезжают вместе с участием, пустые —
          // если ОМ удалено.
          const event = row.participations[0];
          const eventLabel =
            event === undefined
              ? ""
              : [event.event_code, event.event_title]
                  .filter((part) => part !== "")
                  .join(" · ");
          return {
            key: `status-${row.id}`,
            kind: "status" as const,
            title: labelOf(row.status_type_code),
            detail: eventLabel,
            from: row.date_start,
            to: lastDayOfStatus(row.date_start, row.date_end),
            state: row.state,
            stateLabel: STATE_LABEL[row.state] ?? row.state,
            dot: STATE_DOT[row.state] ?? "bg-muted-foreground",
            note: row.comment,
          };
        }),
        ...shifts.map((shift) => ({
          key: `shift-${shift.id}`,
          kind: "shift" as const,
          title: "Дежурство",
          detail: shift.target.safeLabel,
          from: shift.businessDate,
          to: shift.businessDate,
          state: shift.stateCode,
          stateLabel: DUTY_STATE_LABEL[shift.stateCode] ?? shift.stateCode,
          dot: DUTY_DOT[shift.stateCode] ?? "bg-muted-foreground",
          note: shift.note ?? "",
        })),
      ].sort((a, b) => b.from.localeCompare(a.from));
    },
    [statuses, shifts, assignments, labelOf]
  );

  // Сетка месяца: дню приписаны СОСТОЯНИЯ покрывающих его периодов — те же
  // цвета, что у списка рядом. Сравнение ISO-строк, без арифметики дат.
  const grid = useMemo(() => {
    const daysInMonth = new Date(
      Date.UTC(cursor.year, cursor.month + 1, 0)
    ).getUTCDate();
    const lead =
      (new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay() + 6) % 7;
    const cells: {
      iso: string;
      day: number;
      dots: string[];
      /** Полоски дня (`[ПРФ-05]`): до двух подписей, остальное — числом. */
      bars: { key: string; label: string; dot: string }[];
      count: number;
    }[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = isoOf(cursor.year, cursor.month, day);
      const covering = periods.filter((period) => coversDay(period, iso));
      const dots: string[] = [];
      for (const period of covering) {
        if (!dots.includes(period.dot)) dots.push(period.dot);
      }
      cells.push({
        iso,
        day,
        dots: dots.slice(0, 3),
        bars: covering
          .slice(0, 2)
          .map((period) => ({ key: period.key, label: period.title, dot: period.dot })),
        count: covering.length,
      });
    }
    return { lead, cells };
  }, [cursor, periods]);

  // Список справа связан с показанным месяцем: 30 строк за все годы сразу
  // читать нельзя, а листание месяца, которое ничего в списке не меняет,
  // выглядит сломанным.
  const monthStart = isoOf(cursor.year, cursor.month, 1);
  const monthEnd = isoOf(
    cursor.year,
    cursor.month,
    new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate()
  );
  const monthPeriods = useMemo(
    () =>
      periods.filter(
        (period) =>
          period.from <= monthEnd && (period.to ?? period.from) >= monthStart
      ),
    [periods, monthStart, monthEnd]
  );
  // «Ближайшие 30 дней» (`[ПРФ-05]`): от сегодня вперёд, по возрастанию;
  // прошедшее показанного месяца — свёрнуто ниже.
  const todayValue = todayIsoValue();
  const horizonIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
  })();
  const upcoming = useMemo(
    () =>
      periods
        .filter(
          (period) =>
            (period.to ?? period.from) >= todayValue && period.from <= horizonIso
        )
        .sort((a, b) => a.from.localeCompare(b.from)),
    [periods, todayValue, horizonIso]
  );
  const pastInMonth = useMemo(
    () => monthPeriods.filter((period) => (period.to ?? period.from) < todayValue),
    [monthPeriods, todayValue]
  );
  const dayPeriods =
    selectedIso === null
      ? []
      : periods.filter((period) => coversDay(period, selectedIso));

  if (loading) {
    return <p className="text-sm text-muted-foreground">Загрузка календаря…</p>;
  }

  const todayIso = todayValue;
  const shiftMonth = (delta: number) => {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
    // Выбор дня снимается: выбранный день чужого месяца в сетке не виден, и
    // панель рядом рассказывала бы о дне, которого на экране нет.
    setSelectedIso(null);
  };
  // Клик по строке списка ведёт к дню: у периода, начавшегося раньше месяца,
  // это первый его день В ПОКАЗАННОМ месяце.
  //
  // 🔴 ЕСЛИ ДЕНЬ ВПЕРЕДИ ПОКАЗАННОГО МЕСЯЦА — ПЕРЕЛИСТЫВАЕМ СЕТКУ (Plane
  // №661). Зажималось только начало, а «Ближайшие 30 дней» смотрят на месяц
  // вперёд и в конце месяца заведомо содержат строки следующего: клик по
  // такой строке открывал панель про 12 октября, тогда как сетка оставалась
  // сентябрьской и подсветки в ней не было — экран рассказывал про день,
  // которого не показывает. Тот же довод, по которому `shiftMonth` СНИМАЕТ
  // выбор дня: панель и сетка обязаны говорить об одном месяце.
  const selectPeriodDay = (period: CalendarPeriod) => {
    const target = period.from < monthStart ? monthStart : period.from;
    if (target > monthEnd) {
      const [year, month] = target.split("-").map(Number);
      setCursor({ year, month: month - 1 });
    }
    setSelectedIso(target);
  };

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.35fr_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>
              {readOnly ? "Календарь" : "Мой календарь"} ·{" "}
              {MONTH_NAME[cursor.month]} {cursor.year}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {readOnly
                ? "Дни с отметками статусов и смен сотрудника — выберите день, чтобы увидеть, что в нём"
                : "Дни с отметками моих статусов и смен — выберите день, чтобы увидеть, что в нём"}
            </p>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Предыдущий месяц"
              className="grid h-9 w-9 place-items-center rounded-md border text-sm hover:bg-muted"
              onClick={() => shiftMonth(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Следующий месяц"
              className="grid h-9 w-9 place-items-center rounded-md border text-sm hover:bg-muted"
              onClick={() => shiftMonth(1)}
            >
              ›
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {shiftsNote !== null && (
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              Смены дежурств не показаны: {shiftsNote} Статусы ниже это не
              затрагивает.
            </p>
          )}
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
              <span
                key={day}
                className="pb-1 text-center text-[10px] font-bold text-muted-foreground"
              >
                {day}
              </span>
            ))}
            {Array.from({ length: grid.lead }, (_, index) => (
              <span key={`lead-${index}`} aria-hidden />
            ))}
            {grid.cells.map((cell) => (
              <button
                key={cell.iso}
                type="button"
                // Кнопка, а не блок: день открывает свой состав, а значит это
                // управляющий элемент — с клавиатуры и с озвучиванием тоже.
                aria-pressed={cell.iso === selectedIso}
                aria-label={dayAriaLabel(cell.iso, cell.count)}
                onClick={() =>
                  setSelectedIso((current) =>
                    current === cell.iso ? null : cell.iso
                  )
                }
                className={[
                  "flex min-h-[64px] flex-col items-stretch rounded-md border p-1 text-left transition-colors",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  cell.iso === selectedIso
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : cell.iso === todayIso
                      ? "border-primary"
                      : "",
                ].join(" ")}
              >
                <span className="self-center text-[11px] font-semibold tabular-nums">
                  {cell.day}
                </span>
                {/* Полоски с подписью (`[ПРФ-05]`): «ОМ-11 · Пост 2»,
                    «Дежурство», «Отпуск». Цвет — состояние, как в легенде;
                    подпись обрезается, целиком — в панели дня. */}
                <span className="mt-0.5 flex flex-col gap-0.5" data-slot="day-bars">
                  {cell.bars.map((bar) => (
                    <span
                      key={bar.key}
                      title={bar.label}
                      className={`block truncate rounded-sm px-1 text-[9px] font-semibold leading-4 text-white ${bar.dot}`}
                    >
                      {bar.label}
                    </span>
                  ))}
                  {cell.count > cell.bars.length && (
                    <span className="text-[9px] leading-4 text-muted-foreground">
                      +{cell.count - cell.bars.length}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 border-t pt-3">
            {Object.entries(STATE_LABEL).map(([state, label]) => (
              <span
                key={state}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${STATE_DOT[state] ?? "bg-muted-foreground"}`}
                />
                {label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-full ${DUTY_DOT.PLANNED}`} />
              Дежурство
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>
              {selectedIso === null ? "Ближайшие 30 дней" : dayTitle(selectedIso)}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {selectedIso === null
                ? "Назначения, статусы и смены от сегодня вперёд; состояние каждой строки задаёт сервер"
                : "Что назначено на этот день"}
            </p>
          </div>
          {selectedIso !== null && (
            <button
              type="button"
              className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
              onClick={() => setSelectedIso(null)}
            >
              Весь месяц
            </button>
          )}
        </CardHeader>
        <CardContent>
          {(selectedIso === null ? upcoming : dayPeriods).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {selectedIso === null
                ? "В ближайшие 30 дней ни назначений, ни статусов, ни смен нет."
                : "В этот день ничего не назначено."}
            </p>
          ) : (
            <ul className="space-y-1" data-slot={selectedIso === null ? "upcoming-30" : "day-list"}>
              {(selectedIso === null ? upcoming : dayPeriods).map(
                (period) => (
                  <li key={period.key} className="border-b last:border-0">
                    <button
                      type="button"
                      onClick={() => selectPeriodDay(period)}
                      className="flex w-full flex-wrap items-baseline gap-2 rounded-md px-1 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${period.dot}`}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block">{period.title}</span>
                        {period.detail !== "" && (
                          <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            {period.detail}
                          </span>
                        )}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {period.from === period.to
                          ? period.from
                          : `${period.from} — ${period.to}`}
                      </span>
                      <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {period.stateLabel}
                      </span>
                      {period.note !== "" && (
                        <span className="w-full text-xs text-muted-foreground">
                          {period.note}
                        </span>
                      )}
                    </button>
                  </li>
                )
              )}
            </ul>
          )}
          {/* Прошлое — свёрнуто (`[ПРФ-05]`): за показанный месяц, по
              требованию, а не в общей ленте. */}
          {selectedIso === null && pastInMonth.length > 0 && (
            <details className="mt-3 border-t pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                Прошедшее за {MONTH_NAME[cursor.month].toLowerCase()} ·{" "}
                {pastInMonth.length} {periodWord(pastInMonth.length)}
              </summary>
              <ul className="mt-1 space-y-1">
                {pastInMonth.map((period) => (
                  <li key={period.key} className="flex flex-wrap items-baseline gap-2 px-1 py-1 text-xs text-muted-foreground">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${period.dot}`} />
                    <span className="flex-1">{period.title}</span>
                    <span className="tabular-nums">
                      {period.from === period.to ? period.from : `${period.from} — ${period.to}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            Пересечения периодов здесь не помечаются: их считает служба дежурств
            по своей политике конфликтов, и второй счёт разошёлся бы с ней.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

