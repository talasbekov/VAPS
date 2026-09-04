"use client";

// Профиль СОТРУДНИКА для администратора — только чтение (`[ПРФ-08]`, Plane
// №449). Тот же виджет, что и у «Моего профиля», без кнопок ответа на
// назначение; назначения — по `?employee=`, и право на них проверяет сервер
// (`may_read`: область `status.manage`), а не экран. Руководители своих
// сотрудников смотрят в «Статусах сотрудников» — сюда их не ведёт ничего.
import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError } from "@/lib/ops-errors";
import type { OpsApiFailure } from "@/lib/ops-errors";
import type { CoreEmployee } from "@/lib/api";
import { useMyAssignments } from "@/hooks/use-my-assignments";
import { ProfileBody } from "@/widgets/my-profile";

export default function EmployeeProfilePage() {
  // useParams в клиентском поддереве: граница Suspense — конвенция раздела.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <EmployeeProfileScreen />
    </Suspense>
  );
}

function EmployeeProfileScreen() {
  const params = useParams<{ employeeId: string }>();
  const id = params?.employeeId ?? "";
  const employee = useQuery<CoreEmployee, OpsApiFailure>({
    queryKey: ["core-employee", id],
    queryFn: () => opsApiClient.get<CoreEmployee>(`/api/core/employees/${encodeURIComponent(id)}/`),
    enabled: id !== "",
  });
  // Право читать чужой профиль решает ручка назначений: отказ — закрытый
  // раздел, а не пустые вкладки.
  const access = useMyAssignments(id === "" ? undefined : id);
  const denied =
    access.isError &&
    access.error instanceof OpsApiError &&
    (access.error.status === 403 || access.error.status === 401);

  if (denied) {
    return <OpsAccessDenied what="профиля сотрудника" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Личный кабинет · сотрудник"
          title="Профиль сотрудника"
          description="Только чтение: назначения, календарь и история службы сотрудника"
          actions={
            <span
              className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground"
              data-slot="read-only"
            >
              Только чтение
            </span>
          }
        />
        {employee.isPending && (
          <p className="text-sm text-muted-foreground">Загрузка кадровой записи…</p>
        )}
        {employee.isError && (
          <LoadFailure
            what="кадровую запись"
            onRetry={() => void employee.refetch()}
            isRetrying={employee.isFetching}
          />
        )}
        {employee.data !== undefined && <ProfileBody employee={employee.data} readOnly />}
        <Card>
          <CardContent className="p-4 text-xs text-muted-foreground">
            Свой профиль —{" "}
            <Link href="/security-ops/profile" className="font-semibold text-primary-ink">
              Мой профиль →
            </Link>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
