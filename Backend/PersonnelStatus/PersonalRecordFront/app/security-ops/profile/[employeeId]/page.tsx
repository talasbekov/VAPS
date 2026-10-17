"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ServiceEmployeeProfile } from '@/features/service-employees/ui/ServiceEmployeeProfile';
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { LoadFailure } from "@/components/load-failure";
import { opsApiClient } from "@/lib/ops-api";
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
  const query = useSearchParams();
  if (query.get('directory') === '1') {
    return <ServiceEmployeeProfile id={params?.employeeId ?? ''} filters={query.get('filters') ?? ''} />;
  }
  return <LegacyEmployeeProfileScreen />;
}

function LegacyEmployeeProfileScreen() {
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
  const mayConfirmPersonally = access.data?.results.some(
    (assignment) => assignment.canConfirmWithoutAccount === true
  ) ?? false;
  if (access.readAccessBlocked) {
    return <OpsAccessDenied what="профиля сотрудника" actions={
      <Button variant="outline" disabled={access.isFetching} onClick={() => { void access.refetch(); }}>
        {access.isFetching ? "Проверяем…" : "Повторить проверку профиля"}
      </Button>
    } />;
  }
  if (access.data === undefined) {
    return <DashboardLayout>{access.isError ? (
      <LoadFailure what="доступ к профилю сотрудника" onRetry={() => { void access.refetch(); }} isRetrying={access.isFetching} />
    ) : <p className="text-sm text-muted-foreground">Проверяем доступ к профилю сотрудника…</p>}</DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Личный кабинет · сотрудник"
          title="Профиль сотрудника"
          description={
            mayConfirmPersonally
              ? "Назначения сотрудника и личное доведение для сотрудников без учётной записи"
              : "Только чтение: назначения, календарь и история службы сотрудника"
          }
          actions={
            <span
              className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground"
              data-slot={mayConfirmPersonally ? "personal-acknowledgement" : "read-only"}
            >
              {mayConfirmPersonally ? "Ознакомление подчинённого" : "Только чтение"}
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
        {employee.isSuccess && <ProfileBody employee={employee.data} readOnly />}
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
