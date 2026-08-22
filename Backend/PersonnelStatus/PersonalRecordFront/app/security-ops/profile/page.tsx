"use client";

// Мой профиль по экрану прототипа Smart Josparlau: личные данные, назначения,
// мой календарь и статистика службы.
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
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { formatIsoDate } from "@/shared/lib/date";
import {
  useCoreDirectories,
  useEmployeeStatuses,
  useMyEmployee,
} from "@/hooks/use-my-employee";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useDutyShiftsAll } from "@/hooks/use-duty-shifts";
import { STATUS_LABEL_BY_CODE } from "@/entities/daily-grid";
import { STAGE_LABEL } from "@/entities/security-event";
import type { CoreEmployee, OpsEmployeeStatusRow } from "@/lib/api";
import type { ReconSectorPost, SecurityEvent } from "@/entities/security-event";

type ProfileTab = "events" | "calendar" | "stats" | "instructions";

const TAB_LABEL: Record<ProfileTab, string> = {
  events: "Охранные мероприятия",
  calendar: "Мой календарь",
  stats: "Моя статистика",
  instructions: "Инструкции",
};

/** Подписи статусов берутся из каталога раздела — одного владельца на все
 * экраны расхода; свой словарь здесь разошёлся бы с сеткой дня. Карта
 * `STATUS_LABEL_BY_CODE` живёт в `entities/daily-grid`: до ревью ветки 22.08
 * она была скопирована сюда и ещё в два места «Ежедневного расхода». */
const STATUS_LABEL = STATUS_LABEL_BY_CODE;

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

/** Блоки прототипа, которым источника нет И которым не нашлось места прямо в
 * раскладке. Те, что в прототипе занимают собственную карточку (рейтинг,
 * готовность, имущество, инструкция по посту), стоят на своих местах и несут
 * причину внутри — читать её там, где ждёшь данные, честнее, чем в сноске.
 * Список статический: это решение переноса, а не данные сервера. */
const MISSING_BLOCKS: readonly { title: string; reason: string }[] = [
  {
    title: "Стаж службы",
    reason:
      "Дата приёма в карточке есть, но стаж — не разность дат: перерывы, льготная выслуга и переводы в него входят по кадровым правилам, которых модель не знает. Показана сама дата приёма.",
  },
  {
    title: "Допуски, подготовка и инструктажи",
    reason:
      "Квалификаций и их сроков модель не хранит. Ознакомление с расстановкой ОМ фиксируется (и показано во вкладке мероприятий), но это отметка о конкретном назначении, а не допуск.",
  },
  {
    title: "Часы на посту и «без замечаний» в статистике",
    reason:
      "Назначение расстановки — строка без часов: интервалов у постов ОМ нет, складывать нечего. Итог участия («без замечаний», «благодарность») тоже не фиксируется — есть только отметка ознакомления.",
  },
  {
    title: "Мои документы",
    reason:
      "Вложения в системе привязаны к мероприятиям и объектам, а не к сотруднику: своей папки у человека нет.",
  },
];

