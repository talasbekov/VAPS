"use client";

import Link from "next/link";
import { MODULE_PERMISSION } from "@/entities/portal-access";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

const sources = [
  { key: "service", href: "/security-ops/analytics", label: "Аналитика службы",
    permission: MODULE_PERMISSION["/security-ops/analytics"] },
  { key: "operations", href: "/security-ops/analytics/operations", label: "Аналитика мероприятий",
    permission: MODULE_PERMISSION["/security-ops/analytics/operations"] },
  { key: "rating", href: "/security-ops/ratings/analytics", label: "Аналитика рейтинга",
    permission: MODULE_PERMISSION["/security-ops/analytics"] },
] as const;

export function AnalyticsNavigation({ current }: { current: "service" | "operations" | "rating" }) {
  const access = useOpsPermissions();
  if (access.isLoading || access.error) return null;
  return (
    <nav aria-label="Разделы аналитики" className="flex flex-wrap gap-2">
      {sources.filter(source => access.hasPermission(source.permission)).map(source => (
        <Link key={source.key} href={source.href} aria-current={current === source.key ? "page" : undefined}
          className={`inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm ${current === source.key ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>
          {source.label}
        </Link>
      ))}
    </nav>
  );
}
