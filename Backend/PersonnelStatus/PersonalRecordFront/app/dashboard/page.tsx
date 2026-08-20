"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { StatusOverview } from "@/widgets/status-overview";
import OrgBoard from "@/features/organization-structure/ui/OrgBoard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Activity,
  Target,
  BarChart3,
  Clock,
  CheckCircle,
  AlertCircle,
  Wrench,
} from "lucide-react";
import { useAbsenceStatistics } from "@/hooks/use-absence-statistics";
import { useRecentAuditLogs } from "@/hooks/use-recent-audit-logs";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

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

  const {
    data: recentActivities,
    isLoading: isLoadingActivities,
    isError: isActivitiesError,
    error: activitiesError,
  } = useRecentAuditLogs(4);

  // Цвет точки — по глаголу в коде события (закрытый словарь на бэке,
  // audit_service.ACTIONS): создание зелёным, снятие/отмена оранжевым,
  // остальное (обновление, продление и т.п.) синим. Действие-к-цвету, а не
  // сущность-к-цвету — так же, как было у старого литерала.
  const activityDotColor = (action: string) => {
    if (action.endsWith("_CREATED") || action.endsWith("_INITIATED"))
      return "bg-green-500";
    if (
      action.endsWith("_CANCELLED") ||
      action.endsWith("_DELETED") ||
      action.endsWith("_DISMISSED")
    )
      return "bg-orange-500";
    return "bg-blue-500";
  };

  const performanceMetrics = [
    {
      name: "Эффективность обновления",
      value: 87,
      target: 90,
      color: "bg-blue-500",
    },
    { name: "Время ответа", value: 92, target: 85, color: "bg-green-500" },
    { name: "Точность данных", value: 94, target: 95, color: "bg-purple-500" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-4 pt-0">
        {/* Header */}
        <PageHeader
          className="mb-4"
          eyebrow="Личный состав"
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

        {/* Additional Content Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          {/* Recent Activities */}
          <Card className="relative overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Последние действия
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingActivities && (
                <p className="text-sm text-muted-foreground">Загрузка…</p>
              )}
              {isActivitiesError && (
                <p className="text-sm text-muted-foreground">
                  {activitiesError?.message ?? "Не удалось загрузить журнал"}
                </p>
              )}
              {recentActivities !== undefined && recentActivities.length === 0 && (
                <p className="text-sm text-muted-foreground">Записей нет</p>
              )}
              {recentActivities !== undefined && recentActivities.length > 0 && (
                <div className="space-y-4">
                  {recentActivities.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${activityDotColor(
                            entry.action
                          )}`}
                        />
                        <div>
                          <p className="font-mono text-sm">{entry.action}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.entity_type} · {entry.entity_id}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(entry.created_at), {
                          addSuffix: true,
                          locale: ru,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Performance Metrics */}
          <Card className="relative overflow-hidden">
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-1.5 rounded-full shadow-sm z-10">
              <Wrench className="h-3.5 w-3.5 animate-pulse" />
              <span>В работе</span>
            </div>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Показатели эффективности
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {performanceMetrics.map((metric) => (
                  <div key={metric.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{metric.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">
                          {metric.value}%
                        </span>
                        <span className="text-xs text-muted-foreground">
                          цель: {metric.target}%
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${metric.color}`}
                        style={{ width: `${metric.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
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
