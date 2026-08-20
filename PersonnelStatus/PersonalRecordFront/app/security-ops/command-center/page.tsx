"use client";

// Командный центр ОМ по экрану прототипа Smart Josparlau: четыре показателя
// шапки, лента готовности ближайших мероприятий и отметка свежести данных.
//
// Численность личного состава читается из ЖИВОГО расхода (строевой записки),
// а не считается здесь: расход — владелец этих чисел, и второй счёт разошёлся
// бы с экраном «Расход и светофор».
//
// Из прототипа НЕ перенесено: «карта готовности подразделений» (сдача дня по
// подразделениям — это светофор, у него свой экран и своё дерево) и график
// нагрузки за 14 дней (нагрузку считает аналитика §22.9 по своей методике из
// «Настроек»; вторая, нарисованная здесь, противоречила бы ей).
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
import { useSecurityEvents } from "@/hooks/use-security-events";
import { useStrengthReport } from "@/hooks/use-strength-report";
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

/** Код колонки «в строю» в расходе. Проверен по ответу живого бэка
 * (`/api/operations/strength-report/`) — тот же код, что у сетки дня. */
const IN_SERVICE_COLUMN = "IN_SERVICE";

export default function CommandCenterPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  // весь реестр одним запросом: KPI обязаны считаться по всем ОМ,
  // а не по отрисованной пятёрке
  const query = useSecurityEvents({
    search: "",
    stage: "ALL",
    page: 1,
    from: "",
    to: "",
    owner: "",
    pageSize: 100,
  });
  const canReadStrength = hasPermission("status.view");
  const strength = useStrengthReport(!permissionsLoading && canReadStrength);

  const events = useMemo(() => query.data?.results ?? [], [query.data]);

  /** Средняя готовность активных ОМ — подпись к ленте, а не пятая плитка:
   * в ряду прототипа их четыре, а готовность и так стоит у каждой строки. */
  const avgReadiness = useMemo(() => {
    const active = events.filter((e) => e.stage !== "CLOSED");
    if (active.length === 0) return null;
    return Math.round(
      active.reduce((sum, e) => sum + e.readinessPercent, 0) / active.length
    );
  }, [events]);

  /** Численность из расхода. null — расход не прочитан (подпись объясняет
   * причину: незагруженные права это ещё не отказ). */
  const personnel = useMemo(() => {
    const report = strength.data;
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
  }, [strength.data]);

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
      const gap = event.forceRequests.reduce(
        (sum, request) =>
          sum + Math.max(0, request.requestedCount - request.allocatedCount),
        0
      );
      if (gap > 0) {
        deficit += gap;
        deficitEvents += 1;
      }
    }
    return [
      {
        key: "personnel",
        label: "Личный состав",
        value: strengthGap === null ? String(personnel!.staff) : "—",
        hint: strengthGap ?? `${personnel!.list} по списку`,
        icon: Users,
        iconClass: "text-primary-ink",
      },
      {
        key: "in-service",
        label: "В строю",
        value:
          strengthGap !== null || personnel!.inService === null
            ? "—"
            : String(personnel!.inService),
        hint:
          strengthGap ??
          (personnel!.inService === null
            ? "в расходе нет колонки «в строю»"
            : personnel!.list === 0
              ? "списочной численности нет"
              : `${sharePercent(personnel!.inService, personnel!.list)} списочного`),
        icon: ShieldCheck,
        iconClass: "text-green-600",
      },
      {
        key: "active",
        label: "Активные ОМ",
        value: String(active.length),
        hint:
          attention.length === 0
            ? "конфликтов нет"
            : `${attention.length} требуют внимания`,
        icon: Activity,
        iconClass: attention.length > 0 ? "text-red-600" : "text-primary-ink",
      },
      {
        key: "deficit",
        label: "Дефицит по ОМ",
        value: String(deficit),
        hint:
          deficitEvents === 0
            ? "запросы сил закрыты"
            : `по ${deficitEvents} ${deficitEvents === 1 ? "мероприятию" : "мероприятиям"}`,
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
  const updatedAt = Math.max(query.dataUpdatedAt, strength.dataUpdatedAt);
  const freshness =
    mounted && updatedAt > 0
      ? `данные на ${new Date(updatedAt).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : null;
  const refreshing = query.isFetching || strength.isFetching;

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
        <PageHeader
          eyebrow="Оперативная работа"
          title="Командный центр"
          description="Готовность охранных мероприятий"
          actions={
            <>
              {freshness !== null && (
                <span className="text-xs text-muted-foreground">{freshness}</span>
              )}
              <Button
                variant="outline"
                disabled={refreshing}
                onClick={() => {
                  void query.refetch();
                  void strength.refetch();
                }}
              >
                {refreshing ? "Обновление…" : "Обновить"}
              </Button>
              <Link href="/security-ops/events">
                <Button variant="outline">Все мероприятия</Button>
              </Link>
              <Button onClick={() => setDialogOpen(true)}>Создать ОМ</Button>
            </>
          }
        />

        {query.data !== undefined && <OpsKpiCards items={kpi} />}

        <Card>
          <CardHeader>
            <CardTitle>Ближайшие мероприятия</CardTitle>
            <p className="text-xs text-muted-foreground">
              {avgReadiness === null
                ? "активных мероприятий нет"
                : `средняя готовность активных — ${avgReadiness}%`}
            </p>
          </CardHeader>
          <CardContent>
            {query.isLoading && (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            )}
            {query.isError && (
              <p className="text-sm text-destructive-ink">
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

/** Доля в процентах с одним знаком и запятой: «84,7%». */
function sharePercent(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(1).replace(".", ",")}%`;
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
