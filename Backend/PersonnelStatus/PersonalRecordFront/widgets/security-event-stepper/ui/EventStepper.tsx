"use client";

// Горизонтальный степпер девяти стадий жизненного цикла ОМ: пройденные,
// текущая и будущие различимы визуально.
import { STAGE_LABEL, STAGE_ORDER } from "@/entities/security-event";
import type { SecurityEventStage } from "@/entities/security-event";

export function EventStepper({ stage }: { stage: SecurityEventStage }) {
  const currentIndex = STAGE_ORDER.indexOf(stage);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Этапы ОМ">
      {STAGE_ORDER.map((item, index) => {
        const state =
          index < currentIndex
            ? "done"
            : index === currentIndex
              ? "current"
              : "future";
        return (
          <li key={item} className="flex items-center gap-1.5">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={
                state === "current"
                  ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground"
                  : state === "done"
                    ? "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800"
                    : "rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
              }
            >
              {index + 1}. {STAGE_LABEL[item]}
            </span>
            {index < STAGE_ORDER.length - 1 && (
              <span className="text-muted-foreground/50">›</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
