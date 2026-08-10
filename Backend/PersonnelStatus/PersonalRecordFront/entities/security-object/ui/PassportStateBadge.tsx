"use client";

import { Badge } from "@/components/ui/badge";
import type { PassportState } from "../model/types";
import { PASSPORT_STATE_LABEL } from "../model/freshness";

const PASSPORT_STATE_CLASS: Record<PassportState, string> = {
  GREEN: "bg-green-100 text-green-800 hover:bg-green-100",
  YELLOW: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  RED: "bg-red-100 text-red-800 hover:bg-red-100",
};

interface PassportStateBadgeProps {
  state: PassportState;
  className?: string;
}

export function PassportStateBadge({ state, className }: PassportStateBadgeProps) {
  return (
    <Badge className={`${PASSPORT_STATE_CLASS[state]} ${className || ""}`}>
      {PASSPORT_STATE_LABEL[state]}
    </Badge>
  );
}
