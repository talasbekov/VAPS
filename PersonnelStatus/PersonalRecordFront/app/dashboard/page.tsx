"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { StatusOverview } from "@/widgets/status-overview";
import OrgBoard from "@/features/organization-structure/ui/OrgBoard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";
import { useAbsenceStatistics } from "@/hooks/use-absence-statistics";

export default function DashboardPage() {
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(
    null
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

          {/* Right Sidebar */}
          {/* <div className="space-y-3">
            <StatusOverview />
          </div> */}
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
