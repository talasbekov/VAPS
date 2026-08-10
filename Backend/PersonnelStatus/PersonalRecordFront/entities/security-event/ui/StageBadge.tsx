"use client";

import { Badge } from "@/components/ui/badge";
import type { SecurityEventStage } from "../model/types";
import { STAGE_BADGE_CLASS, STAGE_LABEL } from "../model/stage-meta";

interface StageBadgeProps {
  stage: SecurityEventStage;
  className?: string;
}

export function StageBadge({ stage, className }: StageBadgeProps) {
  return (
    <Badge className={`${STAGE_BADGE_CLASS[stage]} ${className || ""}`}>
      {STAGE_LABEL[stage]}
    </Badge>
  );
}
