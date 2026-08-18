"use client"

import { useState, useMemo } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { StatusTable } from "@/components/status-table"
import { MassStatusUpdate } from "@/components/mass-status-update"
import { StatusCalendar } from "@/widgets/status-calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar, Users, AlertTriangle, Clock, Download, Upload, RefreshCw } from "lucide-react"
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Управление статусами</h1>
            <p className="text-muted-foreground mt-1">Контроль и обновление статусов сотрудников</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="text-sm">
              Последнее обновление: {lastUpdate ? lastUpdate.toLocaleString("ru-RU") : "—"}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Обновить
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Всего сотрудников</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalEmployees}</div>
              <p className="text-xs text-muted-foreground">Активных записей</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Требует обновления</CardTitle>
              <Clock className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.needUpdate}</div>
              <p className="text-xs text-muted-foreground">Статусы устарели</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Просрочено</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
              <p className="text-xs text-muted-foreground">Критические задержки</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Запланировано</CardTitle>
              <Calendar className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.scheduled}</div>
              <p className="text-xs text-muted-foreground">Будущие изменения</p>
            </CardContent>
          </Card>
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
