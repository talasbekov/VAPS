"use client";

/**
 * «Сбор сил на ОМ» — экран актуального прототипа (`view: "forces"`).
 *
 * Разрез, которого не делает ни один существующий экран: НЕ одно мероприятие,
 * а ВСЕ, стоящие на сборе, разом. Внутри карточки ОМ те же запросы сил уже
 * видны (`PlacementStage`), но там они про одно мероприятие, а вопрос сбора —
 * «где мы недобираем прямо сейчас» — задаётся сразу по реестру.
 *
 * В цепочку карточки ОМ этот экран не входит и в прототипе: `lifecycleViews`
 * его не содержит, он отдельный пункт навигации. Тем и отличается от
 * «Расстановки», для которой отдельный маршрут был бы дублем.
 */

import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronRight, Flag } from "lucide-react";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useUpdateForceAllocation } from "@/hooks/use-security-event-stages";
import { LoadFailure } from "@/components/load-failure";
import { formatIsoDate } from "@/shared/lib/date";
import type { SecurityEvent } from "@/entities/security-event";

/** Сводка по одному сбору: сколько запрошено и сколько уже выделено. */
function totals(event: SecurityEvent): {
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
  // Знаменатель — сумма запросов. Она же равна `forceNeed`: сервер пишет оба
  // числа из ОДНИХ строк утверждённого расчёта (`security_events.py`, там же,
  // где создаются запросы), поэтому разойтись они не могут. Показывать их
  // двумя плитками значило бы дважды напечатать одно число.
  const percent =
    requested === 0 ? 0 : Math.round((allocated / requested) * 100);
  return { requested, allocated, percent };
}

const STATUS_LABEL: Record<string, string> = {
  NOT_SENT: "Не отправлен",
  SENT: "Отправлен",
  PARTIALLY_ALLOCATED: "Выделено частично",
  ALLOCATED: "Выделено полностью",
};

const STATUS_CLASS: Record<string, string> = {
  NOT_SENT: "bg-gray-100 text-gray-800",
  SENT: "bg-blue-100 text-blue-800",
  PARTIALLY_ALLOCATED: "bg-amber-100 text-amber-800",
  ALLOCATED: "bg-green-100 text-green-800",
};

export default function ForcesPage() {
  // useSearchParams требует границы Suspense — иначе пререндер падает на сборке.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ForcesScreen />
    </Suspense>
  );
}

