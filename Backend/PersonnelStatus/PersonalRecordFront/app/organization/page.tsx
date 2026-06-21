"use client";

import { DashboardLayout } from "@/components/dashboard-layout";
import OrgChart from "@/features/organization-structure/ui/OrgChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Building2,
  Users,
  UserCheck,
  AlertTriangle,
  Search,
} from "lucide-react";
import { useStaffUnitStatistics } from "@/hooks/use-staff-unit-statistics";

export default function OrganizationPage() {
  const { data: statistics, isLoading } = useStaffUnitStatistics();

  const summary = statistics?.summary;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Структура организации
            </h1>
            <p className="text-gray-600 mt-1">
              Визуальная организационная диаграмма с иерархией подразделений
            </p>
          </div>
          <Badge variant="outline" className="text-sm">
            Обновлено: {new Date().toLocaleDateString("ru-RU")}
          </Badge>
        </div>

        {/* Search Bar */}
        <div className="flex justify-center">
          <div className="relative w-full max-w-2xl">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-6 w-6 text-gray-400" />
            <Input
              type="search"
              placeholder="Поиск сотрудников, отделов, департаментов..."
              className="pl-12 pr-6 py-4 text-lg border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:ring-blue-500 shadow-lg"
            />
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-semibold">
                Всего сотрудников
              </CardTitle>
              <Users className="h-8 w-8 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-600">
                {summary ? summary.employees_count : isLoading ? "…" : "—"}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                +12 за последний месяц
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-semibold">
                Департаментов
              </CardTitle>
              <Building2 className="h-8 w-8 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600">
                {summary ? summary.departments_count : isLoading ? "…" : "—"}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                В зоне видимости пользователя
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-semibold">
                Управлений
              </CardTitle>
              <UserCheck className="h-8 w-8 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600">
                {summary ? summary.directorates_count : isLoading ? "…" : "—"}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Структур в выбранном департаменте
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-semibold">
                Отделов
              </CardTitle>
              <Building2 className="h-8 w-8 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-green-600">
                {summary ? summary.divisions_count : isLoading ? "…" : "—"}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Подразделений нижнего уровня
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-semibold">
                Штатных единиц
              </CardTitle>
              <AlertTriangle className="h-8 w-8 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-yellow-600">
                {summary ? summary.staff_units_count : isLoading ? "…" : "—"}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Всего позиций в штатном расписании
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-semibold">
                Вакансий
              </CardTitle>
              <AlertTriangle className="h-8 w-8 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-yellow-600">
                {summary ? summary.vacancies_count : isLoading ? "…" : "—"}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Свободных должностей
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Organization Chart */}
        <OrgChart />
      </div>
    </DashboardLayout>
  );
}
