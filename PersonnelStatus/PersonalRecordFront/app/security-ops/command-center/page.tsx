"use client";

// Командный центр ОМ — заглушка Фазы 0 (smoke-тест фундамента: layout,
// mock-worker, права). Наполнение KPI-виджетами — Фаза 4 плана порта.
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart } from "lucide-react";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

export default function CommandCenterPage() {
  const { permissions, isLoading, error } = useOpsPermissions();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <LineChart className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Командный центр</h1>
            <p className="text-muted-foreground">
              Готовность охранных мероприятий
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Раздел в разработке</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Нативный порт Smart Josparlau: фундамент готов, KPI-виджеты
              появятся после портирования реестра ОМ.
            </p>
            {isLoading && <p>Загрузка прав…</p>}
            {error && <p>Не удалось загрузить права раздела.</p>}
            {permissions && (
              <p>
                Права загружены: {permissions.size}{" "}
                {permissions.has("*") ? "(полный доступ)" : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
