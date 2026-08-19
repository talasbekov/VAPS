"use client";

import { useCallback, useMemo } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import OrgChart from "@/features/organization-structure/ui/OrgChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Users,
  UserCheck,
  AlertTriangle,
  Download,
} from "lucide-react";
import { useStaffUnitStatistics } from "@/hooks/use-staff-unit-statistics";
import { LoadFailure } from "@/components/load-failure";

export default function OrganizationPage() {
  const {
    data: statistics,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useStaffUnitStatistics();

  const summary = statistics?.summary;

  // Три массива ручки — в один плоский список строк, сверху вниз по уровням.
  const rows = useMemo(() => {
    if (!statistics) return [];
    return [
      ...statistics.departments.map((item) => ({
        key: `dep-${item.department_id}`,
        name: item.department_name,
        level: "Департамент",
        staffUnits: item.staff_units_count,
        employees: item.employees_count,
        vacancies: item.vacancies_count,
      })),
      ...statistics.directorates.map((item) => ({
        key: `dir-${item.directorate_id}`,
        name: item.directorate_name,
        level: "Управление",
        staffUnits: item.staff_units_count,
        employees: item.employees_count,
        vacancies: item.vacancies_count,
      })),
      ...statistics.divisions.map((item) => ({
        key: `div-${item.division_id}`,
        name: item.division_name,
        level: "Отдел",
        staffUnits: item.staff_units_count,
        employees: item.employees_count,
        vacancies: item.vacancies_count,
      })),
    ];
  }, [statistics]);

  // Выгружается ровно то, что показано в разрезе, — отдельной ручки выгрузки
  // структуры на бэке нет.
  const exportCsv = useCallback(() => {
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const head = ["Подразделение", "Уровень", "Штат", "Занято", "Вакансий"];
    const body = rows.map((row) =>
      [
        row.name,
        row.level,
        String(row.staffUnits),
        String(row.employees),
        String(row.vacancies),
      ]
        .map(cell)
        .join(";")
    );
    // BOM — иначе Excel читает кириллицу как мусор.
    const csv = `﻿${[head.map(cell).join(";"), ...body].join("\r\n")}`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "подразделения.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Структура организации
            </h1>
            <p className="text-muted-foreground mt-1">
              Визуальная организационная диаграмма с иерархией подразделений
            </p>
          </div>
          {/* Бейдж «Обновлено: <сегодня>» убран. Он печатал `new Date()`
              прямо в разметке: дата была СЕГОДНЯШНЕЙ всегда и о свежести
              данных не говорила ничего — а ровно такой `new Date()` в JSX
              уже давал расхождение гидратации на /dashboard. Свежести своих
              данных ручка статистики не сообщает, поэтому подписи нет.
              Заодно отсюда убрана строка поиска: у неё не было ни состояния,
              ни обработчика, ни доступа к дереву — набранное в ней не делало
              ничего. Живой поиск теперь внутри OrgChart, рядом с деревом. */}
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={statistics === undefined}
          >
            <Download className="h-4 w-4 mr-2" />
            Экспорт CSV
          </Button>
        </div>

        {/* Отказ запроса статистики: без этой врезки шесть плиток показывали
            прочерки, и сбой сервера читался как «в организации никого нет». */}
        {isError && (
          <LoadFailure
            what="статистику по структуре"
            onRetry={() => void refetch()}
            isRetrying={isFetching}
            className="rounded-xl border bg-card px-4"
          />
        )}

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
          <Card className="shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-semibold">
                Занято
              </CardTitle>
              <Users className="h-8 w-8 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-blue-600">
                {summary ? summary.employees_count : isLoading ? "…" : "—"}
              </div>
              {/* Здесь стояло «+12 за последний месяц» — выдумка под живым
                  числом: прироста ручка не считает вовсе. Подпись говорит,
                  ЧТО именно посчитано: ручка считает занятые СЛОТЫ, поэтому
                  сотрудник без штатной единицы сюда не попадает. */}
              <p className="text-sm text-muted-foreground mt-2">
                Занятых штатных единиц
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
              <p className="text-sm text-muted-foreground mt-2">
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
              <p className="text-sm text-muted-foreground mt-2">
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
              <p className="text-sm text-muted-foreground mt-2">
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
              <p className="text-sm text-muted-foreground mt-2">
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
              <p className="text-sm text-muted-foreground mt-2">
                Свободных должностей
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Разрез по подразделениям. Ручка статистики отдаёт его С САМОГО
            НАЧАЛА — три массива `departments`/`directorates`/`divisions` с
            теми же полями, что и сводка, — и страница их выбрасывала,
            показывая только итог по всей зоне видимости. Это тот же разрез,
            что у прототипа во вкладке «Таблица», только числами.

            Колонок по СТАТУСАМ (отпуск, больничный, дежурство, командировка)
            здесь нет намеренно: у прототипа они во вкладке «Расход», а расход
            по подразделениям — отдельный экран раздела и «Аналитика службы»
            поверх `/api/operations/strength-report/`. Третья копия тех же
            чисел была бы дублем, а не переносом. */}
        {rows.length > 0 && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Штат по подразделениям
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Уровни вложены друг в друга: числа управления включают его
                отделы, поэтому строки не складываются в итог.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Подразделение</TableHead>
                      <TableHead>Уровень</TableHead>
                      <TableHead className="text-right">Штат</TableHead>
                      <TableHead className="text-right">Занято</TableHead>
                      <TableHead className="text-right">Вакансий</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.level}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.staffUnits}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-green-700">
                          {row.employees}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-red-700">
                          {row.vacancies}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Organization Chart */}
        <OrgChart />
      </div>
    </DashboardLayout>
  );
}
