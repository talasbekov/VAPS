"use client";

// Реестр ОМ владеет этапами, конфликтами и запросами сил; текущий расход —
// численностью и деловой датой. Условные проценты этапов не используются.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  ShieldCheck,
  Users,
  UserMinus,
} from "lucide-react";
import { useAllSecurityEvents } from "@/hooks/use-all-security-events";
import { useStrengthReport } from "@/hooks/use-strength-report";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { MODULE_PERMISSION, moduleOpenFor } from "@/entities/portal-access";
import { CreateSecurityEventDialog } from "@/features/create-security-event";
import { OpsKpiCards } from "@/widgets/ops-kpi-cards";
import type { OpsKpiItem } from "@/widgets/ops-kpi-cards";
import {
  STAGE_LABEL,
  STAGE_BADGE_CLASS,
} from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { formatIsoDate, localIsoDate } from "@/shared/lib/date";

/** Код колонки «в строю» в расходе. Проверен по ответу живого бэка
 * (`/api/operations/strength-report/`) — тот же код, что у сетки дня. */
const IN_SERVICE_COLUMN = "IN_SERVICE";

function requestGap(event: SecurityEvent): number {
  return event.forceRequests.reduce((sum, request) =>
    sum + Math.max(0, request.requestedCount - request.allocatedCount), 0);
}

