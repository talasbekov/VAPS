"use client";

// Командный центр ОМ: KPI по всему реестру мероприятий и лента готовности
// ближайших. KPI считаются только из реальных данных реестра — показатели
// прототипа, которым нет источника (численность личного состава, карта
// готовности подразделений), не рисуются: придумывать цифры запрещено.
import { useMemo, useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  LineChart,
} from "lucide-react";
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { CreateSecurityEventDialog } from "@/features/create-security-event";
import { OpsKpiCards } from "@/widgets/ops-kpi-cards";
import type { OpsKpiItem } from "@/widgets/ops-kpi-cards";
import {
  STAGE_LABEL,
  STAGE_BADGE_CLASS,
  STAGE_PROGRESS_CLASS,
} from "@/entities/security-event";
import type { SecurityEvent } from "@/entities/security-event";
import { OpsAccessDenied } from "@/components/ops-access-denied";

export default function CommandCenterPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  // весь реестр одним запросом: KPI обязаны считаться по всем ОМ,
  // а не по отрисованной пятёрке
  const query = useSecurityEvents({
    search: "",
    stage: "ALL",
    page: 1,
    pageSize: 100,
  });

  const events = useMemo(() => query.data?.results ?? [], [query.data]);

  const kpi = useMemo<OpsKpiItem[]>(() => {
    const active = events.filter((e) => e.stage !== "CLOSED");
    const attention = active.filter((e) => e.conflictsCount > 0);
    const closed = events.filter((e) => e.stage === "CLOSED");
    const avgReadiness =
      active.length === 0
        ? null
        : Math.round(
            active.reduce((sum, e) => sum + e.readinessPercent, 0) /
              active.length
          );
    return [
      {
        key: "active",
        label: "Активные ОМ",
        value: String(active.length),
        icon: Activity,
        iconClass: "text-primary",
      },
      {
        key: "attention",
        label: "Требуют внимания",
        value: String(attention.length),
        hint: "есть конфликты",
        icon: AlertTriangle,
        iconClass: attention.length > 0 ? "text-red-600" : "text-muted-foreground",
      },
      {
        key: "readiness",
        label: "Средняя готовность",
        value: avgReadiness === null ? "—" : `${avgReadiness}%`,
        hint: "по активным ОМ",
        icon: Gauge,
        iconClass: "text-amber-600",
      },
      {
        key: "closed",
        label: "Закрыто",
        value: String(closed.length),
        icon: CheckCircle2,
        iconClass: "text-green-600",
      },
    ];
  }, [events]);

  // ближайшие — активные, отсортированные по дате проведения
  const upcoming = useMemo(
    () =>
      [...events]
        .filter((e) => e.stage !== "CLOSED")
        .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
        .slice(0, 5),
    [events]
  );

  if (!permissionsLoading && !hasPermission("event.view")) {
    return (
      <OpsAccessDenied what="командного центра" />
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <LineChart className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Командный центр</h1>
              <p className="text-muted-foreground">
                Готовность охранных мероприятий
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/security-ops/events">
              <Button variant="outline">Все мероприятия</Button>
            </Link>
            <Button onClick={() => setDialogOpen(true)}>Создать ОМ</Button>
          </div>
        </header>

        {query.data !== undefined && <OpsKpiCards items={kpi} />}

        <Card>
          <CardHeader>
            <CardTitle>Ближайшие мероприятия</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isLoading && (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            )}
            {query.isError && (
              <p className="text-sm text-destructive">
                Не удалось загрузить данные командного центра.
              </p>
            )}
            {query.data !== undefined && upcoming.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ближайших мероприятий нет.
              </p>
            )}
            {upcoming.map((event) => (
              <ReadinessRow key={event.id} event={event} />
            ))}
          </CardContent>
        </Card>

        <CreateSecurityEventDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      </div>
    </DashboardLayout>
  );
}

function ReadinessRow({ event }: { event: SecurityEvent }) {
  return (
    <Link
      href={`/security-ops/events/${event.id}`}
      className="flex items-center gap-3.5 border-b py-3 last:border-0 hover:bg-muted/30"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-sm font-extrabold text-blue-800">
        {event.businessDate.slice(8, 10)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {event.title}
        </span>
        <span className="block text-[11.5px] text-muted-foreground">
          {event.businessDate} · {event.objectName}
        </span>
        <span className="mt-2 block h-[5px] overflow-hidden rounded-full bg-muted">
          <span
            className={`block h-full rounded-full ${STAGE_PROGRESS_CLASS[event.stage]}`}
            style={{ width: `${event.readinessPercent}%` }}
          />
        </span>
      </span>
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_BADGE_CLASS[event.stage]}`}
      >
        {STAGE_LABEL[event.stage]}
      </span>
      <b className="text-sm tabular-nums">{event.readinessPercent}%</b>
    </Link>
  );
}
