"use client";

// Боевые группы на Трассе (§24) — отдельная страница при разделе дежурств:
// процесс §24.1 независим от месячного плана (/security-ops/duties), общего
// стора у них нет намеренно.
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Shield } from "lucide-react";
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
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Боевые группы на Трассе</h1>
            <p className="text-muted-foreground">
              Потребность, подача и рассмотрение состава, ознакомление,
              заступление, сдача смены и факт несения.
            </p>
          </div>
        </div>
        <p className="text-sm">
          <Link href="/security-ops/duties" className="text-primary underline">
            ← План дежурств
          </Link>
        </p>
        <CombatDutyGroupsSection />
      </div>
    </DashboardLayout>
  );
}
