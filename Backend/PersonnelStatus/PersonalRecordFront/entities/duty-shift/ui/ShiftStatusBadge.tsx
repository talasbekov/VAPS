"use client";

import { Badge } from "@/components/ui/badge";
import type { DutyShiftState } from "../model/types";
import { DUTY_STATE_LABEL } from "../model/plan-lifecycle";

const STATE_CLASS: Record<DutyShiftState, string> = {
  PLANNED: "sj-status-neutral",
  ACKNOWLEDGED: "sj-status-pending",
  ACTIVE: "sj-status-success",
  COMPLETED: "sj-status-success",
  CANCELLED: "sj-status-error",
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
