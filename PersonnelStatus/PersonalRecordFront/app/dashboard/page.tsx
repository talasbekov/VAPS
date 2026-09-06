"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { modulePermissionsOf } from "@/entities/portal-access";
import { PageHeader } from "@/components/page-header";
import { StatsCards } from "@/components/dashboard/stats-cards";
import OrgBoard from "@/features/organization-structure/ui/OrgBoard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import {
  absenceStatsFailure,
  useAbsenceStatistics,
} from "@/hooks/use-absence-statistics";

export default function DashboardPage() {
  // ГЕЙТ ПО ПРАВАМ РАЗДЕЛА (Plane №352, Ш-1). Экран был открыт каждому
  // вошедшему: видимость решало только меню, а прямой адрес пускал любого.
  // Спрятанный пункт при открытом экране — не разграничение прав, а его
  // видимость. Право спрашивается из той же карты, по которой меню решает,
  // показывать ли пункт.
  const { hasPermission: hasOpsPermission, isLoading: opsPermissionsLoading } =
    useOpsPermissions();
  const allowed = modulePermissionsOf("/dashboard").some((code) =>
    hasOpsPermission(code)
  );



  // Часы «последнее обновление» рендерятся ТОЛЬКО после маунта: new Date()
  // прямо в JSX давал hydration mismatch — сервер и клиент попадали на
  // разные секунды.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  const {
    data: absenceStats,
    isLoading: isLoadingStats,
    error: statsError,
    refetch: refetchStats,
  } = useAbsenceStatistics();

  // Отказ рисуется ПОСЛЕ всех хуков (правило хуков React): ранний возврат
  // выше по функции пропускал бы `useState`/`useEffect` при смене прав, и
  // React падал бы на «rendered fewer hooks than expected». Запросы при этом
  // всё равно уходят и получают свои 403 — так же ведут себя все экраны
  // раздела с `OpsAccessDenied`.
  if (!opsPermissionsLoading && !allowed) {
    return <OpsAccessDenied what="обзора организации" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 pt-0">
        {/* Header */}
        <PageHeader
          className="mb-4"
          eyebrow="Ежедневный расход"
          title="Обзор"
          description="Обзор состояния организации"
          actions={
            <Badge variant="outline" className="text-sm">
              Последнее обновление: {now ? now.toLocaleString("ru-RU") : "…"}
            </Badge>
          }
        />

        {/* Stats Cards */}
        <StatsCards
          stats={
            absenceStats
              ? {
                  staff_count: absenceStats.staff_count,
                  total_absences: absenceStats.total_absences,
                  by_type: absenceStats.by_type,
                }
              : null
          }
          isLoading={isLoadingStats}
          isError={statsError !== null && statsError !== undefined}
          // ПРИЧИНА, а не только факт отказа (Plane №340): «учётка не
          // привязана к сотруднику» — штатное состояние служебной учётки, и
          // показывать его как сбой значит приучать не верить сообщениям.
          failure={absenceStatsFailure(statsError)}
          onRetry={() => void refetchStats()}
        />

        {/* Main Content Grid */}
        <div className="w-full">
          {/* Organization Tree - Main Content */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Структура организации
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="min-h-[350px]">
                  <OrgBoard />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 🔴 ПРАВОЙ КОЛОНКИ «ОБЗОР СТАТУСОВ» БОЛЬШЕ НЕТ (Plane №838,
              решение заказчика 06.09.2026: снять).

              Здесь стоял закомментированный виджет `StatusOverview`. Он не
              выводился на экран, но поддерживался как живой код — и это было
              хуже, чем кажется: числа в нём были ВЫДУМАННЫЕ, вписанные в сам
              компонент (892 в строю, 45 на дежурстве, 156 в отпуске и так
              далее). Верни его кто-нибудь «как есть» — и заказчик читал бы
              придуманные цифры как сводку по личному составу.

              Живая сводка по статусам живёт на «Статусах сотрудников» и в
              плитках выше (`StatsCards`), где числа приходят с сервера. */}
        </div>

        {/* Quick Actions Bar */}
        {/* flex-wrap: строка уведомлений не переносилась и тянула страницу на 210 px вбок при 375. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-foreground">
              Системные уведомления:
            </span>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              Синхронизация: {now ? now.toLocaleTimeString("ru-RU") : "…"}
            </Badge>
            <Badge variant="outline" className="bg-green-50 text-green-700">
              Система работает стабильно
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            Последняя проверка: {now ? now.toLocaleTimeString("ru-RU") : "…"}
          </div>
        </div>

        {/* System Status Footer */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2"></div>
      </div>
    </DashboardLayout>
  );
}
