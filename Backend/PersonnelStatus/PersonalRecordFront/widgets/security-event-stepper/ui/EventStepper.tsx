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
//
// Шаг становится КНОПКОЙ только когда переданы `onSelect` (право обхода есть),
// иначе остаётся статичной пилюлей: кликабельная на вид, но мёртвая метка —
// обещание действия, которого нет. Состояний четыре, и «просмотр» отличается
// от остальных не только цветом, но и словом: цвет один информацию не несёт.
import {
  EVENT_STEPS,
  STAGE_WITHIN_STEP,
  stepIndexOfStage,
} from "@/entities/security-event";
import type { SecurityEventStage } from "@/entities/security-event";

const PILL_BASE =
  "rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors";
const PILL_STATE = {
  current: "bg-primary text-primary-foreground",
  done: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-200",
  future: "bg-muted text-muted-foreground font-normal",
  viewed:
    "bg-background text-foreground ring-2 ring-primary ring-offset-1 ring-offset-background",
} as const;

export function EventStepper({
  stage,
  viewedIndex,
  onSelect,
}: {
  stage: SecurityEventStage;
  /** Просматриваемый шаг. Совпадает с текущим, пока карточку не «листали». */
  viewedIndex?: number;
  /** Есть — шаги кликабельны (право обхода); нет — цепочка только показывает. */
  onSelect?: (index: number) => void;
}) {
  const currentIndex = stepIndexOfStage(stage);
  const shownIndex = viewedIndex ?? currentIndex;
  const within = STAGE_WITHIN_STEP[stage];
  return (
    <div className="space-y-1">
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Этапы ОМ">
        {EVENT_STEPS.map((step, index) => {
          // «Просмотр» перебивает остальные состояния: человек смотрит именно
          // сюда, и это важнее того, пройден шаг или нет.
          const state =
            index === shownIndex && index !== currentIndex
              ? "viewed"
              : index === currentIndex
                ? "current"
                : index < currentIndex
                  ? "done"
                  : "future";
          const label = `${index + 1}. ${step.label}`;
          return (
            <li key={step.key} className="flex items-center gap-1.5">
              {onSelect === undefined ? (
                <span
                  aria-current={state === "current" ? "step" : undefined}
                  className={`${PILL_BASE} ${PILL_STATE[state]}`}
                >
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  aria-current={state === "current" ? "step" : undefined}
                  // Нажатая пилюля — именно просматриваемая, а не стадия ОМ:
                  // скринридер иначе объявлял бы выбранным шаг, который на
                  // экране не открыт.
                  aria-pressed={index === shownIndex}
                  onClick={() => onSelect(index)}
                  className={`${PILL_BASE} ${PILL_STATE[state]} hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`}
                >
                  {label}
                </button>
              )}
              {index < EVENT_STEPS.length - 1 && (
                <span className="text-muted-foreground/50">›</span>
              )}
            </li>
          );
        })}
      </ol>
      {shownIndex !== currentIndex ? (
        <p className="text-xs text-muted-foreground">
          Просмотр шага {shownIndex + 1} из {EVENT_STEPS.length} · мероприятие
          стоит на шаге {currentIndex + 1}
        </p>
      ) : (
        within !== "" && (
          <p className="text-xs text-muted-foreground">
            Шаг {currentIndex + 1} из {EVENT_STEPS.length} · {within}
          </p>
        )
      )}
    </div>
  );
}
