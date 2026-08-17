// База сводки ГВО, выведенная из бюллетеня ОМ, и слияние её с патчем правок.
// Ни одна функция здесь не ходит в сеть и не читает время — только чистое
// преобразование, поэтому одинаково работает и в моке, и на живых данных.
import type { SecurityEvent } from "@/entities/security-event";
import { ruDate, ruWeekdayName } from "@/lib/ru-date";
import { UNSPECIFIED } from "./types";
import type {
  GvoGroup,
  GvoSummary,
  GvoSummaryPatch,
} from "./types";

// Сам разбор дат живёт в lib/ru-date (его же читают «Сведения об ОМ» в
// бюллетене); здесь остаются только подписи-заглушки сводки.

/** «2026-06-18» → «18.06.2026»; не дата — «уточняется». */
export function formatRuDate(isoDate: string): string {
  return ruDate(isoDate) ?? UNSPECIFIED;
}

/** День недели по ISO-дате; не дата — пустая строка: в сводке эта подпись
 * стоит рядом с датой, и второе «уточняется» подряд только мешало бы. */
export function ruWeekday(isoDate: string): string {
  return ruWeekdayName(isoDate) ?? "";
}

/**
 * Сводка-черновик из бюллетеня. Переносится ровно то, что бюллетень хоста
 * действительно знает: дата ОМ → прибытие и убытие, объект → «Объекты
 * посещения» одним днём, ответственный ОМ → «Ответственный». Охраняемых лиц,
 * бортов, состава ГВО и транспорта в бюллетене нет — они остаются пустыми и
 * заполняются вручную по разделам.
 *
 * Расстановка (placementAssignments) СОЗНАТЕЛЬНО не подмешивается в состав
 * ГВО: это назначения на посты мероприятия, а не группа выездной охраны.
 */
export function deriveGvoSummary(event: SecurityEvent): GvoSummary {
  const day = formatRuDate(event.businessDate);
  const emptyGroup: GvoGroup = { name: "ГВО (состав уточняется)", members: [] };
  return {
    country: UNSPECIFIED,
    persons: [],
    arrival: {
      date: day,
      time: UNSPECIFIED,
      route: UNSPECIFIED,
      flight: UNSPECIFIED,
      dur: UNSPECIFIED,
    },
    departure: {
      date: day,
      time: UNSPECIFIED,
      route: UNSPECIFIED,
      flight: UNSPECIFIED,
      dur: UNSPECIFIED,
    },
    meet: [],
    farewell: [],
    stay: { place: UNSPECIFIED, room: UNSPECIFIED },
    delegation: [],
    sbChief: UNSPECIFIED,
    weapons: UNSPECIFIED,
    wishes: UNSPECIFIED,
    obVariant: UNSPECIFIED,
    radio: UNSPECIFIED,
    responsible:
      event.ownerName === ""
        ? null
        : { name: event.ownerName, callsign: UNSPECIFIED, role: "ответственный" },
    groups: [emptyGroup],
    transport: [],
    visits: [
      {
        day,
        weekday: ruWeekday(event.businessDate),
        items: [{ obj: event.objectName, note: UNSPECIFIED }],
      },
    ],
  };
}

/** База + патч. Вложенные объекты сливаются глубоко: патч раздела «Прибытие»
 * может нести только время, не затирая маршрут. */
export function mergeGvoSummary(
  base: GvoSummary,
  patch: GvoSummaryPatch | undefined
): GvoSummary {
  if (patch === undefined) return base;
  return {
    ...base,
    ...patch,
    arrival: { ...base.arrival, ...(patch.arrival ?? {}) },
    departure: { ...base.departure, ...(patch.departure ?? {}) },
    stay: { ...base.stay, ...(patch.stay ?? {}) },
  };
}

/**
 * «Заполнена» — если по мероприятию есть хоть одна ручная правка. Иначе
 * «Черновик»: всё, что показано, выведено из бюллетеня.
 */
export function isGvoSummaryFilled(patch: GvoSummaryPatch | undefined): boolean {
  return patch !== undefined && Object.keys(patch).length > 0;
}

/** Старший ГВО — первый участник, чья роль названа «старший». */
export function gvoSenior(summary: GvoSummary): string {
  for (const group of summary.groups) {
    const senior = group.members.find((member) => /старший/i.test(member.role));
    if (senior !== undefined) return `${senior.name} · ${senior.callsign}`;
  }
  return UNSPECIFIED;
}

export function gvoStaffCount(summary: GvoSummary): number {
  return summary.groups.reduce((total, group) => total + group.members.length, 0);
}

/** Двухбуквенный код страны для плашки в шапке; «—», пока страна не задана. */
export function gvoCountryAbbr(country: string): string {
  if (country === UNSPECIFIED) return "—";
  const letters = country.replace(/[^А-Яа-яЁёA-Za-z]/g, "").slice(0, 2);
  return letters === "" ? "—" : letters.toUpperCase();
}
