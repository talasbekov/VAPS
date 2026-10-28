"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { moduleOpenFor } from "@/entities/portal-access";
import { DailyExpenseBoard } from "@/features/daily-expense";
import { ResponsibleDailyExpense } from "@/features/daily-expense/ui/ResponsibleDailyExpense";
import { DailyActionQueue } from "@/features/forces-workspace/ui/DailyActionQueue";
import { dailyExpenseHref, responsibleDepartmentScope } from "@/features/forces-workspace/model/workspace";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

export default function DailyExpensePage() {
  return <Suspense fallback={<p role="status">Загрузка ежедневного расхода…</p>}><DailyExpenseEntry /></Suspense>;
}

function DailyExpenseEntry() {
  const access = useOpsPermissions();
  const query = useSearchParams();
  const router = useRouter();
  if (!access.error && (access.isLoading || access.permissions === undefined)) {
    return <DashboardLayout><p role="status">Проверка доступа к ежедневному расходу…</p></DashboardLayout>;
  }
  if (access.error || !moduleOpenFor("/daily-expense", access.hasPermission)) {
    return <OpsAccessDenied what="ежедневного расхода" actions={<p className="text-sm text-muted-foreground">Нужны чтение статусов и полномочия сдачи, формирования свода или корректировки.</p>} />;
  }

  // Only existing, unambiguous department assignments choose the specialized
  // view. Other scoped roles use the server-filtered division picker.
  const department = !access.globalPermissions?.has("*") && responsibleDepartmentScope(access.roles) !== null;
  const props = {
    businessDate: query.get("businessDate") ?? undefined,
    onBusinessDateChange(date: string) {
      const next = new URLSearchParams(query);
      next.set("businessDate", date);
      router.replace(dailyExpenseHref(next), { scroll: false });
    },
  };
  return <DashboardLayout><div className="space-y-5">
    <PageHeader title="Ежедневный расход" description="Состав и сдачи доступных подразделений на выбранную дату." />
    {department ? <>
      <DailyActionQueue query={new URLSearchParams(query)} standalone />
      <ResponsibleDailyExpense {...props} />
    </> : <DailyExpenseBoard {...props} />}
  </div></DashboardLayout>;
}
