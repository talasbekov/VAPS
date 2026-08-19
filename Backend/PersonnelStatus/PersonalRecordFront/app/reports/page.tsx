"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarIcon,
  Download,
  FileSpreadsheet,
  Loader2,
  FileText,
  Users,
  BarChart3,
  Wrench,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  apiClient,
  OpsApiError,
  type StrengthReport,
  type StrengthReportRow,
} from "@/lib/api";
import { useToast } from "@/shared/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function ReportsPage() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [report, setReport] = useState<StrengthReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Выгрузка идёт по одному подразделению, поэтому «занято» держим на строке,
  // а не одним флагом на всю карточку: общий флаг гасил бы кнопки всех строк.
  const [exportingId, setExportingId] = useState<number | null>(null);
  const { toast } = useToast();

  const dateStr = date ? format(date, "yyyy-MM-dd") : undefined;

  // Читаем ЖИВОЙ расход. `division_id` не передаём намеренно: бэк сужает
  // выборку по области видимости сам, и «свой департамент» — его решение.
  const handleLoad = async () => {
    try {
      setLoading(true);
      setReportError(null);
      setReport(await apiClient.getStrengthReport({ businessDate: dateStr }));
    } catch (error) {
      setReport(null);
      setReportError(
        error instanceof OpsApiError
          ? error.message
          : "Не удалось загрузить расход"
      );
    } finally {
      setLoading(false);
    }
  };

  // Выгрузка — по СДАННОМУ дню, поэтому на несданном она законно отказывает.
  // Код DAY_NOT_SUBMITTED показываем как обычное сообщение, а не как ошибку:
  // это не поломка, а состояние дня, и красный тост пугал бы напрасно.
  const handleExport = async (row: StrengthReportRow) => {
    try {
      setExportingId(row.division_id);
      const blob = await apiClient.downloadStrengthReportExport({
        divisionId: row.division_id,
        businessDate: dateStr,
        fileFormat: "xlsx",
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `расход_${row.name}_${dateStr ?? ""}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({ title: "Готово", description: `Расход «${row.name}» скачан` });
    } catch (error) {
      const notSubmitted =
        error instanceof OpsApiError && error.code === "DAY_NOT_SUBMITTED";
      toast({
        title: notSubmitted ? "День не сдан" : "Ошибка",
        description:
          error instanceof OpsApiError
            ? error.message
            : "Не удалось выгрузить расход",
        variant: notSubmitted ? "default" : "destructive",
      });
    } finally {
      setExportingId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto py-10 space-y-8">
        <PageHeader
          eyebrow="Официальные документы"
          title="Отчеты"
          description="Генерация и скачивание отчетов по сотрудникам и статусам."
        />

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card className="md:col-span-2 lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
                Расход Л/С
              </CardTitle>
              <CardDescription>
                Строевая записка на выбранную дату по вашей области видимости.
                Выгрузка доступна для дня, который уже сдан.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">
                    Дата расхода
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-[240px] justify-start text-left font-normal",
                          !date && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date ? (
                          format(date, "d MMMM yyyy", { locale: ru })
                        ) : (
                          <span>Выберите дату</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={setDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <Button onClick={handleLoad} disabled={loading}>
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                  )}
                  Показать расход
                </Button>
              </div>

              {reportError && (
                <p className="text-sm text-destructive-ink">{reportError}</p>
              )}

              {report && report.rows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  На {report.business_date} подразделений в вашей области не
                  найдено.
                </p>
              )}

              {report && report.rows.length > 0 && (
                <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Подразделение</TableHead>
                        <TableHead>Штат</TableHead>
                        <TableHead>В списке</TableHead>
                        <TableHead>Вакансии</TableHead>
                        {/* Порядок колонок задаёт сервер (report.columns), а не
                            ключи объекта row.columns — их порядок в JS не
                            гарантирован и разъехался бы с шапкой. */}
                        {report.columns.map((code) => (
                          <TableHead key={code}>
                            {code}
                          </TableHead>
                        ))}
                        <TableHead>Выгрузка</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.rows.map((row) => (
                        <TableRow key={row.division_id}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>{row.staff_total}</TableCell>
                          <TableCell>{row.list_total}</TableCell>
                          <TableCell>{row.vacancies}</TableCell>
                          {report.columns.map((code) => (
                            <TableCell key={code}>
                              {row.columns[code] ?? 0}
                            </TableCell>
                          ))}
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleExport(row)}
                              disabled={exportingId === row.division_id}
                            >
                              {exportingId === row.division_id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              )}
            </CardContent>
          </Card>

          {/* Заглушка: Статистика отсутствий */}
          <Card className="relative overflow-hidden border-dashed">
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-1.5 rounded-full shadow-sm">
              <Wrench className="h-3.5 w-3.5 animate-pulse" />
              <span>В работе</span>
            </div>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-500" />
                Статистика отсутствий
              </CardTitle>
              <CardDescription>
                Аналитика по типам отсутствий (отпуска, больничные) за выбранный
                период.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-24 bg-muted/30 rounded-md flex items-center justify-center text-muted-foreground text-sm border border-dashed">
                Графики и диаграммы
              </div>
              <Button variant="outline" className="w-full" disabled>
                Сформировать
              </Button>
            </CardContent>
          </Card>

          {/* Заглушка: Штатное расписание */}
          <Card className="relative overflow-hidden border-dashed">
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-1.5 rounded-full shadow-sm">
              <Wrench className="h-3.5 w-3.5 animate-pulse" />
              <span>В работе</span>
            </div>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-purple-500" />
                Штатное расписание
              </CardTitle>
              <CardDescription>
                Полный список сотрудников с должностями и званиями.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-24 bg-muted/30 rounded-md flex items-center justify-center text-muted-foreground text-sm border border-dashed">
                Табличный вид
              </div>
              <Button variant="outline" className="w-full" disabled>
                Скачать Excel
              </Button>
            </CardContent>
          </Card>

          {/* Заглушка: История изменений */}
          <Card className="relative overflow-hidden border-dashed">
            <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-1.5 rounded-full shadow-sm">
              <Wrench className="h-3.5 w-3.5 animate-pulse" />
              <span>В работе</span>
            </div>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-orange-500" />
                Журнал действий
              </CardTitle>
              <CardDescription>
                История изменений статусов и структуры организации.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-24 bg-muted/30 rounded-md flex items-center justify-center text-muted-foreground text-sm border border-dashed">
                Логи системы
              </div>
              <Button variant="outline" className="w-full" disabled>
                Просмотреть
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
