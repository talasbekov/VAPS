"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { modulePermissionsOf } from "@/entities/portal-access";
import { PageHeader } from "@/components/page-header";
import { StatsCards } from "@/components/dashboard/stats-cards";
import OrgBoard, { type OrgBoardLoadState } from "@/features/organization-structure/ui/OrgBoard";
import { Badge } from "@/components/ui/badge";
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



  const [structureState, setStructureState] = useState<OrgBoardLoadState>({
    isLoading: true, isError: false, updatedAt: 0,
  });

  const {
    data: absenceStats,
    isLoading: isLoadingStats,
    error: statsError,
    refetch: refetchStats,
    isFetching: isFetchingStats,
    dataUpdatedAt: statsUpdatedAt,
  } = useAbsenceStatistics(!opsPermissionsLoading && allowed);
  const hasLoadError = Boolean(statsError) || structureState.isError;
  const isUpdating = isFetchingStats || structureState.isLoading;
  const updatedAt = statsUpdatedAt && structureState.updatedAt
    ? Math.min(statsUpdatedAt, structureState.updatedAt) : 0;
  const loadLabel = hasLoadError ? "Часть данных не загружена"
    : isUpdating ? "Загрузка данных…" : "Данные обзора загружены";

  // Отказ рисуется ПОСЛЕ всех хуков (правило хуков React): ранний возврат
  // выше по функции пропускал бы `useState` при смене прав, и
  // React падал бы на «rendered fewer hooks than expected».
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
              Последнее обновление: {updatedAt ? new Date(updatedAt).toLocaleString("ru-RU") : "ещё не завершено"}
            </Badge>
          }
        />

        {/* Stats Cards */}
        <StatsCards
          compact
          stats={
            absenceStats
              ? {
                  staff_count: absenceStats.staff_count,
                  total_absences: absenceStats.total_absences,
                  by_type: absenceStats.by_type,
                }
              : null
          }
          isLoading={opsPermissionsLoading || isLoadingStats}
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
                <div className="min-h-[350px]">
                  {!opsPermissionsLoading && allowed
                    ? <OrgBoard onLoadStateChange={setStructureState} />
                    : <p role="status">Загрузка прав доступа…</p>}
                </div>
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
              Состояние обзора:
            </span>
            <Badge role="status" variant="outline" className={hasLoadError
              ? "text-destructive-ink" : isUpdating ? "text-muted-foreground" : "text-green-700 dark:text-green-400"}>
              {loadLabel}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            {updatedAt ? `Данные получены: ${new Date(updatedAt).toLocaleTimeString("ru-RU")}` : "Ожидание данных сервера"}
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
