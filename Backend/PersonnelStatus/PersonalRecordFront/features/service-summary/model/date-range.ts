"use client";

// Диапазон дат «Свода по Службе» (Plane №992, §20.4 п.7): одна дата ИЛИ
// диапазон, умолчание — «завтра». Источник умолчания ТОТ ЖЕ, что у борда
// «Ежедневный расход» (`GET /tomorrow-block/`, Plane №988) — своё «завтра»
// здесь заводить нельзя, иначе экран дежурного и экран управления однажды
// разошлись бы в том, что считают «завтра».
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { localIsoDate, parseIsoDate } from "@/shared/lib/date";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIso(value: string | undefined): value is string {
  return value !== undefined && ISO_DATE.test(value);
}

export interface ServiceDateRange {
  /** Даты диапазона включительно, по возрастанию. Резолвится ПОСЛЕ загрузки
   * умолчания — до неё пуст (см. `isResolving`). */
  dates: string[];
  isResolving: boolean;
  /** «Завтра» сервера — умолчание `from`, когда оно не задано в адресе. */
  defaultDate: string | null;
}

/** Не более 31 дневного среза за раз: «набор дневных срезов» (§20.4 п.8) не
 * обещает произвольной глубины — читатель, попросивший год диапазоном,
 * получил бы страницу с сотнями карточек вместо ответа на вопрос «кто не
 * сдал». Совпадает по порядку величины с MAX_PERIOD_DAYS раздела (62), но не
 * равно ему намеренно: там страница СЧИТАЕТ расход за период, здесь —
 * ПОКАЗЫВАЕТ N независимых карточек, и цена карточки выше цены строки.
 */
const MAX_RANGE_DAYS = 31;

export function useServiceDateRange(
  fromParam: string | undefined,
  toParam: string | undefined
): ServiceDateRange {
  const tomorrowQuery = useQuery({
    queryKey: ["service-summary", "default-business-date"],
    queryFn: () => apiClient.getTomorrowBlockState({}),
    staleTime: 5 * 60_000,
  });
  const defaultDate = tomorrowQuery.data?.business_date ?? null;

  const from = isValidIso(fromParam) ? fromParam : defaultDate;
  if (from === null) {
    return { dates: [], isResolving: true, defaultDate };
  }
  const to = isValidIso(toParam) && toParam >= from ? toParam : from;

  const dates: string[] = [];
  let cursor = parseIsoDate(from);
  const end = parseIsoDate(to);
  while (cursor !== null && end !== null && cursor <= end && dates.length < MAX_RANGE_DAYS) {
    dates.push(localIsoDate(cursor));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return { dates, isResolving: false, defaultDate };
}
