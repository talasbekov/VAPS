// Текст отказа диалога «Выделить машину» (Plane №967) — обёртка над общей
// `friendlyOpsErrorMessage` (`lib/ops-errors.ts`) со своим текстом отказа
// прав: это действие теряет право `event.manage` («выделять транспорт»),
// у соседних диалогов того же семейства (снять транспорт, добавить объекты)
// текст свой.
import { friendlyOpsErrorMessage } from "@/lib/ops-errors";

const PERMISSION_MESSAGE = "Нет права выделять транспорт на это мероприятие.";

export function allocationErrorMessage(error: unknown): string {
  return friendlyOpsErrorMessage(error, PERMISSION_MESSAGE);
}
