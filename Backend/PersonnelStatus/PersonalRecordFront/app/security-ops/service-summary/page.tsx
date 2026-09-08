"use client";

// «Свод по Службе» (Plane №992) — рабочее место оперативного дежурного.
// Видимость решает сама `ServiceSummaryScreen` — по РОЛИ DUTY_OFFICER, а не
// по общему модульному праву: `daily_report.generate` шире одной этой роли
// (им же гейтится «Свод департамента», Plane №990), и запись в
// `MODULE_PERMISSION` открыла бы экран не тому.
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
          description="Готовность сдачи расхода по всей организации — по дате или диапазону"
        />
        <ServiceSummaryScreen />
      </div>
    </DashboardLayout>
  );
}
