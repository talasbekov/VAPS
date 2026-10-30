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
import { useId } from 'react';
import { Check } from 'lucide-react';
import styles from './EventStepper.module.css';
import {
  EVENT_STEPS,
  STAGE_WITHIN_STEP,
  stepIndexOfStage,
} from "@/entities/security-event";
import type { SecurityEventStage } from "@/entities/security-event";

const STATE_LABEL = { current: 'Текущий этап', done: 'Завершено', future: 'Ожидает выполнения', viewed: 'Просмотр' } as const;

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
  const statusId = useId();
  const currentIndex = stepIndexOfStage(stage);
  const shownIndex = viewedIndex ?? currentIndex;
  const within = STAGE_WITHIN_STEP[stage];
  return (
    <div className={styles.stepper} data-testid="event-stepper" data-stage={stage} data-closed={stage === 'CLOSED' ? 'true' : undefined}>
      <ol className={styles.steps} aria-label="Этапы ОМ">
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
          // Пройденные — с галочкой (`[РЕК-01]`, Plane №442): состояние
          // читается и без цвета плитки.
          const label = `${state === "done" ? "✓ " : ""}${index + 1}. ${step.label}`;
          const closedStep = stage === 'CLOSED' && index === currentIndex;
          const status = closedStep && state !== 'viewed' ? 'Закрыто' : STATE_LABEL[state];
          const content = <>
            <span className={styles.marker} aria-hidden="true">{state === 'done' || closedStep ? <Check size={20} strokeWidth={2.5} /> : index + 1}</span>
            <span className={styles.title}><span className="sr-only">{index + 1}. </span>{step.label}</span>
            <span className={styles.status} id={`${statusId}-${index}`}>{status}</span>
          </>;
          return (
            <li key={step.key} className={styles.step} data-state={state}>
              {onSelect === undefined ? (
                <span
                  aria-current={state === "current" ? "step" : undefined}
                  className={styles.card}
                >
                  {content}
                </span>
              ) : (
                <button
                  type="button"
                  aria-current={state === "current" ? "step" : undefined}
                  // Нажатая пилюля — именно просматриваемая, а не стадия ОМ:
                  // скринридер иначе объявлял бы выбранным шаг, который на
                  // экране не открыт.
                  aria-pressed={index === shownIndex}
                  aria-label={label}
                  aria-describedby={`${statusId}-${index}`}
                  onClick={() => onSelect(index)}
                  className={styles.card}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {shownIndex !== currentIndex ? (
        <p className={styles.caption}>
          Просмотр шага {shownIndex + 1} из {EVENT_STEPS.length} · мероприятие
          стоит на шаге {currentIndex + 1}
        </p>
      ) : (
        within !== "" && (
          <p className={styles.caption}>
            Шаг {currentIndex + 1} из {EVENT_STEPS.length} · {within}
          </p>
        )
      )}
    </div>
  );
}
