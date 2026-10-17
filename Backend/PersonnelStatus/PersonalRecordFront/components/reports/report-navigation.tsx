"use client";

import Link from "next/link";
import { moduleOpenFor } from "@/entities/portal-access";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

const sources = [
  { key: "daily", href: "/reports", label: "Расход и кадровые отчёты" },
  { key: "service", href: "/security-ops/service-reports", label: "Дежурства и документы ОМ" },
] as const;

export function ReportNavigation({ current }: { current: "daily" | "service" }) {
  const access = useOpsPermissions();
  if (access.isLoading || access.error) return null;
  return (
    <nav aria-label="Источники отчётов" className="flex flex-wrap gap-2">
      {sources.filter(source => moduleOpenFor(source.href, access.hasPermission)).map(source => (
        <Link key={source.key} href={source.href} aria-current={current === source.key ? "page" : undefined}
          className={`inline-flex min-h-10 items-center rounded-md border px-3 py-2 text-sm ${current === source.key ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>
          {source.label}
        </Link>
      ))}
    </nav>
  );
}
