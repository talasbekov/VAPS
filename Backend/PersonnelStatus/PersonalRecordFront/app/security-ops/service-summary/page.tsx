"use client";

// «Свод по Службе» (Plane №992/№1115) — рабочее место ответственного за сбор
// сил. Видимость решает сама `ServiceSummaryScreen` по общей ролевой карте.
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { ServiceSummaryScreen } from "@/features/service-summary";

export default function ServiceSummaryPage() {
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Ежедневный расход"
          title="Свод по Службе"
          description="Проверьте сдачу управлений и отправку сводов департаментов за дату или период, затем соберите свод Службы. Департаменты готовят и отправляют свои своды в рабочем месте ответственного за расход."
        />
        <ServiceSummaryScreen />
      </div>
    </DashboardLayout>
  );
}
