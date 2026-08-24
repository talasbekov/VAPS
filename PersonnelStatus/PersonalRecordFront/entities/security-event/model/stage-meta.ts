// Русские подписи и классы бейджей стадий ОМ. Порядок стадий один на весь
// домен — второй список разошёлся бы молча; через него отличается переход
// вперёд от возврата на доработку.
import type { JournalEntryType, SecurityEventStage } from "./types";

export const STAGE_ORDER: readonly SecurityEventStage[] = [
  "BULLETIN",
  "RECON",
  "DEMAND",
  "FORCES",
  "PLACEMENT",
  "APPROVAL",
  "ACKNOWLEDGEMENT",
  "CONDUCT",
  "CLOSED",
];

export const STAGE_LABEL: Record<SecurityEventStage, string> = {
  BULLETIN: "Бюллетень",
  RECON: "Рекогносцировка",
  DEMAND: "Потребность",
  FORCES: "Запрос сил",
  PLACEMENT: "Расстановка",
  APPROVAL: "Согласование",
  ACKNOWLEDGEMENT: "Ознакомление",
  CONDUCT: "Проведение",
  CLOSED: "Закрыто",
};

/** Подписи типов записей журнала штаба — общие для карточки и архива. */
export const JOURNAL_TYPE_LABEL: Record<JournalEntryType, string> = {
  INSTRUCTION: "Инструктаж",
  ORDER: "Распоряжение",
  INCIDENT: "Инцидент",
  REPLACEMENT: "Замена",
};

/** Заливка полосы готовности — та же цветовая семья, что бейдж стадии,
 * но сплошной тон вместо светлого фона. */
export const STAGE_PROGRESS_CLASS: Record<SecurityEventStage, string> = {
  BULLETIN: "bg-purple-600",
  RECON: "bg-purple-600",
  DEMAND: "bg-amber-600",
  FORCES: "bg-amber-600",
  PLACEMENT: "bg-primary",
  APPROVAL: "bg-green-600",
  ACKNOWLEDGEMENT: "bg-primary",
  CONDUCT: "bg-green-600",
  CLOSED: "bg-muted-foreground/40",
};

/** Классы бейджа стадии — целые Tailwind-классы (JIT видит только литералы). */
export const STAGE_BADGE_CLASS: Record<SecurityEventStage, string> = {
  BULLETIN: "bg-purple-100 text-purple-800 hover:bg-purple-100",
  RECON: "bg-purple-100 text-purple-800 hover:bg-purple-100",
  DEMAND: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  FORCES: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  PLACEMENT: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  APPROVAL: "bg-green-100 text-green-800 hover:bg-green-100",
  ACKNOWLEDGEMENT: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  CONDUCT: "bg-green-100 text-green-800 hover:bg-green-100",
  CLOSED: "bg-muted text-muted-foreground hover:bg-muted",
};

/**
 * Цепочка шагов, которую видит пользователь, — ПЯТЬ: Рекогносцировка →
 * Расстановка → Согласование → Ознакомление → Закрытие.
 *
 * Шага «Бюллетень» в цепочке больше нет (решение заказчика 24.08.2026): его
 * сведения и форма стоят НАД этапами, в шапке карточки. Стадия `BULLETIN` у
 * бэкенда осталась — она уехала в шаг «Рекогносцировка», а не выброшена:
 * `stepIndexOfStage` ищет стадию среди шагов, и стадия без шага печатала бы
 * «Шаг 0 из 5».
 *
 * Стадий у бэкенда по-прежнему девять, и это не рассинхрон по недосмотру:
 *
 * * «Потребность» и «Запрос сил» свёрнуты в шаг «Расстановка». Пропустить их
 *   нельзя — сервер требует данных, которых прототип не собирает вовсе:
 *   группу по каждой строке потребности и выделенную численность по каждому
 *   запросу. Автоподстановка тут означала бы выдумать распределение сил;
 * * «Проведение» свёрнуто в шаг «Закрытие»: закрытие мероприятия и так
 *   происходит там, а журнал штаба и замена выбывшего — живые операции с
 *   аудитом, и выкидывать их вместе с экраном нельзя;
 * * «Закрыто» — не шаг, а состояние: закрытое дело показывает архив.
 */
export const EVENT_STEPS = [
  { key: "RECON", label: "Рекогносцировка", stages: ["BULLETIN", "RECON"] },
  { key: "PLACEMENT", label: "Расстановка", stages: ["DEMAND", "FORCES", "PLACEMENT"] },
  { key: "APPROVAL", label: "Согласование", stages: ["APPROVAL"] },
  { key: "ACKNOWLEDGEMENT", label: "Ознакомление", stages: ["ACKNOWLEDGEMENT"] },
  { key: "CLOSURE", label: "Закрытие", stages: ["CONDUCT", "CLOSED"] },
] as const satisfies readonly {
  key: string;
  label: string;
  stages: readonly SecurityEventStage[];
}[];

/** Индекс шага цепочки для стадии бэкенда; -1 не бывает — покрыты все девять. */
export function stepIndexOfStage(stage: SecurityEventStage): number {
  return EVENT_STEPS.findIndex((step) =>
    (step.stages as readonly string[]).includes(stage)
  );
}

/**
 * Подпись «где мы внутри шага» для стадий, свёрнутых в один шаг. Пустая
 * строка — стадия занимает весь шаг и уточнять нечего.
 */
export const STAGE_WITHIN_STEP: Record<SecurityEventStage, string> = {
  BULLETIN: "Бюллетень заполняется над этапами",
  RECON: "",
  DEMAND: "Подготовка расчёта: потребность",
  FORCES: "Подготовка расчёта: выделение сил",
  PLACEMENT: "",
  APPROVAL: "",
  ACKNOWLEDGEMENT: "",
  CONDUCT: "Проведение и закрытие",
  CLOSED: "Дело закрыто",
};