function ForcesScreen() {
  // Выбранный сбор живёт в АДРЕСЕ — как на девяти соседних экранах раздела:
  // ссылкой на конкретный сбор можно поделиться, и возврат из карточки не
  // теряет место.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("event") ?? "";

  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      if (id === "") next.delete("event");
      else next.set("event", id);
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`, {
        scroll: false,
      });
    },
    [router, pathname, searchParams]
  );

  const query = useSecurityEvents({
    search: "",
    stage: "FORCES",
    from: "",
    to: "",
    owner: "",
    page: 1,
    pageSize: 50,
  });

  const events = useMemo(() => query.data?.results ?? [], [query.data]);
  const selected = events.find((event) => event.id === selectedId) ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">
              Охранные мероприятия
            </p>
            <h1 className="text-3xl font-bold text-foreground">
              Сбор сил на ОМ
            </h1>
            <p className="text-muted-foreground mt-1">
              Мероприятия на стадии «Запрос сил»: сколько личного состава
              запрошено расчётом и сколько уже выделено
            </p>
          </div>
        </div>

        {/* Чего на этом экране нет и почему — строкой, а не пустыми ячейками. */}
        <p className="text-xs text-muted-foreground">
          Экран показывает выделенную ЧИСЛЕННОСТЬ по группам расчёта. Поимённого
          состава здесь нет: люди появляются на расстановке, а запрос сил хранит
          количество. Срока сбора и рассылки разнарядки бэк не ведёт, а группа
          расчёта — свободная строка, не подразделение, поэтому разделения на
          штаб и брокера департамента здесь тоже нет.
        </p>

        {query.isError && (
          <LoadFailure
            what="список сборов"
            onRetry={() => void query.refetch()}
            isRetrying={query.isFetching}
            className="rounded-xl border bg-card px-4"
          />
        )}

        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Загрузка сборов…</p>
        )}

        {!query.isLoading && !query.isError && selected === null && (
          <ForcesList events={events} onSelect={select} />
        )}

        {selected !== null && (
          <ForcesDetail event={selected} onBack={() => select("")} />
        )}
      </div>
    </DashboardLayout>
  );
}

function ForcesList({
  events,
  onSelect,
}: {
  events: SecurityEvent[];
  onSelect: (id: string) => void;
}) {
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Flag className="mx-auto mb-2 h-8 w-8 opacity-50" aria-hidden="true" />
          Активных сборов нет — ни одно мероприятие не стоит на стадии «Запрос
          сил».
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Сборы в работе</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Мероприятие</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead className="text-right">Запрошено</TableHead>
                <TableHead className="w-56">Прогресс сбора</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => {
                const sum = totals(event);
                return (
                  <TableRow
                    key={event.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(event.id)}
                  >
                    <TableCell>
                      <Badge variant="secondary" className="mb-1">
                        {event.code}
                      </Badge>
                      <div className="font-medium">{event.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {event.objectName}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatIsoDate(event.businessDate)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {sum.requested}
                    </TableCell>
                    <TableCell>
                      <div className="mb-1 text-xs tabular-nums">
                        {sum.allocated} из {sum.requested} · {sum.percent}%
                      </div>
                      <Progress value={sum.percent} className="h-1.5" />
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ForcesDetail({
  event,
  onBack,
}: {
  event: SecurityEvent;
  onBack: () => void;
}) {
  const sum = totals(event);
  // 🔴 Предупреждения «сумма квот не сходится с потребностью» здесь НЕТ, хотя
  // в прототипе оно есть. Оно было бы недостижимой веткой: сервер пишет
  // `force_need` и запросы из одних и тех же строк расчёта в одном месте, и
  // сойтись они не могут только вместе. Предупреждение имеет смысл там, где
  // квоты назначает человек (прототипный штаб), — а этого механизма в бэке
  // нет вовсе.

  return (
    <div className="space-y-4">
      <Button variant="link" className="h-auto p-0" onClick={onBack}>
        ← Назад к списку сборов
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{event.code}</Badge>
            <CardTitle className="text-lg">{event.title}</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            {event.objectName} · {formatIsoDate(event.businessDate)}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Плиток три, а не четыре: «Требуется по расчёту» печатала бы то же
              число, что «Запрошено» (см. довод у `totals`). */}
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Запрошено расчётом" value={sum.requested} />
            <Metric
              label="Выделено"
              value={sum.allocated}
              className="text-green-700"
            />
            <Metric
              label="Осталось выделить"
              value={Math.max(0, sum.requested - sum.allocated)}
              className="text-amber-700"
            />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Общий прогресс сбора</span>
              <b className="tabular-nums text-foreground">{sum.percent}%</b>
            </div>
            <Progress value={sum.percent} className="h-2" />
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Распределение по группам расчёта
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Группа — строка утверждённого расчёта, а не подразделение
            оргструктуры: связи с департаментами у неё нет.
          </p>
        </CardHeader>
        <CardContent>
          {event.forceRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Запросов нет — потребность не утверждена.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {event.forceRequests.map((request) => (
                <AllocationRow
                  key={request.id}
                  eventId={event.id}
                  request={request}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-extrabold tabular-nums ${className}`}>
        {value}
      </div>
    </div>
  );
}

function AllocationRow({
  eventId,
  request,
}: {
  eventId: string;
  request: SecurityEvent["forceRequests"][number];
}) {
  const [allocated, setAllocated] = useState(String(request.allocatedCount));
  const update = useUpdateForceAllocation(eventId, request.id);
  const percent =
    request.requestedCount === 0
      ? 0
      : Math.round((request.allocatedCount / request.requestedCount) * 100);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
      <span className="min-w-40 font-semibold">{request.group}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        запрошено {request.requestedCount}
      </span>
      <div className="w-40">
        <div className="mb-1 text-xs tabular-nums">
          {request.allocatedCount} из {request.requestedCount}
        </div>
        <Progress value={percent} className="h-1.5" />
      </div>
      <Badge className={STATUS_CLASS[request.status] ?? "bg-gray-100"}>
        {STATUS_LABEL[request.status] ?? request.status}
      </Badge>
      <div className="ml-auto flex items-center gap-2">
        <Input
          className="h-8 w-24 text-xs"
          type="number"
          min={0}
          aria-label={`Выделено: ${request.group}`}
          value={allocated}
          onChange={(entry) => setAllocated(entry.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={update.isPending || allocated === String(request.allocatedCount)}
          onClick={() =>
            update.mutate({
              allocatedCount: Number(allocated),
              comment: request.comment,
            })
          }
        >
          {update.isPending ? "Сохранение…" : "Выделить"}
        </Button>
      </div>
    </div>
  );
}
