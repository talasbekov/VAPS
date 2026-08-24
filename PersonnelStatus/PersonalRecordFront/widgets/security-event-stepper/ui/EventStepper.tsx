"use client";

// Горизонтальный степпер жизненного цикла ОМ. Шагов ПЯТЬ: шаг «Бюллетень»
// снят 24.08.2026 — его сведения стоят над этапами (см. EVENT_STEPS в
// entities/security-event: стадия «Бюллетень» входит в шаг «Рекогносцировка»,
// «Потребность» и «Запрос сил» свёрнуты в «Расстановку», «Проведение» — в
// «Закрытие»).
//
// Когда текущая стадия лишь часть шага, под цепочкой стоит подпись, где
// именно внутри шага находится мероприятие: цепочка не должна делать вид, что
// подготовка расчёта — это уже расстановка.
import {
  EVENT_STEPS,
  STAGE_WITHIN_STEP,
  stepIndexOfStage,
} from "@/entities/security-event";
import type { SecurityEventStage } from "@/entities/security-event";

export function EventStepper({ stage }: { stage: SecurityEventStage }) {
  const currentIndex = stepIndexOfStage(stage);
  const within = STAGE_WITHIN_STEP[stage];
  return (
    <div className="space-y-1">
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Этапы ОМ">
        {EVENT_STEPS.map((step, index) => {
          const state =
            index < currentIndex
              ? "done"
              : index === currentIndex
                ? "current"
                : "future";
          return (
            <li key={step.key} className="flex items-center gap-1.5">
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
                {index + 1}. {step.label}
              </span>
              {index < EVENT_STEPS.length - 1 && (
                <span className="text-muted-foreground/50">›</span>
              )}
            </li>
          );
        })}
      </ol>
      {within !== "" && (
        <p className="text-xs text-muted-foreground">
          Шаг {currentIndex + 1} из {EVENT_STEPS.length} · {within}
        </p>
      )}
    </div>
  );
}
