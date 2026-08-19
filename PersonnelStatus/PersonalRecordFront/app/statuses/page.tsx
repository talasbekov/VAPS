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
import {
  isDirectorateForbidden,
  useStaffUnitsByDirectorate,
} from "@/hooks/use-staff-units-by-directorate"
import { useQueryClient } from "@tanstack/react-query"
import { SecondmentRequestsDialog } from "@/features/secondment-requests/ui/SecondmentRequestsDialog";

export default function StatusesPage() {
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const queryClient = useQueryClient()

  const {
    data,
    isLoading: loading,
    error: queryError,
    refetch,
    isRefetching: refreshing,
    dataUpdatedAt,
  } = useStaffUnitsByDirectorate()

  // Вычисляем статистику из данных
  const stats = useMemo(() => {
    if (!data) {
      return {
        totalEmployees: 0,
        needUpdate: 0,
        overdue: 0,
        scheduled: 0,
      }
    }

    const totalEmployees = data.total_count
    
    // Подсчитываем статистику, обрабатывая оба формата: unit.employee и unit.employees
    let needUpdate = 0
    let overdue = 0
    let scheduled = 0

    data.staff_units.forEach((unit) => {
      // Проверяем оба варианта для обратной совместимости
      const employee = (unit as any).employee
      const employeesArray = (unit as any).employees

      // Если есть массив employees (новый формат)
      if (Array.isArray(employeesArray) && employeesArray.length > 0) {
        employeesArray.forEach((empData: any) => {
          const emp = empData.employee
          if (!emp) {
            needUpdate++
            return
          }

          const status = emp.current_status
          if (!status) {
            needUpdate++
          } else {
            if (status.state === "planned") {
              scheduled++
            }
            if (status.end_date && new Date(status.end_date) < new Date()) {
              overdue++
            }
          }
        })
      }
      // Если есть одиночный employee (старый формат)
      else if (employee) {
        const status = employee.current_status
        if (!status) {
          needUpdate++
        } else {
          if (status.state === "planned") {
            scheduled++
          }
          if (status.end_date && new Date(status.end_date) < new Date()) {
            overdue++
          }
        }
      } else {
        needUpdate++
      }
    })

    return {
      totalEmployees,
      needUpdate,
      overdue,
      scheduled,
    }
  }, [data])

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Произошла ошибка"
    : null

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["staff-units-by-directorate"] })
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
          eyebrow="Личный состав"
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
