"use client";

// Боевые группы на Трассе (§24) — отдельная страница при разделе дежурств:
// процесс §24.1 независим от месячного плана (/security-ops/duties), общего
// стора у них нет намеренно.
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { PageHeader } from "@/components/page-header";
import { CombatDutyGroupsSection } from "@/features/ops-combat/combat-groups-section";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

export default function CombatDutyGroupsPage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  if (!permissionsLoading && !hasPermission("duty.view")) {
    return <OpsAccessDenied what="боевых групп на Трассе" />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <PageHeader
          eyebrow="Дежурства и расход"
          title="Боевые группы на Трассе"
          description="Потребность, подача и рассмотрение состава, ознакомление, заступление, сдача смены и факт несения."
        />
        <p className="text-sm">
          <Link href="/security-ops/duties" className="text-primary-ink underline">
            ← План дежурств
          </Link>
        </p>
        <CombatDutyGroupsSection />
      </div>
    </DashboardLayout>
  );
}
