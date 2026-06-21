"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
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

export default function DashboardPage() {
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(
    null
  );

  const {
    data: absenceStats,
    isLoading: isLoadingStats,
    error: statsError,
  } = useAbsenceStatistics();

  const recentActivities = [
    {
      id: 1,
      action: "Обновлен статус",
      employee: "Иванов И.И.",
      time: "2 мин назад",
      type: "update",
    },
    {
      id: 2,
      action: "Добавлен сотрудник",
      employee: "Петров П.П.",
      time: "15 мин назад",
      type: "add",
    },
    {
      id: 3,
      action: "Изменена структура",
      employee: "Отдел IT",
      time: "1 час назад",
      type: "structure",
    },
    {
      id: 4,
      action: "Создан отчет",
      employee: "Менеджер",
      time: "2 часа назад",
      type: "report",
    },
  ];

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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Обзор</h1>
            <p className="text-gray-600 mt-1">Обзор состояния организации</p>
          </div>
          <Badge variant="outline" className="text-sm">
            Последнее обновление: {new Date().toLocaleString("ru-RU")}
          </Badge>
        </div>

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
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-1.5 rounded-full shadow-sm z-10">
              <Wrench className="h-3.5 w-3.5 animate-pulse" />
              <span>В работе</span>
            </div>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Последние действия
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentActivities.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          activity.type === "update"
                            ? "bg-blue-500"
                            : activity.type === "add"
                            ? "bg-green-500"
                            : activity.type === "structure"
                            ? "bg-purple-500"
                            : "bg-orange-500"
                        }`}
                      />
                      <div>
                        <p className="font-medium text-sm">{activity.action}</p>
                        <p className="text-xs text-gray-600">
                          {activity.employee}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">
                      {activity.time}
                    </span>
                  </div>
                ))}
              </div>
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
                        <span className="text-xs text-gray-500">
                          цель: {metric.target}%
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
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
        <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-200 shadow-sm mb-3">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-gray-700">
              Системные уведомления:
            </span>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              Синхронизация: {new Date().toLocaleTimeString("ru-RU")}
            </Badge>
            <Badge variant="outline" className="bg-green-50 text-green-700">
              Система работает стабильно
            </Badge>
          </div>
          <div className="text-sm text-gray-500">
            Последняя проверка: {new Date().toLocaleTimeString("ru-RU")}
          </div>
        </div>

        {/* System Status Footer */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2"></div>
      </div>
    </DashboardLayout>
  );
}
