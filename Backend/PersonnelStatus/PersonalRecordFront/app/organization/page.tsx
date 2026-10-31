"use client";

import { useMemo } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import OrgChart from "@/features/organization-structure/ui/OrgChart";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStaffUnitStatistics } from "@/hooks/use-staff-unit-statistics";
import { LoadFailure } from "@/components/load-failure";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { modulePermissionsOf } from "@/entities/portal-access";

export default function OrganizationPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const allowed = modulePermissionsOf("/organization").some(hasPermission);

  // Данные страницы живут во внутреннем компоненте: так их хуки не создаются
  // до решения гейта. У EMPLOYEE нет orgstructure.view, и прежняя страница
  // успевала запросить статистику по status.view и дерево штатки по
  // orgstructure.view — получались правдоподобные числа рядом с 403 и пустой
  // диаграммой вместо одного честного ответа о доступе (Plane №1152).
  if (permissionsLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
        role="status"
      >
        Проверка доступа…
      </div>
    );
  }
  if (!allowed) {
    return <OpsAccessDenied what="структуры организации" />;
  }

  return <OrganizationScreen />;
}

function OrganizationScreen() {
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
        path: item.ancestors ?? [],
        level: "Департамент",
        staffUnits: item.staff_units_count,
        employees: item.employees_count,
        vacancies: item.vacancies_count,
      })),
      ...statistics.directorates.map((item) => ({
        key: `dir-${item.directorate_id}`,
        name: item.directorate_name,
        path: item.ancestors ?? [],
        level: "Управление",
        staffUnits: item.staff_units_count,
        employees: item.employees_count,
        vacancies: item.vacancies_count,
      })),
      ...statistics.divisions.map((item) => ({
        key: `div-${item.division_id}`,
        name: item.division_name,
        path: item.ancestors ?? [],
        level: "Отдел",
        staffUnits: item.staff_units_count,
        employees: item.employees_count,
        vacancies: item.vacancies_count,
      })),
    ];
  }, [statistics]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          eyebrow="Личный состав"
          title="Структура организации"

        />

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
          <StatCard
            label="Занято"
            value={summary ? summary.employees_count : isLoading ? "…" : "—"}
            tone="info"
            // Здесь стояло «+12 за последний месяц» — выдумка под живым
            // числом: прироста ручка не считает вовсе. Подпись говорит,
            // ЧТО именно посчитано: ручка считает занятые СЛОТЫ, поэтому
            // сотрудник без штатной единицы сюда не попадает.
            caption="Занятых штатных единиц"
          />

          <StatCard
            label="Департаментов"
            value={summary ? summary.departments_count : isLoading ? "…" : "—"}
            tone="success"
            caption="В зоне видимости пользователя"
          />

          <StatCard
            label="Управлений"
            value={summary ? summary.directorates_count : isLoading ? "…" : "—"}
            tone="success"
            caption="Структур в выбранном департаменте"
          />

          <StatCard
            label="Отделов"
            value={summary ? summary.divisions_count : isLoading ? "…" : "—"}
            tone="success"
            caption="Подразделений нижнего уровня"
          />

          <StatCard
            label="Штатных единиц"
            value={summary ? summary.staff_units_count : isLoading ? "…" : "—"}
            tone="warning"
            caption="Всего позиций в штатном расписании"
          />

          <StatCard
            label="Вакансий"
            value={summary ? summary.vacancies_count : isLoading ? "…" : "—"}
            tone="warning"
            caption="Свободных должностей"
          />
        </div>

        <OrgChart />

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
            <details>
              <summary
                aria-label="Штат по подразделениям"
                className="min-h-11 cursor-pointer rounded-t-xl p-4 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>Штат по подразделениям</span>
                <span aria-hidden="true" className="ml-2 text-sm font-normal text-muted-foreground">{rows.length}</span>
              </summary>
              <CardContent className="space-y-3 pt-0">
                <p className="text-sm text-muted-foreground">
                  Уровни вложены друг в друга: числа управления включают его
                  отделы, поэтому строки не складываются в итог.
                </p>
                <div
                  role="region"
                  aria-label="Штат по подразделениям"
                  tabIndex={0}
                  className="max-h-[min(50vh,28rem)] overflow-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
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
                          <TableCell className="font-medium">
                            {row.name}
                            {/* Путь до подразделения (Plane №214). Имена
                                уникальны только внутри родителя: «Первое
                                управление» есть в каждом департаменте, «Первый
                                отдел» — в каждом управлении, и на реальной
                                структуре в таблице стояло девять одинаковых
                                строк подряд. У корневых строк пути нет, и место
                                под него не занимается. */}
                            {row.path.length > 0 && (
                              <div className="text-xs font-normal text-muted-foreground">
                                {row.path.join(" › ")}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.level}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.staffUnits}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-green-700 ">
                            {row.employees}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-red-700 ">
                            {row.vacancies}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              </div>
              </CardContent>
            </details>
          </Card>
        )}

      </div>
    </DashboardLayout>
  );
}
