"use client";

/**
 * «Сбор сил на ОМ» — кто отдан на охранные мероприятия и кто ещё остался.
 *
 * Экран отвечает на ОДИН вопрос штаба: мероприятие требует людей, департаменты
 * отдают сколько могут, и надо видеть, чем добирать. Поэтому здесь рядом стоят
 * ЗАЯВКИ (сколько запрошено и сколько выделено по мероприятиям) и ЛЮДИ
 * (поимённо, по управлениям) — одно без другого не читается: дефицит без
 * остатка не подсказывает, где брать, а остаток без дефицита не говорит, зачем.
 *
 * СВОЕГО СЧЁТА ЛИЧНОГО СОСТАВА ЗДЕСЬ НЕТ. Штат, список и колонки состояний
 * приходят из расхода — владельца этих чисел. Считается на экране ровно одно,
 * и только потому, что расход этого не даёт: «Привлечён на мероприятие»
 * ложится в его колонку «В строю» (`report_column_code`), то есть привлечённые
 * и оставшиеся в расходе неразличимы. Разделяет их поимённый разрез статусов —
 * и разделение названо на экране словами, а не подсунуто молча.
 */

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { Users } from "lucide-react";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useForcesGathering } from "@/hooks/use-forces-gathering";
import type { GatheringPerson } from "@/hooks/use-forces-gathering";
import { LoadFailure } from "@/components/load-failure";
import { formatIsoDate } from "@/shared/lib/date";
import type { SecurityEvent } from "@/entities/security-event";

const REQUEST_STATUS_LABEL: Record<string, string> = {
  NOT_SENT: "Не отправлен",
  SENT: "Отправлен",
  PARTIALLY_ALLOCATED: "Выделено частично",
  ALLOCATED: "Выделено полностью",
};

const REQUEST_STATUS_CLASS: Record<string, string> = {
  NOT_SENT: "bg-gray-100 text-gray-800",
  SENT: "bg-blue-100 text-blue-800",
  PARTIALLY_ALLOCATED: "bg-amber-100 text-amber-800",
  ALLOCATED: "bg-green-100 text-green-800",
};

export default function ForcesGatheringPage() {
  // useSearchParams требует границы Suspense — иначе пререндер падает на сборке.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ForcesGatheringScreen />
    </Suspense>
  );
}

/** Сводка одного сбора: сколько запрошено расчётом и сколько уже выделено. */
function eventTotals(event: SecurityEvent): {
  requested: number;
  allocated: number;
  percent: number;
} {
  let requested = 0;
  let allocated = 0;
  for (const request of event.forceRequests) {
    requested += request.requestedCount;
    allocated += request.allocatedCount;
  }
  // Знаменатель — сумма запросов, она же `forceNeed`: сервер пишет оба числа
  // из ОДНИХ строк утверждённого расчёта, разойтись они не могут.
  const percent = requested === 0 ? 0 : Math.round((allocated / requested) * 100);
  return { requested, allocated, percent };
}