export default function MyProfilePage() {
  const me = useMyEmployee();
  const employee = me.data?.employee ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Личный кабинет"
          title="Мой профиль"
          description="Личные данные, назначения, мой календарь и статистика службы"
        />

        {me.isPending && (
          <p className="text-sm text-muted-foreground">Загрузка профиля…</p>
        )}

        {me.isError && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Не удалось прочитать кадровую запись. Профиль показан не будет —
              подставлять сюда чужие данные нельзя.
            </CardContent>
          </Card>
        )}

        {me.data !== undefined && employee === null && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Кадровая запись не найдена</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{me.data.unlinked_reason}</p>
              <p>
                Связь заводит кадровая служба в карточке сотрудника — после
                этого профиль откроется сам.
              </p>
            </CardContent>
          </Card>
        )}

        {employee !== null && <ProfileBody employee={employee} />}

        <Card className="border-dashed bg-muted/30">
          <CardHeader>
            <CardTitle>Чего в профиле нет</CardTitle>
            <p className="text-xs text-muted-foreground">
              Блоки прототипа, которым источника в системе не нашлось
            </p>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
              {MISSING_BLOCKS.map((block) => (
                <li key={block.title} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {block.title}
                  </span>{" "}
                  — {block.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function ProfileBody({ employee }: { employee: CoreEmployee }) {
  const [tab, setTab] = useState<ProfileTab>("events");
  const directories = useCoreDirectories();
  const statuses = useEmployeeStatuses(employee.id);
  // Реестр целиком: назначения лежат ВНУТРИ мероприятий, и своего адреса
  // «назначения сотрудника» у бэка нет. Столько же грузит командный центр.
  const events = useSecurityEvents({
    search: "",
    stage: "ALL",
    page: 1,
    from: "",
    to: "",
    owner: "",
    pageSize: 100,
  });
  const shifts = useDutyShiftsAll();

  const myAssignments = useMemo(() => {
    const rows = events.data?.results ?? [];
    const mine: MyAssignment[] = [];
    for (const event of rows) {
      for (const assignment of event.placementAssignments) {
        // Сравнение по ИДЕНТИФИКАТОРУ: подписи совпадают у однофамильцев.
        if (String(assignment.employeeId) !== String(employee.id)) continue;
        const post = event.reconSectorPosts.find(
          (item) => item.id === assignment.postId
        );
        mine.push({
          event,
          post: post ?? null,
          postLabel:
            post === undefined
              ? "пост не найден в расчёте"
              : `${post.sector} · ${post.post}`,
          acknowledgedAt: assignment.acknowledgedAt,
        });
      }
    }
    return mine;
  }, [events.data, employee.id]);

  const myShifts = useMemo(
    () =>
      (shifts.data?.results ?? []).filter(
        (shift) => String(shift.employeeId) === String(employee.id)
      ),
    [shifts.data, employee.id]
  );

  return (
    <>
      <HeroCard
        employee={employee}
        rankLabel={directories.rankLabel(employee.rank_code)}
        positionLabel={directories.positionLabel(employee.position_code)}
        divisionLabel={directories.divisionLabel(employee.division)}
        statuses={statuses.data ?? []}
        statusesLoading={statuses.isPending}
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
            {TAB_LABEL[code]}
          </button>
        ))}
      </nav>

      {tab === "events" && (
        <EventsTab
          assignments={myAssignments}
          loading={events.isPending}
          failed={events.isError}
        />
      )}
      {tab === "calendar" && (
        <CalendarTab
          statuses={statuses.data ?? []}
          shifts={myShifts}
          loading={statuses.isPending}
        />
      )}
      {tab === "stats" && (
        <StatsTab
          statuses={statuses.data ?? []}
          assignments={myAssignments}
          loading={statuses.isPending || events.isPending}
        />
      )}
      {tab === "instructions" && (
        <InstructionsTab
          assignments={myAssignments}
          loading={events.isPending}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Карточка-шапка                                                      */
/* ------------------------------------------------------------------ */

function HeroCard({
  employee,
  rankLabel,
  positionLabel,
  divisionLabel,
  statuses,
  statusesLoading,
}: {
  employee: CoreEmployee;
  rankLabel: string | null;
  positionLabel: string | null;
  divisionLabel: string | null;
  statuses: OpsEmployeeStatusRow[];
  statusesLoading: boolean;
}) {
  // Текущий статус — тот, что ДЕЙСТВУЕТ по мнению сервера (`state`), а не
  // выведенный из дат в браузере: в минусовых зонах «сегодня» разъезжается.
  const active = statuses.find((row) => row.state === "ACTIVE") ?? null;
  const initials = `${employee.last_name.slice(0, 1)}${employee.first_name.slice(0, 1)}`;

  const chips: string[] = [
    employee.personnel_number === null
      ? "Табельный № — нет данных"
      : `Табельный № ${employee.personnel_number}`,
    divisionLabel ?? "подразделение не указано",
    employee.hire_date === null
      ? "дата приёма — нет данных"
      : `В службе с ${formatIsoDate(employee.hire_date)}`,
    employee.is_active ? "Числится в учёте" : "Не числится в учёте",
  ];

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
            ) : active === null ? (
              <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                действующих статусов нет
              </span>
            ) : (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary-ink">
                {STATUS_LABEL.get(active.status_type_code) ?? active.status_type_code}
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
          <p className="mt-2.5 text-[11px] text-muted-foreground">
            Служебный телефон: {employee.work_phone ?? "нет данных"} · Служебная
            почта: {employee.work_email ?? "нет данных"}
          </p>
        </div>

        <ServiceGauges />
      </CardContent>
    </Card>
  );
}

/**
 * Правая половина шапки прототипа: кольцо рейтинга и полоса готовности.
 *
 * Обе величины система НЕ СЧИТАЕТ — рейтинг ведёт своё пространство
 * идентификаторов, а правила «готовности в процентах» нет ни в справочниках,
 * ни в настройках. Место под них занято формой прототипа, но внутри стоит
 * прочерк и причина: подставить сюда правдоподобное число значило бы выдать
 * выдуманную оценку живого человека за настоящую.
 */
function ServiceGauges() {
  const RADIUS = 42;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  return (
    <div className="flex w-full shrink-0 flex-wrap items-center gap-5 border-t pt-5 lg:w-[23rem] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <div className="text-center">
        <span className="relative flex h-[104px] w-[104px] items-center justify-center">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              strokeWidth="8"
              className="stroke-muted"
              strokeDasharray={CIRCUMFERENCE}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute flex flex-col items-center leading-tight">
            <span className="text-2xl font-extrabold text-muted-foreground">—</span>
            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              Рейтинг
              <br />
              из 10
            </span>
          </span>
        </span>
        <p className="mt-1 max-w-[7rem] text-[10px] leading-tight text-muted-foreground">
          Оценки службы система не ведёт
        </p>
      </div>

      <div className="min-w-[11rem] flex-1">
        <p className="text-sm font-medium text-muted-foreground">
          Готовность к службе
        </p>
        <p className="mt-0.5 text-3xl font-extrabold tracking-tight text-muted-foreground">
          —
        </p>
        <div
          className="mt-2 h-2.5 w-full rounded-full bg-muted-foreground/15"
          role="presentation"
        />
        <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
          Процент готовности система не считает: правила, которое сводит статус
          и назначения в одно число, нет.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Вкладка «Охранные мероприятия»                                      */
/* ------------------------------------------------------------------ */

interface MyAssignment {
  event: SecurityEvent;
  /** Строка расчёта, к которой привязано назначение; null — расчёт её потерял.
   * Задача поста и есть «краткая инструкция» прототипа: своего документа-
   * инструкции в модели нет, а эта строка — то, что человеку велено делать. */
  post: ReconSectorPost | null;
  postLabel: string;
  acknowledgedAt: string | null;
}

function EventsTab({
  assignments,
  loading,
  failed,
}: {
  assignments: MyAssignment[];
  loading: boolean;
  failed: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Загрузка назначений…</p>;
  }
  if (failed) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Реестр мероприятий сейчас недоступен — назначения не показаны.
        </CardContent>
      </Card>
    );
  }
  // Граница «предстоящее / прошедшее» — по дате мероприятия и стадии: закрытое
  // ОМ не предстоит, даже если его дата ещё не наступила.
  const upcoming = assignments.filter(
    (item) => item.event.stage !== "CLOSED"
  );
  const past = assignments.filter((item) => item.event.stage === "CLOSED");

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Предстоящие назначения</CardTitle>
              <p className="text-xs text-muted-foreground">
                ОМ и посты, на которые вы назначены
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
                    key={`${item.event.id}:${item.postLabel}`}
                    item={item}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>История участия в мероприятиях</CardTitle>
              <p className="text-xs text-muted-foreground">
                Закрытые ОМ — {past.length}
              </p>
            </div>
            <Link
              href="/security-ops/events"
              className="shrink-0 text-sm font-semibold text-primary-ink hover:underline"
            >
              Вся история →
            </Link>
          </CardHeader>
          <CardContent>
            {past.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Закрытых мероприятий с вашим участием нет.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  <div className="grid grid-cols-[1.6fr_1fr_100px_180px] gap-2 rounded-md bg-muted/60 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span>Мероприятие</span>
                    <span>Пост</span>
                    <span>Дата</span>
                    <span>Ознакомление</span>
                  </div>
                  {past.map((item) => (
                    <div
                      key={`${item.event.id}:${item.postLabel}`}
                      className="grid grid-cols-[1.6fr_1fr_100px_180px] items-baseline gap-2 border-b px-3 py-2.5 last:border-0"
                    >
                      <Link
                        href={`/security-ops/events/${item.event.id}`}
                        className="truncate text-sm font-semibold hover:underline"
                      >
                        {item.event.code} — {item.event.title}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">
                        {item.postLabel}
                      </span>
                      <span className="text-xs tabular-nums">
                        {formatIsoDate(item.event.businessDate)}
                      </span>
                      <AckBadge acknowledgedAt={item.acknowledgedAt} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Часов и итога участия здесь нет: назначение расстановки не несёт
              интервалов времени, а результат службы модель не фиксирует.
            </p>
          </CardContent>
        </Card>
      </div>

      <EquipmentCard />
    </div>
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
 * «Закреплённое имущество» — блок прототипа без источника: материального учёта
 * в системе нет вовсе. Карточка стоит на своём месте раскладки, но вместо
 * выдуманных радиостанций и жилетов несёт причину — ту же, которой прототип
 * помечает блок сам («после введения цифрового склада»).
 */
function EquipmentCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Закреплённое имущество</CardTitle>
          <p className="text-xs text-muted-foreground">
            По данным материального учёта
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
          нет данных
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium leading-snug text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          Имущество будет доступно после введения цифрового склада
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Оружия, средств связи и экипировки система сейчас не хранит — ни за
          сотрудником, ни за подразделением. Список и акт приёма-передачи
          появятся здесь вместе с учётом; до тех пор строки в этом блоке были бы
          выдуманными.
        </p>
      </CardContent>
    </Card>
  );
}

/** Плитка даты назначения — как в прототипе: число крупно, месяц подписью. */
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

function AckBadge({ acknowledgedAt }: { acknowledgedAt: string | null }) {
  return acknowledgedAt === null ? (
    <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      Ознакомление не подтверждено
    </span>
  ) : (
    <span className="inline-flex w-fit rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
      Ознакомлен: {formatIsoDate(acknowledgedAt.slice(0, 10))}
    </span>
  );
}

function AssignmentRow({ item }: { item: MyAssignment }) {
  const period =
    item.event.businessDateEnd !== null &&
    item.event.businessDateEnd !== item.event.businessDate
      ? `${formatIsoDate(item.event.businessDate)} — ${formatIsoDate(item.event.businessDateEnd)}`
      : formatIsoDate(item.event.businessDate);

  return (
    <li className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <DateTile iso={item.event.businessDate} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-bold tabular-nums text-secondary-foreground">
            {item.event.code}
          </span>
          <Link
            href={`/security-ops/events/${item.event.id}`}
            className="text-sm font-semibold hover:underline"
          >
            {item.event.title}
          </Link>
          <span className="ml-auto shrink-0">
            <AckBadge acknowledgedAt={item.acknowledgedAt} />
          </span>
        </div>

        <p className="mt-1.5 text-base font-bold tracking-tight">
          {item.postLabel}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.event.objectName} · {period} · стадия:{" "}
          {STAGE_LABEL[item.event.stage]}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <p className="min-w-[14rem] flex-1 rounded-md border-l-[3px] border-primary/40 bg-muted/50 px-3 py-2 text-xs leading-snug">
            <span className="font-semibold">Краткая инструкция:</span>{" "}
            {item.post === null || item.post.task.trim() === ""
              ? "задача поста в расчёте не заполнена"
              : item.post.task}
          </p>
          <Link
            href={`/security-ops/events/${item.event.id}`}
            className="inline-flex h-9 shrink-0 items-center rounded-md border bg-background px-3.5 text-xs font-semibold shadow-sm transition-colors hover:bg-muted"
          >
            Инструкция по посту
          </Link>
        </div>
      </div>
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
function InstructionsTab({
  assignments,
  loading,
}: {
  assignments: MyAssignment[];
  loading: boolean;
}) {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Загрузка инструкций…</p>;
  }

  const open = assignments.filter((item) => item.event.stage !== "CLOSED");

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Задачи и требования по моим постам</CardTitle>
          <p className="text-xs text-muted-foreground">
            Из расчёта сил действующих мероприятий
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
          {countLabel(open.length)}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Действующих назначений нет — читать нечего.
          </p>
        ) : (
          open.map((item) => (
            <div
              key={`${item.event.id}:${item.postLabel}`}
              className="rounded-lg border p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-bold tabular-nums text-secondary-foreground">
                  {item.event.code}
                </span>
                <span className="text-sm font-semibold">{item.postLabel}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatIsoDate(item.event.businessDate)}
                </span>
              </div>
              <dl className="mt-2.5 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Задача поста
                  </dt>
                  <dd className="mt-0.5 text-xs leading-relaxed">
                    {item.post === null || item.post.task.trim() === ""
                      ? "не заполнена в расчёте"
                      : item.post.task}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Требования
                  </dt>
                  <dd className="mt-0.5 text-xs leading-relaxed">
                    {item.post === null || item.post.requirements.trim() === ""
                      ? "не заполнены в расчёте"
                      : item.post.requirements}
                  </dd>
                </div>
              </dl>
              <p className="mt-2.5">
                <AckBadge acknowledgedAt={item.acknowledgedAt} />
              </p>
            </div>
          ))
        )}
        <p className="text-[11px] text-muted-foreground">
          Подтверждение ознакомления в модели одно — с назначением целиком;
          отдельной отметки «прочитал инструкцию по посту» нет.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Вкладка «Мой календарь»                                             */
/* ------------------------------------------------------------------ */

function CalendarTab({
  statuses,
  shifts,
  loading,
}: {
  statuses: OpsEmployeeStatusRow[];
  shifts: { id: string; businessDate: string; stateCode: string; target: { safeLabel: string } }[];
  loading: boolean;
}) {
  // Хуки стоят ДО раннего выхода на загрузке — иначе между рендерами
  // разъезжается их порядок.
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const periods = useMemo(
    () =>
      [
        ...statuses.map((row) => ({
          key: `status-${row.id}`,
          title: STATUS_LABEL.get(row.status_type_code) ?? row.status_type_code,
          from: row.date_start,
          to: row.date_end,
          state: row.state,
          note: row.comment,
        })),
        ...shifts.map((shift) => ({
          key: `shift-${shift.id}`,
          title: `Дежурство · ${shift.target.safeLabel}`,
          from: shift.businessDate,
          to: shift.businessDate,
          state: shift.stateCode,
          note: "",
        })),
      ].sort((a, b) => b.from.localeCompare(a.from)),
    [statuses, shifts]
  );

  // Сетка месяца: дню приписаны СОСТОЯНИЯ покрывающих его периодов — те же
  // цвета, что у списка рядом. Сравнение ISO-строк, без арифметики дат.
  const grid = useMemo(() => {
    const pad = (value: number) => String(value).padStart(2, "0");
    const daysInMonth = new Date(
      Date.UTC(cursor.year, cursor.month + 1, 0)
    ).getUTCDate();
    const lead =
      (new Date(Date.UTC(cursor.year, cursor.month, 1)).getUTCDay() + 6) % 7;
    const cells: { iso: string; day: number; states: string[] }[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
      const states: string[] = [];
      for (const period of periods) {
        const to = period.to ?? period.from;
        if (iso >= period.from && iso <= to && !states.includes(period.state)) {
          states.push(period.state);
        }
      }
      cells.push({ iso, day, states: states.slice(0, 3) });
    }
    return { lead, cells };
  }, [cursor, periods]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Загрузка календаря…</p>;
  }

  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const shiftMonth = (delta: number) => {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  };

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.35fr_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>
              Мой календарь · {MONTH_NAME[cursor.month]} {cursor.year}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Дни с отметками моих статусов и смен
            </p>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Предыдущий месяц"
              className="grid h-8 w-8 place-items-center rounded-md border text-sm hover:bg-muted"
              onClick={() => shiftMonth(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Следующий месяц"
              className="grid h-8 w-8 place-items-center rounded-md border text-sm hover:bg-muted"
              onClick={() => shiftMonth(1)}
            >
              ›
            </button>
          </div>
        </CardHeader>
        <CardContent>
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
              <div
                key={cell.iso}
                className={
                  cell.iso === todayIso
                    ? "flex min-h-[46px] flex-col items-center rounded-md border border-primary p-1"
                    : "flex min-h-[46px] flex-col items-center rounded-md border p-1"
                }
              >
                <span className="text-[11px] font-semibold tabular-nums">
                  {cell.day}
                </span>
                <span className="mt-0.5 flex gap-0.5">
                  {cell.states.map((state) => (
                    <span
                      key={state}
                      title={STATE_LABEL[state] ?? state}
                      className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state] ?? "bg-muted-foreground"}`}
                    />
                  ))}
                </span>
              </div>
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Мои периоды</CardTitle>
          <p className="text-xs text-muted-foreground">
            Статусы и смены дежурств; состояние каждой строки задаёт сервер
          </p>
        </CardHeader>
        <CardContent>
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ни статусов, ни смен за вами не числится.
          </p>
        ) : (
          <ul className="space-y-1">
            {periods.map((period) => (
              <li
                key={period.key}
                className="flex flex-wrap items-baseline gap-2 border-b py-2 text-sm last:border-0"
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    STATE_DOT[period.state] ?? "bg-muted-foreground"
                  }`}
                />
                <span className="flex-1">{period.title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {period.from === period.to
                    ? period.from
                    : `${period.from} — ${period.to}`}
                </span>
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {STATE_LABEL[period.state] ?? period.state}
                </span>
                {period.note !== "" && (
                  <span className="w-full text-[11px] text-muted-foreground">
                    {period.note}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Пересечения периодов здесь не помечаются: их считает служба дежурств
          по своей политике конфликтов, и второй счёт разошёлся бы с ней.
        </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Вкладка «Моя статистика»                                            */
/* ------------------------------------------------------------------ */

function StatsTab({
  statuses,
  assignments,
  loading,
}: {
  statuses: OpsEmployeeStatusRow[];
  assignments: MyAssignment[];
  loading: boolean;
}) {
  const distribution = useMemo(() => {
    // Считаются ДНИ статуса, а не строки: неделя отпуска и день отпуска — не
    // одно и то же, а строк у них поровну. Отменённые не учитываются: они
    // означают, что периода не было.
    const days = new Map<string, number>();
    for (const row of statuses) {
      if (row.state === "CANCELLED") continue;
      const from = new Date(`${row.date_start}T00:00:00Z`).getTime();
      const to = new Date(`${row.date_end}T00:00:00Z`).getTime();
      const span = Math.max(1, Math.round((to - from) / 86_400_000) + 1);
      const label = STATUS_LABEL.get(row.status_type_code) ?? row.status_type_code;
      days.set(label, (days.get(label) ?? 0) + span);
    }
    const rows = [...days.entries()].sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((sum, [, value]) => sum + value, 0);
    return { rows, total };
  }, [statuses]);

  const posts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of assignments) {
      counts.set(item.postLabel, (counts.get(item.postLabel) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [assignments]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Загрузка статистики…</p>;
  }

  const acknowledged = assignments.filter(
    (item) => item.acknowledgedAt !== null
  ).length;

  return (
    <div className="space-y-4">
      <section
        role="group"
        aria-label="Показатели службы"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <StatCard
          label="Участие в ОМ"
          value={String(new Set(assignments.map((item) => item.event.id)).size)}
          caption="мероприятий с вашим назначением"
          tone="info"
        />
        <StatCard
          label="Назначений на посты"
          value={String(assignments.length)}
          caption="строк расстановки"
        />
        <StatCard
          label="Ознакомлено"
          value={String(acknowledged)}
          caption={`из ${assignments.length} назначений`}
          tone="success"
        />
        <StatCard
          label="Дней под статусом"
          value={String(distribution.total)}
          caption="по всем неотменённым строкам"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Статистика статусов</CardTitle>
            <p className="text-xs text-muted-foreground">
              Дни по всем строкам, кроме отменённых
            </p>
          </CardHeader>
          <CardContent>
            {distribution.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Строк статусов за вами не числится.
              </p>
            ) : (
              <ul className="space-y-3">
                {distribution.rows.map(([label, value]) => (
                  <li
                    key={label}
                    className="grid grid-cols-[minmax(110px,175px)_1fr_auto] items-center gap-3"
                  >
                    <span className="text-sm leading-tight">{label}</span>
                    <span className="block h-2 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{
                          width: `${(value / distribution.total) * 100}%`,
                        }}
                      />
                    </span>
                    <span className="text-right text-xs tabular-nums text-muted-foreground">
                      {value} дн. ·{" "}
                      {((value / distribution.total) * 100)
                        .toFixed(1)
                        .replace(".", ",")}
                      %
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Топ постов</CardTitle>
            <p className="text-xs text-muted-foreground">
              Где вас чаще всего ставили в расчёт
            </p>
          </CardHeader>
          <CardContent>
            {posts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Назначений на посты не было.
              </p>
            ) : (
              <ol className="space-y-3">
                {posts.map(([label, count], index) => (
                  <li
                    key={label}
                    className="grid grid-cols-[24px_1fr] items-start gap-2.5"
                  >
                    <b className="grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary-ink">
                      {index + 1}
                    </b>
                    <span className="min-w-0">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold">
                          {label}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      </span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${(count / posts[0][1]) * 100}%` }}
                        />
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

