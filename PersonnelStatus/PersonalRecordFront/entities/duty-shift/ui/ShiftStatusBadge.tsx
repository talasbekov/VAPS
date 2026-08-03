"use client";

import { Badge } from "@/components/ui/badge";
import type { DutyShiftState } from "../model/types";
import { DUTY_STATE_LABEL } from "../model/plan-lifecycle";

const STATE_CLASS: Record<DutyShiftState, string> = {
  PLANNED: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  ACKNOWLEDGED: "bg-purple-100 text-purple-800 hover:bg-purple-100",
  ACTIVE: "bg-green-100 text-green-800 hover:bg-green-100",
  COMPLETED: "bg-muted text-muted-foreground hover:bg-muted",
  CANCELLED: "bg-red-100 text-red-800 hover:bg-red-100",
};

export function ShiftStatusBadge({
  state,
  className,
}: {
  state: DutyShiftState;
  className?: string;
}) {
  return (
    <Badge className={`${STATE_CLASS[state]} ${className || ""}`}>
      {DUTY_STATE_LABEL[state]}
    </Badge>
  );
}