function ForcesGatheringScreen() {
  const gathering = useForcesGathering();

  // Мероприятия на стадии «Запрос сил» — те, ради которых сбор и идёт.
  const events = useSecurityEvents({
    search: "",
    stage: "FORCES",
    from: "",
    to: "",
    owner: "",
    page: 1,
    pageSize: 50,
  });

  const rows = useMemo(() => events.data?.results ?? [], [events.data]);
  const demand = useMemo(() => {
    let requested = 0;
    let allocated = 0;
    for (const event of rows) {
      const totals = eventTotals(event);
      requested += totals.requested;
      allocated += totals.allocated;
    }
    return { requested, allocated };
  }, [rows]);

  // Вкладка живёт в АДРЕСЕ: ссылкой на «оставшихся» можно поделиться, и
  // возврат на экран не сбрасывает выбор.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "in-service" ? "in-service" : "assigned";
  const selectTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "assigned") next.delete("tab");
    else next.set("tab", value);
    const query = next.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, {
      scroll: false,
    });
  };

  // «Осталось в строю» — колонка расхода МИНУС привлечённые: справочник кладёт
  // участие в ОМ в ту же колонку, и без вычитания одни и те же люди считались
  // бы дважды — как отданные и как свободные разом.
  const remaining = Math.max(
    0,
    gathering.inServiceColumn - gathering.assigned.length
  );

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Сбор сил на ОМ"
          description="Кого департаменты отдали на мероприятия и кто остался в строю"
          actions={
            // Реестр кадров переехал на подадрес, когда модуль стал сбором
            // сил: заводить сотрудника и открывать его карточку по-прежнему
            // нужно, и вход туда обязан быть виден.
            <Link
              href="/employees/registry"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Реестр личного состава
            </Link>
          }
        />

        {gathering.isError && (
          <LoadFailure what="личный состав: расход и статусы раздела не ответили" />
        )}

        {/* Знаменатели — из расхода; на экране они не пересчитываются. */}
        <section
          role="group"
          aria-label="Личный состав на сбор"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          <Metric
            label="По штату"
            value={gathering.staffTotal}
            hint="Штатных единиц по расходу"
          />
          <Metric
            label="По списку"
            value={gathering.listTotal}
            hint="Занятых слотов — вакансии сюда не входят"
          />
          <Metric
            label="В строю"
            value={gathering.inServiceColumn}
            hint="Колонка расхода: и оставшиеся, и уже привлечённые"
          />
          <Metric
            label="Участие в ОМ"
            value={gathering.assigned.length}
            hint="Поимённо по статусу — расход их отдельно не считает"
            accent
          />
          <Metric
            label="Осталось в строю"
            value={remaining}
            hint="«В строю» минус привлечённые: иначе они считались бы дважды"
          />
        </section>

        {/* Заявки: план против факта. Это ответ на вопрос «чем добирать» —
            дефицит виден по мероприятию и по департаменту разом. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Запрос сил по мероприятиям
              </span>
              {demand.requested > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  выделено {demand.allocated} из {demand.requested}
                  {demand.allocated < demand.requested && (
                    <> · недобор {demand.requested - demand.allocated}</>
                  )}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {events.isPending && (
              <p className="text-xs text-muted-foreground">Загрузка сборов…</p>
            )}
            {events.isError && (
              <p className="text-xs text-muted-foreground">
                Реестр мероприятий сейчас недоступен.
              </p>
            )}
            {events.data && rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Мероприятий на стадии «Запрос сил» нет — собирать не под что.
              </p>
            )}
            {rows.map((event) => {
              const totals = eventTotals(event);
              const gap = totals.requested - totals.allocated;
              return (
                <div key={event.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatIsoDate(event.businessDate)} · {event.objectName}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {totals.allocated} из {totals.requested} · {totals.percent}%
                      {gap > 0 && (
                        <span className="ml-2 font-semibold text-amber-700">
                          недобор {gap}
                        </span>
                      )}
                    </p>
                  </div>
                  <Progress value={totals.percent} className="h-2" />
                  {event.forceRequests.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {event.forceRequests.map((request) => {
                        const short = request.requestedCount - request.allocatedCount;
                        return (
                          <li
                            key={request.id}
                            className="flex flex-wrap items-baseline gap-2 border-b py-1 text-xs last:border-0"
                          >
                            <span className="flex-1 truncate">{request.group}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {request.allocatedCount} из {request.requestedCount}
                            </span>
                            {/* Недодача названа у КАЖДОЙ строки, а не только в
                                сумме: сумма говорит «сколько», строка — «с кого». */}
                            {short > 0 && (
                              <span className="tabular-nums font-semibold text-amber-700">
                                не отдано {short}
                              </span>
                            )}
                            <Badge
                              variant="secondary"
                              className={
                                REQUEST_STATUS_CLASS[request.status] ??
                                "bg-gray-100 text-gray-800"
                              }
                            >
                              {REQUEST_STATUS_LABEL[request.status] ?? request.status}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground">
              Довыделение отдельной строкой раздел пока не хранит: заявка
              департаменту одна, и увеличение выделения переписывает её же —
              истории «кто закрыл чужой недобор» из этих данных не построить.
            </p>
          </CardContent>
        </Card>

        {/* Люди. Две вкладки — отданные и оставшиеся; больше делить нечем:
            остальные состояния (отпуск, больничный, командировка) на сбор не
            выставляются вовсе и потому не показываются ни в одной. */}
        <Tabs value={tab} onValueChange={selectTab}>
          <TabsList>
            <TabsTrigger value="assigned">
              Участие в ОМ ({gathering.assigned.length})
            </TabsTrigger>
            <TabsTrigger value="in-service">
              В строю ({gathering.inService.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assigned">
            <PeopleByDivision
              people={gathering.assigned}
              isPending={gathering.isPending}
              empty="Со статусом «Участие в ОМ» сегодня никого нет: на мероприятия ещё никого не выставили."
            />
          </TabsContent>

          <TabsContent value="in-service">
            <PeopleByDivision
              people={gathering.inService}
              isPending={gathering.isPending}
              empty="В строю сегодня никого: весь личный состав либо на мероприятиях, либо отсутствует."
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function Metric({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      data-slot="stat-card"
      className={`rounded-xl border p-3 ${accent ? "bg-amber-50 border-amber-200" : "bg-card"}`}
    >
      <div data-slot="stat-label" className="text-xs text-muted-foreground">
        {label}
      </div>
      <div
        data-slot="stat-value"
        className="mt-1 text-2xl font-extrabold tabular-nums"
      >
        {value}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Люди, РАЗДЕЛЁННЫЕ ПО УПРАВЛЕНИЯМ: сбор идёт с департаментов, и общий
 * алфавитный список не отвечал бы на вопрос «у кого ещё есть кем закрыть». */
function PeopleByDivision({
  people,
  isPending,
  empty,
}: {
  people: GatheringPerson[];
  isPending: boolean;
  empty: string;
}) {
  const groups = useMemo(() => {
    const byDivision = new Map<number, { name: string; people: GatheringPerson[] }>();
    for (const person of people) {
      const group = byDivision.get(person.divisionId) ?? {
        name: person.divisionName,
        people: [],
      };
      group.people.push(person);
      byDivision.set(person.divisionId, group);
    }
    return [...byDivision.entries()].sort((left, right) =>
      left[1].name.localeCompare(right[1].name, "ru")
    );
  }, [people]);

  if (isPending) {
    return (
      <p className="p-4 text-xs text-muted-foreground">Загрузка личного состава…</p>
    );
  }
  if (groups.length === 0) {
    return <p className="p-4 text-xs text-muted-foreground">{empty}</p>;
  }

  return (
    <div className="space-y-3">
      {groups.map(([divisionId, group]) => (
        <Card key={divisionId}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{group.name}</span>
              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                {group.people.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {group.people.map((person) => (
                <li
                  key={person.employeeId}
                  className="flex flex-wrap items-baseline gap-2 border-b py-1 text-xs last:border-0"
                >
                  <span className="flex-1 truncate">{person.fullName}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {person.rankCode}
                  </span>
                  {/* Статус называется словом справочника; «в строю» у
                      человека без статуса — вывод, а не факт, и так и сказано. */}
                  <span className="shrink-0 text-muted-foreground">
                    {person.statusLabel ?? "статуса нет — считается в строю"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