export default function CommandCenterPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const canReadEvents = !permissionsLoading && hasPermission(MODULE_PERMISSION["/security-ops/command-center"]);
  const canCreate = canReadEvents && hasPermission("event.create");
  // KPI and the earliest five events require every registry page.
  const query = useAllSecurityEvents({ enabled: canReadEvents });
  const canReadStrength = canReadEvents && hasPermission("status.view");
  const strength = useStrengthReport(canReadStrength);
  useEffect(() => { if (!canCreate) setDialogOpen(false); }, [canCreate]);

  const events = useMemo(() => canReadEvents && !query.isError ? query.data ?? [] : [], [canReadEvents, query.data, query.isError]);

  /** Численность из расхода. null — расход не прочитан (подпись объясняет
   * причину: незагруженные права это ещё не отказ). */
  const personnel = useMemo(() => {
    const report = canReadStrength ? strength.data : undefined;
    if (report === undefined) return null;
    const staff = report.rows.reduce((sum, row) => sum + row.staff_total, 0);
    const list = report.rows.reduce((sum, row) => sum + row.list_total, 0);
    // Колонки задаёт сервер: нет колонки «в строю» — показываем прочерк, а не
    // ноль. Ноль здесь читался бы как «в строю никого».
    const inService = report.columns.includes(IN_SERVICE_COLUMN)
      ? report.rows.reduce(
          (sum, row) => sum + (row.columns[IN_SERVICE_COLUMN] ?? 0),
          0
        )
      : null;
    return { staff, list, inService };
  }, [canReadStrength, strength.data]);

  const strengthGap =
    permissionsLoading || strength.isLoading
      ? "загрузка расхода…"
      : !canReadStrength
        ? "нужно право «Статусы: просмотр»"
        : strength.isError || personnel === null
          ? "расход недоступен"
          : null;

  const kpi = useMemo<OpsKpiItem[]>(() => {
    const active = events.filter((e) => e.stage !== "CLOSED");
    const attention = active.filter((e) => e.conflictsCount > 0);
    // Дефицит — незакрытая часть запросов сил по НЕЗАВЕРШЁННЫМ ОМ. Перевыдача
    // (выделили больше запрошенного) дефицит не гасит: отрицательные слагаемые
    // прятали бы нехватку в соседнем мероприятии.
    let deficit = 0;
    let deficitEvents = 0;
    for (const event of active) {
      const gap = requestGap(event);
      if (gap > 0) {
        deficit += gap;
        deficitEvents += 1;
      }
    }
    return [
      {
        key: "personnel",
        label: "Штатных единиц",
        value: strengthGap === null ? String(personnel!.staff) : "—",
        hint: strengthGap ?? `${personnel!.list} по списку`,
        icon: Users,
        iconClass: "text-primary-ink",
      },
      {
        key: "in-service",
        label: "В строю, чел.",
        value:
          strengthGap !== null || personnel!.inService === null
            ? "—"
            : String(personnel!.inService),
        hint:
          strengthGap ??
          (personnel!.inService === null
            ? "в расходе нет колонки «в строю»"
            : "По данным текущего расхода"),
        icon: ShieldCheck,
        iconClass: "text-green-600",
      },
      {
        key: "active",
        label: "Незавершённые ОМ",
        value: String(active.length),
        hint:
          attention.length === 0
            ? "По данным реестра · конфликтов нет"
            : `${attention.length} ОМ с конфликтами`,
        icon: Activity,
        iconClass: attention.length > 0 ? "text-red-600" : "text-primary-ink",
      },
      {
        key: "deficit",
        label: "Недобор по заявкам",
        value: String(deficit),
        hint: `Чел.: запрошено − выделено, минимум 0 по заявке · ${deficitEvents} ОМ`,
        icon: deficit > 0 ? UserMinus : AlertTriangle,
        iconClass: deficit > 0 ? "text-amber-600" : "text-muted-foreground",
      },
    ];
  }, [events, personnel, strengthGap]);

  // Отметка свежести рисуется ТОЛЬКО после монтирования: время последнего
  // ответа на сервере и в браузере разное, и печать его прямо в разметке
  // давала бы hydration mismatch (тот же дефект чинили на /dashboard).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const updatedAt = canReadEvents && !query.isError ? query.dataUpdatedAt : 0;
  const freshness =
    mounted && updatedAt > 0
      ? `реестр прочитан в ${new Date(updatedAt).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : null;
  const refreshing = query.isFetching || strength.isFetching;

  // The default strength response carries the server's business date. An
  // event-only reader uses an explicitly labelled device date for grouping.
  const expenseDate = canReadStrength && !strength.isError ? strength.data?.business_date : undefined;
  const groupingDate = expenseDate ?? (mounted ? localIsoDate() : null);
  const unfinished = useMemo(() => [...events].filter(event => event.stage !== "CLOSED")
    .sort((left, right) => left.businessDate.localeCompare(right.businessDate)), [events]);
  const upcoming = groupingDate === null ? [] : unfinished.filter(event => (event.businessDateEnd ?? event.businessDate) >= groupingDate);
  const overdue = groupingDate === null ? [] : unfinished.filter(event => (event.businessDateEnd ?? event.businessDate) < groupingDate).reverse();
  const summaryOpen = moduleOpenFor("/security-ops/service-summary", hasPermission);

  if (!permissionsLoading && !hasPermission(MODULE_PERMISSION["/security-ops/command-center"])) {
    return (
      <OpsAccessDenied what="оперативного контроля" />
    );
  }

  if (permissionsLoading) {
    return <DashboardLayout><p role="status">Проверка доступа…</p></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Охранные мероприятия"
          title="Оперативный контроль"
          description="Проверьте этапы незавершённых ОМ, недобор по заявкам сил и конфликты. Для действий откройте карточку мероприятия."
          actions={
            <>
              {freshness !== null && (
                <span className="text-xs text-muted-foreground">{freshness}</span>
              )}
              <Button
                variant="outline"
                disabled={refreshing}
                onClick={() => {
                  if (canReadEvents) void query.refetch();
                  if (canReadStrength) void strength.refetch();
                }}
              >
                {refreshing ? "Обновление…" : "Обновить"}
              </Button>
              <Link href="/security-ops/events">
                <Button variant="outline">Все мероприятия</Button>
              </Link>
              {canCreate && <Button onClick={() => setDialogOpen(true)}>Создать ОМ</Button>}
            </>
          }
        />

        {query.data !== undefined && !query.isError && <OpsKpiCards items={kpi} />}

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            {expenseDate ? `Численность: текущий расход на ${formatIsoDate(expenseDate)} в вашей области доступа.` : strengthGap}
            {groupingDate && <> Разделение мероприятий по {expenseDate ? "деловой дате расхода" : "дате устройства"}: {formatIsoDate(groupingDate)}.</>}
          </p>
          {summaryOpen && expenseDate && <Link className="inline-flex min-h-10 items-center rounded-md border px-3 py-2 hover:bg-muted"
            href={`/security-ops/service-summary?dateFrom=${encodeURIComponent(expenseDate)}`}>Свод по Службе на сегодня</Link>}
        </div>
        <p className="text-xs text-muted-foreground">Этап и конфликты — из реестра ОМ. Недобор считается по заявкам сил; назначения на посты проверяются в карточке мероприятия.</p>

        {query.isLoading && <p role="status" className="text-sm text-muted-foreground">Загрузка мероприятий…</p>}
        {query.isError && <p role="alert" className="text-sm text-destructive-ink">Не удалось загрузить мероприятия полностью. Обновите данные, чтобы увидеть итоги.</p>}
        {query.data !== undefined && !query.isError && groupingDate && <>
          <EventSection title="Предстоящие мероприятия" events={upcoming} empty="На сегодня и будущие даты незавершённых мероприятий нет." />
          <EventSection title="Прошедшие незавершённые мероприятия" events={overdue} empty="Прошедших незавершённых мероприятий нет." />
        </>}

        {canCreate && <CreateSecurityEventDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />}
      </div>
    </DashboardLayout>
  );
}

function EventSection({ title, events, empty }: { title: string; events: SecurityEvent[]; empty: string }) {
  return <Card role="region" aria-label={title}>
    <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent>
      {events.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : events.slice(0, 5).map(event => <EventRow key={event.id} event={event} />)}
      {events.length > 5 && <Link className="inline-flex min-h-10 items-center text-sm text-primary underline-offset-4 hover:underline" href="/security-ops/events">Все мероприятия · в этом списке ещё {events.length - 5}</Link>}
    </CardContent>
  </Card>;
}

function EventRow({ event }: { event: SecurityEvent }) {
  return (
    <Link
      href={`/security-ops/events/${event.id}`}
      className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-x-3.5 gap-y-2 border-b py-3 last:border-0 hover:bg-muted/30 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto] sm:items-center"
    >
      <span className="row-span-2 grid h-11 w-11 place-items-center rounded-[10px] bg-primary/10 text-sm font-extrabold text-blue-800 dark:text-blue-300 sm:row-span-1">
        {event.businessDate.slice(8, 10)}
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 break-words text-sm font-semibold sm:block sm:truncate">
          {event.title}
        </span>
        <span className="block text-[11.5px] text-muted-foreground">
          {formatIsoDate(event.businessDate)} · {event.objectName}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          Недобор по заявкам: {requestGap(event)} чел. · Конфликты: {event.conflictsCount}
        </span>
      </span>
      <span
        className={`col-start-2 inline-flex items-center justify-self-start rounded-full px-2.5 py-0.5 text-xs font-semibold sm:col-auto ${STAGE_BADGE_CLASS[event.stage]}`}
      >
        {STAGE_LABEL[event.stage]}
      </span>
    </Link>
  );
}
