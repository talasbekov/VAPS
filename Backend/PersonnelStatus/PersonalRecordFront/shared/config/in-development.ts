/**
 * Метки фактически незавершённых функций.
 *
 * Основание — отсутствие реализации в текущем коде. Открытый номер задачи
 * сам по себе не означает, что работающий экран находится в разработке.
 * Сверка 07.10.2026: прежние пункты маршрутов и этапов уже реализованы.
 * У частично готового раздела метка ставится на конкретную функцию.
 */
import type { SecurityEventStage } from "@/entities/security-event";

export interface InDevelopmentNote {
  /** Конкретные возможности, которые ещё не реализованы. */
  pending: readonly string[];
}

// Меню и заголовки используют один реестр. Добавлять только подтверждённые
// незавершённые экраны; вложенный маршрут наследует самый длинный префикс.
const BY_ROUTE: Record<string, InDevelopmentNote> = {};
const BY_STAGE: Partial<Record<SecurityEventStage, InDevelopmentNote>> = {};

function _noteOrNull(note: InDevelopmentNote | undefined): InDevelopmentNote | null {
  return note !== undefined && note.pending.length > 0 ? note : null;
}

export function inDevelopmentOfRoute(pathname: string | null): InDevelopmentNote | null {
  if (pathname === null) return null;
  const match = Object.keys(BY_ROUTE)
    .filter((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match === undefined ? null : _noteOrNull(BY_ROUTE[match]);
}

export function inDevelopmentOfStage(stage: SecurityEventStage): InDevelopmentNote | null {
  return _noteOrNull(BY_STAGE[stage]);
}

export function inDevelopmentSummary(note: InDevelopmentNote): string {
  return `В разработке: ${note.pending.join("; ")}`;
}
