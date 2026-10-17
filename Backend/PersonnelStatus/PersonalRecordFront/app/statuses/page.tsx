"use client"

import { useState, useMemo, Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { PageHeader } from "@/components/page-header"
import { StatusTable } from "@/components/status-table"
import { MassStatusUpdate } from "@/components/mass-status-update"
import { retainFailedMassSelection } from "@/features/employee-status-update/model/mass-status-result"
import { StatusCalendarBoard } from "@/widgets/status-calendar"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { DirectorateAccessNotice } from "@/components/directorate-access-notice"
import { directorateDenial } from "@/hooks/use-staff-units-by-directorate"
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page"
import { useQueryClient } from "@tanstack/react-query"
import { SecondmentRequestsDialog } from "@/features/secondment-requests/ui/SecondmentRequestsDialog";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { moduleOpenFor } from "@/entities/portal-access";
import { ForcesRequestBanner } from "@/features/forces-request-banner/ui/ForcesRequestBanner";
import { StatusDayClose } from "@/features/ops-daily/status-day-close";
import { OpsPermissionBoundary } from "@/components/ops-permission-boundary";

export default function StatusesPage() {
  return <OpsPermissionBoundary><StatusesScreen /></OpsPermissionBoundary>
}

function StatusesScreen() {
  // Роль-наблюдатель (Plane №348): «видит своё управление, но без возможности
  // редактирования». Управляющие элементы ей не показываются — обещание
  // действия, которое сервер отклонит, хуже их отсутствия. «Экспорт» остаётся:
  // это чтение.
  //
  // ПРАВО ТЕПЕРЬ РАЗДЕЛА, А НЕ ПОРТАЛА (Plane №352, Ш-1): было
  // `hasPermission("statuses", "update")` из зашитого набора портальной роли.
  // Семь ролей заказчика живут в каталоге раздела, и портальный набор их не
  // знает вовсе — под ними экран был бы либо целиком правимым, либо целиком
  // закрытым, смотря какая портальная роль досталась учётке.
  const { hasPermission: hasOpsPermission, isLoading: opsPermissionsLoading, error: permissionsError } =
    useOpsPermissions()
  const canEdit = hasOpsPermission("status.manage")
  const allowed = moduleOpenFor("/statuses", hasOpsPermission)
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const queryClient = useQueryClient()

  // Шапка экрана считает четыре числа по ВСЕМУ подразделению, а таблица ниже
  // листается страницами (Plane №231). Поэтому здесь запрашивается СВОДКА и
  // пустая страница: сами строки берёт таблица, а шапке нужны только итоги.
  //
  // Раньше на этом месте стоял полный состав подразделения — 2,7 МБ и 5124
  // строки в DOM на пяти тысячах сотрудников, экран открывался 14 секунд.
  const {
    data,
    isLoading: loading,
    error: queryError,
    isRefetching: refreshing,
    dataUpdatedAt,
  } = useStaffUnitsPage({ page: 1, pageSize: 1, withSummary: true }, !opsPermissionsLoading && !permissionsError && allowed)

  const stats = useMemo(() => {
    const summary = data?.summary
    return {
      totalEmployees: summary?.employees,
      needUpdate: summary?.without_status,
      overdue: summary?.overdue,
      scheduled: summary?.scheduled,
    }
  }, [data?.summary])

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Произошла ошибка"
    : null

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  const [refreshingContext, setRefreshingContext] = useState(false)
  const handleRefresh = () => {
    // Обе семьи ключей: сводка шапки и страницы таблицы — разные запросы с
    // 28.08.2026, и «Обновить» обязано освежить оба (Plane №231).
    queryClient.invalidateQueries({ queryKey: ["staff-units-by-directorate"] })
    queryClient.invalidateQueries({ queryKey: ["staff-units-page"] })
    // Расход на деловую дату в карточке сдачи (Plane №1209): поставленный в
    // таблице статус обязан отразиться в числах, которые начальник сдаёт.
    queryClient.invalidateQueries({ queryKey: ["ops-daily", "expense-preview"] })
  }

  const handlePageRefresh = async () => {
    if (refreshingContext) return
    setRefreshingContext(true)
    handleRefresh()
    try {
      // Only an explicit page refresh re-resolves tomorrow. Saving a status
      // must not move an open day-submission draft to another date.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["daily-expense-board", "default-business-date"] }),
        queryClient.invalidateQueries({ queryKey: ["ops-daily", "submission-divisions"] }),
        queryClient.invalidateQueries({ queryKey: ["ops-daily", "day-submission"] }),
      ])
    } finally {
      setRefreshingContext(false)
    }
  }

  // Все три вкладки и счётчики читают ОДИН запрос directorate: закрыта ручка —
  // закрыт экран. Показывать шапку с нулями было бы враньём о подразделении.
  // Причина отказа передаётся заглушке: 403 и 400 чинятся разными людьми
  // (Plane №329).
  const denial = directorateDenial(queryError)
  // Отказ — ПОСЛЕ всех хуков (правило хуков React).
  if (opsPermissionsLoading) {
    return <DashboardLayout><p role="status" className="text-sm text-muted-foreground">Проверяем доступ к статусам…</p></DashboardLayout>
  }
  if (permissionsError || !allowed) {
    return <OpsAccessDenied what="статусов сотрудников" />
  }

  if (denial) {
    return (
      <DashboardLayout>
        <DirectorateAccessNotice denial={denial} reason={error} />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title="Управление статусами"
          description={canEdit
            ? hasOpsPermission("daily_report.mark_update")
              ? "Подготовьте статусы сотрудников, проверьте расход на нужную дату и сдайте день."
              : "Управляйте текущими и запланированными статусами сотрудников вашего подразделения."
            : "Просмотр текущих и запланированных статусов сотрудников вашего подразделения."}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">
                Обновлено: {lastUpdate ? lastUpdate.toLocaleString("ru-RU") : "—"}
              </span>
              <Button variant="outline" size="sm" onClick={handlePageRefresh} disabled={refreshing || refreshingContext || loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing || refreshingContext ? "animate-spin" : ""}`} />
                Обновить
              </Button>
            </div>
          }
        />

        {/* Баннер запроса сил (Plane №394, `[СБС-30]`): начальник управления
            приходит сюда из уведомления по адресу `?forcesRequest=…`. Своя
            граница Suspense: `useSearchParams` внутри, а у `/statuses` нет
            клиентского layout — без границы прод-сборка падает на
            пререндере (Plane №112). */}
        <Suspense fallback={null}>
          <ForcesRequestBanner
            compact
            selectedEmployees={selectedEmployees}
            onSelected={() => {
              setSelectedEmployees([])
              handleRefresh()
            }}
          />
        </Suspense>

        {/* Сдача дня ЗДЕСЬ, а не только на борде расхода (Plane №1197,
            решение заказчика 12.09.2026): начальник управления ставит
            статусы и на той же странице выбирает дату и сдаёт день. Блок
            рисуется только тому, у кого есть право сдачи
            (`daily_report.mark_update`) — внутри компонента. */}
        <StatusDayClose employeeCount={stats.totalEmployees ?? 0} />

        <dl aria-label="Сводка статусов" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {[
            ["Сотрудников", stats.totalEmployees],
            ["Без статуса", stats.needUpdate],
            ["Просрочено", stats.overdue],
            ["Запланировано", stats.scheduled],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{loading || error ? "—" : value ?? "—"}</dd>
            </div>
          ))}
        </dl>

        {/* Main Content */}
        <Tabs defaultValue="table" className="space-y-6">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <TabsList className={`grid h-auto w-full ${canEdit ? "grid-cols-3" : "grid-cols-2"} sm:inline-flex sm:w-fit`}>
              <TabsTrigger className="min-h-12 whitespace-normal sm:min-h-8 sm:whitespace-nowrap" value="table">Таблица сотрудников</TabsTrigger>
              <TabsTrigger className="min-h-12 whitespace-normal sm:min-h-8 sm:whitespace-nowrap" value="calendar">Календарь статусов</TabsTrigger>
              {canEdit && (
                <TabsTrigger className="min-h-12 whitespace-normal sm:min-h-8 sm:whitespace-nowrap" value="mass-update">Массовое обновление</TabsTrigger>
              )}
            </TabsList>

            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <SecondmentRequestsDialog />
              )}
            </div>
          </div>

          <TabsContent value="table" className="space-y-6">
            <p className="text-sm text-muted-foreground">
              {canEdit
                ? "Текущий статус меняется с сегодняшнего дня. Для будущего периода откройте «Запланированные статусы» в меню сотрудника."
                : "Таблица показывает текущие статусы. Будущие периоды доступны в календаре статусов."}
            </p>
            {error ? (
              <Card>
                <CardContent className="p-6 text-center text-red-500">
                  <p className="mb-4">Ошибка загрузки данных: {error}</p>
                  <Button onClick={handleRefresh} variant="outline">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Попробовать снова
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <StatusTable 
                selectedEmployees={selectedEmployees} 
                onSelectionChange={setSelectedEmployees}
                onRefresh={handleRefresh}
              />
            )}
          </TabsContent>

          <TabsContent value="calendar" className="space-y-6">
            <StatusCalendarBoard />
          </TabsContent>

          {/* Содержимое вкладки снимается вместе с самой вкладкой: оставленное
              под скрытым переключателем, оно открывалось бы по адресу и по
              восстановленному состоянию вкладок. */}
          {canEdit && (
            <TabsContent value="mass-update" className="space-y-6">
              <MassStatusUpdate
                selectedEmployees={selectedEmployees}
                onSuccess={handleRefresh}
                onRetainFailedSelection={(submitted, remaining) => setSelectedEmployees(current => retainFailedMassSelection(current, submitted, remaining))}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
