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
import { apiClient } from "@/lib/api";
import { useToast } from "@/shared/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DashboardLayout } from "@/components/dashboard-layout";

export default function ReportsPage() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleDownload = async () => {
    try {
      setLoading(true);
      const dateStr = date ? format(date, "yyyy-MM-dd") : undefined;
      const blob = await apiClient.downloadExpenseReport(dateStr);

      // Создаем ссылку для скачивания
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `expense_report_${
        dateStr || format(new Date(), "yyyy-MM-dd")
      }.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Успешно",
        description: "Отчет успешно скачан",
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось скачать отчет",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Отчеты</h1>
          <p className="text-muted-foreground">
            Генерация и скачивание отчетов по сотрудникам и статусам.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
                Расход Л/С для своего департамента
              </CardTitle>
              <CardDescription>
                Генерация отчета "Расход" по вашему департаменту за выбранную
                дату.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Дата отчета
                </label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
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
              <Button
                className="w-full"
                onClick={handleDownload}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Скачать отчет
              </Button>
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
