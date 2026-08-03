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
