"use client";

// Реестр ГВО: по строке на каждое ОМ реестра. Запись здесь не заводится
// руками — она появляется вместе с бюллетенем ОМ, поэтому кнопки «создать»
// на экране нет вовсе, а список строится поверх реестра ОМ.
import { useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useGvoPatches, patchesByCode } from "@/hooks/use-gvo-summaries";
import { useAuth } from "@/lib/auth";
import { StageBadge } from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import {
  deriveGvoSummary,
  gvoSenior,
  gvoStaffCount,
  isGvoSummaryFilled,
  mergeGvoSummary,
  UNSPECIFIED,
} from "@/entities/gvo-summary";
import type { GvoSummaryPatch } from "@/entities/gvo-summary";

// Реестр ГВО не листается: сводки смотрят по всему реестру ОМ сразу, а
// фильтр здесь один — «Мои / Все».
const PAGE_SIZE = 200;

type Scope = "mine" | "all";

function pluralEvents(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (ones === 1 && tens !== 11) return "мероприятие";
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return "мероприятия";
  return "мероприятий";
}

export default function GvoRegistryPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const { user } = useAuth();
  const [scope, setScope] = useState<Scope>("all");

  const canView = hasPermission("event.view");
  const eventsQuery = useSecurityEvents(
    { search: "", stage: "ALL", from: "", to: "", owner: "", page: 1, pageSize: PAGE_SIZE },
    { enabled: canView }
  );
  const patchesQuery = useGvoPatches({ enabled: canView });

  if (!permissionsLoading && !canView) {
    return <OpsAccessDenied what="реестра ГВО" />;
  }

  const patches = patchesByCode(patchesQuery.data);
  const events = eventsQuery.data?.results ?? [];
  // «Моё мероприятие» — то, где текущий пользователь ответственный. Без
  // host-логина (раздел открыт и анониму) владельца определить нечем, и
  // фильтр честно отдаёт пустой список, а не весь реестр под видом «моих».
  const mine = events.filter(
    (event) => user !== null && event.ownerName === user.name
  );
  const visible = scope === "mine" ? mine : events;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <header>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-primary">
            Охранные мероприятия
          </p>
          <h1 className="text-[25px] font-bold leading-[1.15] tracking-[-0.02em]">
            Реестр ГВО
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Сводные данные по каждому ОМ — запись появляется сразу после создания
            бюллетеня
          </p>
        </header>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="inline-flex gap-[3px] rounded-[9px] bg-[hsl(210_40%_93%)] p-[3px]">
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
            {visible.length} {pluralEvents(visible.length)} из реестра ОМ
          </span>
        </div>

        <RegistryTable
          isLoading={eventsQuery.isLoading || patchesQuery.isLoading}
          isError={eventsQuery.isError}
          events={visible}
          patches={patches}
          emptyText={
            scope === "mine" && user === null
              ? "Владелец мероприятия определяется по учётной записи — войдите, чтобы увидеть свои"
              : "В этой категории мероприятий нет"
          }
        />
      </div>
    </DashboardLayout>
  );
}

function RegistryTable({
  isLoading,
  isError,
  events,
  patches,
  emptyText,
}: {
  isLoading: boolean;
  isError: boolean;
  events: SecurityEvent[];
  patches: Record<string, GvoSummaryPatch>;
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
        <CardContent className="p-9 text-center text-sm text-destructive">
          Не удалось загрузить реестр ОМ. Попробуйте обновить страницу.
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
            const patch = patches[event.code];
            const summary = mergeGvoSummary(deriveGvoSummary(event), patch);
            const filled = isGvoSummaryFilled(patch);
            const staff = gvoStaffCount(summary);
            const href = `/security-ops/gvo/${event.id}`;
            return (
              <TableRow key={event.id}>
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
