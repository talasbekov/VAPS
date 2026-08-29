"use client";

import { Badge } from "@/components/ui/badge";
import {
  EmployeeStatusType,
  getEmployeeStatusLabel,
  getEmployeeStatusColor,
} from "../model";

interface StatusBadgeProps {
  status: EmployeeStatusType | null | undefined;
  fallback?: string;
  className?: string;
}

export function StatusBadge({
  status,
  fallback = "Не обновлено",
  className,
}: StatusBadgeProps) {
  const label = getEmployeeStatusLabel(status, fallback);
  const colorClasses = getEmployeeStatusColor(status);

  return (
    <Badge className={`${colorClasses} ${className || ""}`}>
      {label}
    </Badge>
  );
}








