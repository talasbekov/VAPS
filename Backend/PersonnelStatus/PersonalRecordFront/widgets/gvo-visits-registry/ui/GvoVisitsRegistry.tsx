"use client";

// Вкладка «Визиты иностранных ОЛ» в реестре ОМ (Plane «Реестр ОМ-35.8»).
//
// Заказчик снял модуль «Реестр ГВО» из меню, но сводный взгляд оставил:
// «список „кто едет“ никуда не девается — он становится вкладкой внутри
// Реестра ОМ». Поэтому таблица переехала сюда целиком, а не была написана
// заново: колонки, подписи и пины проб те же.
//
// Отбор — `kind !== "INTERNAL"`, то же правило, что у кнопки «Информация по
// ГВО» (`ОМ-35.5`): у внутреннего ОМ выездной охраны нет, а ОМ без типа
// (заведённое до появления поля) из вкладки не выпадает — иначе его сводка
// стала бы недостижимой.
import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useGvoSummaries, summariesByCode } from "@/hooks/use-gvo-summaries";
import { useAuth } from "@/lib/auth";
import { StageBadge } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import {
  gvoSenior,
  gvoStaffCount,
  UNSPECIFIED,
} from "@/entities/gvo-summary";
import type { GvoSummaryRow } from "@/entities/gvo-summary";

// Вкладка не листается: сводки смотрят по всем визитам сразу, а фильтр здесь
// один — «Мои / Все».
const PAGE_SIZE = 200;

type Scope = "mine" | "all";

function pluralEvents(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (ones === 1 && tens !== 11) return "мероприятие";
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return "мероприятия";
  return "мероприятий";
}

export function GvoVisitsRegistry() {
  const { user } = useAuth();
  const [scope, setScope] = useState<Scope>("all");

  const eventsQuery = useSecurityEvents({
    search: "",
    stage: "ALL",
    from: "",
    to: "",
    owner: "",
    page: 1,
    pageSize: PAGE_SIZE,
  });
  // Сводки приходят СОБРАННЫМИ с сервера, одним запросом на весь реестр
  // (Plane №166): раньше каждая строка выводила базу из бюллетеня в браузере.
  const summariesQuery = useGvoSummaries({ enabled: true });

  const summaries = summariesByCode(summariesQuery.data);
  const visits = (eventsQuery.data?.results ?? []).filter(
    (event) => event.kind !== "INTERNAL"
  );
  // «Моё мероприятие» — то, где текущий пользователь ответственный. Без
  // host-логина владельца определить нечем, и фильтр честно отдаёт пустой
  // список, а не весь реестр под видом «моих».
  const mine = visits.filter(
    (event) => user !== null && event.ownerName === user.name
  );
  const visible = scope === "mine" ? mine : visits;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="inline-flex gap-[3px] rounded-[9px] bg-muted p-[3px]">
          {(
            [
              ["mine", "Мои"],
              ["all", "Все"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={
                scope === value
                  ? "h-[30px] rounded-[7px] bg-card px-3 text-[12.5px] font-semibold shadow-sm"
                  : "h-[30px] rounded-[7px] px-3 text-[12.5px] font-semibold text-muted-foreground"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-muted-foreground">
          {visible.length} {pluralEvents(visible.length)} с иностранным ОЛ
        </span>
      </div>

      <RegistryTable
        isLoading={eventsQuery.isLoading || summariesQuery.isLoading}
        // Отказ ЛЮБОГО из двух источников — отказ таблицы. Без сводок каждая
        // строка показала бы «Черновик» и пустого старшего, то есть таблица
        // выглядела бы полной и врала бы в каждой строке.
        isError={eventsQuery.isError || summariesQuery.isError}
        events={visible}
        summaries={summaries}
        emptyText={
          scope === "mine" && user === null
            ? "Владелец мероприятия определяется по учётной записи — войдите, чтобы увидеть свои"
            : "Мероприятий с иностранным охраняемым лицом нет"
        }
      />
    </div>
  );
}

function RegistryTable({
  isLoading,
  isError,
  events,
  summaries,
  emptyText,
}: {
  isLoading: boolean;
  isError: boolean;
  events: SecurityEvent[];
  summaries: Record<string, GvoSummaryRow>;
  emptyText: string;
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
          Не удалось загрузить реестр ГВО. Попробуйте обновить страницу.
        </CardContent>
      </Card>
    );
  }
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="p-9 text-center text-[13px] text-muted-foreground">
          {emptyText}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="overflow-x-auto">
      <Table className="min-w-[1020px]">
        <TableHeader>
          <TableRow>
            <TableHead>Мероприятие</TableHead>
            <TableHead>Страна · охраняемые лица</TableHead>
            <TableHead>Прибытие → убытие</TableHead>
            <TableHead>Старший ГВО</TableHead>
            <TableHead>Состав</TableHead>
            <TableHead>Сводка</TableHead>
            <TableHead>
              <span className="sr-only">Открыть сводку</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => {
            const row = summaries[event.code];
            // Строки нет — сводку по этому ОМ сервер не прислал. Так бывает у
            // мероприятия, заведённого между двумя запросами; показывать
            // вместо неё выведенный черновик нечем, и строка честно говорит
            // «нет сведений», а не притворяется заполненной.
            const summary = row?.summary;
            const filled = row?.filled ?? false;
            const staff = summary === undefined ? 0 : gvoStaffCount(summary);
            // Ведём в КАРТОЧКУ мероприятия с раскрытой панелью, а не на свой
            // экран сводки: модуля больше нет, сводка живёт в карточке
            // («Реестр ОМ-35.4»), и `?gvo=1` открывает панель сразу — человек
            // нажал именно на сводку, второе нажатие было бы платой за
            // переезд.
            // Отдельная страница визита (`[ГВО-01]`, Plane №436): у визита
            // своя карточка, панель в карточке ОМ остаётся до №441.
            const href = `/security-ops/visits/${event.id}`;
            const eventCell = (
              <TableCell>
                <Link href={href} className="block">
                  <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800">
                    {event.code}
                  </span>
                  <span className="mt-1 block text-[12.5px] font-semibold">
                    {event.title}
                  </span>
                  <span className="mt-1 inline-flex">
                    <StageBadge stage={event.stage} />
                  </span>
                </Link>
              </TableCell>
            );
            if (summary === undefined) {
              return (
                <TableRow key={event.id}>
                  {eventCell}
                  <TableCell
                    colSpan={6}
                    className="text-[12.5px] text-destructive-ink"
                  >
                    Сводка по этому мероприятию не получена
                  </TableCell>
                </TableRow>
              );
            }
            return (
              <TableRow key={event.id}>
                {eventCell}
                <TableCell className="text-[12.5px]">
                  <span className="block font-semibold text-foreground">
                    {summary.country}
                  </span>
                  <span className="block text-muted-foreground">
                    {summary.persons.length > 0
                      ? summary.persons.map((person) => person.name).join(", ")
                      : UNSPECIFIED}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground">
                  {summary.arrival.date} → {summary.departure.date}
                </TableCell>
                <TableCell className="text-[12.5px]">{gvoSenior(summary)}</TableCell>
                <TableCell className="text-[12.5px] tabular-nums">
                  {staff > 0 ? `${staff} чел.` : UNSPECIFIED}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      filled
                        ? "inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800"
                        : "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                    }
                  >
                    {filled ? "Заполнена" : "Черновик"}
                  </span>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">
                  <Link href={href} aria-label={`Сводные данные ${event.code}`}>
                    ›
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
