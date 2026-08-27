"use client"

import { useState, useMemo } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { PageHeader } from "@/components/page-header"
import { StatusTable } from "@/components/status-table"
import { MassStatusUpdate } from "@/components/mass-status-update"
import { StatusCalendar } from "@/widgets/status-calendar"
import { Card, CardContent } from "@/components/ui/card"
import { StatCard } from "@/components/stat-card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Download, Upload, RefreshCw } from "lucide-react"
import { DirectorateAccessNotice } from "@/components/directorate-access-notice"
import { isDirectorateForbidden } from "@/hooks/use-staff-units-by-directorate"
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page"
import { useQueryClient } from "@tanstack/react-query"
import { SecondmentRequestsDialog } from "@/features/secondment-requests/ui/SecondmentRequestsDialog";

export default function StatusesPage() {
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
    refetch,
    isRefetching: refreshing,
    dataUpdatedAt,
  } = useStaffUnitsPage({ page: 1, pageSize: 1, withSummary: true })

  const stats = useMemo(() => {
    const summary = data?.summary
    return {
      totalEmployees: summary?.employees ?? 0,
      needUpdate: summary?.without_status ?? 0,
      overdue: summary?.overdue ?? 0,
      scheduled: summary?.scheduled ?? 0,
    }
  }, [data?.summary])

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Произошла ошибка"
    : null

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  const handleRefresh = () => {
    // Обе семьи ключей: сводка шапки и страницы таблицы — разные запросы с
    // 28.08.2026, и «Обновить» обязано освежить оба (Plane №231).
    queryClient.invalidateQueries({ queryKey: ["staff-units-by-directorate"] })
    queryClient.invalidateQueries({ queryKey: ["staff-units-page"] })
    refetch()
  }

  // Все три вкладки и счётчики читают ОДИН запрос directorate: закрыта ручка —
  // закрыт экран. Показывать шапку с нулями было бы враньём о подразделении.
  if (isDirectorateForbidden(queryError)) {
    return (
      <DashboardLayout>
        <DirectorateAccessNotice reason={queryError.message} />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          eyebrow="Ежедневный расход"
          title="Управление статусами"
          description="Контроль и обновление статусов сотрудников"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="text-sm">
                Последнее обновление: {lastUpdate ? lastUpdate.toLocaleString("ru-RU") : "—"}
              </Badge>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                Обновить
              </Button>
            </div>
          }
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            label="Всего сотрудников"
            value={stats.totalEmployees}
            caption="Активных записей"
          />

          <StatCard
            label="Требует обновления"
            value={stats.needUpdate}
            tone="warning"
            caption="Статусы устарели"
          />

          <StatCard
            label="Просрочено"
            value={stats.overdue}
            tone="danger"
            caption="Критические задержки"
          />

          <StatCard
            label="Запланировано"
            value={stats.scheduled}
            tone="info"
            caption="Будущие изменения"
          />
        </div>

        {/* Main Content */}
        <Tabs defaultValue="table" className="space-y-6">
          <div className="flex items-center justify-between">
            {/* Ряд вкладок шире экрана телефона — скроллим сам ряд, а не страницу. */}
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="table">Таблица сотрудников</TabsTrigger>
              <TabsTrigger value="calendar">Календарь статусов</TabsTrigger>
              <TabsTrigger value="mass-update">Массовое обновление</TabsTrigger>
            </TabsList>

            <div className="flex flex-wrap items-center gap-2">
              <SecondmentRequestsDialog />
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-2" />
                Импорт
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Экспорт
              </Button>
            </div>
          </div>

          <TabsContent value="table" className="space-y-6">
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
            <StatusCalendar />
          </TabsContent>

          <TabsContent value="mass-update" className="space-y-6">
            <MassStatusUpdate 
              selectedEmployees={selectedEmployees} 
              onSuccess={handleRefresh}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
