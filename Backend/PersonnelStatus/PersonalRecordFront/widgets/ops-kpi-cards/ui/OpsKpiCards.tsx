"use client";

// KPI-полоса командного центра ОМ (по образцу components/dashboard/stats-cards).
import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export interface OpsKpiItem {
  key: string;
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  /** Целый Tailwind-класс цвета иконки. */
  iconClass: string;
}

export function OpsKpiCards({ items }: { items: OpsKpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.key}>
          <CardContent className="flex items-center gap-3 p-4">
            <item.icon className={`h-8 w-8 shrink-0 ${item.iconClass}`} />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-muted-foreground">
                {item.label}
              </p>
              <p className="text-xl font-bold tabular-nums">{item.value}</p>
              {item.hint && (
                <p className="truncate text-[11px] text-muted-foreground">
                  {item.hint}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
