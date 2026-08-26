// Вывод базы сводки ГВО из бюллетеня — ТОЛЬКО ДЛЯ МОКА (Plane №166).
//
// Раньше это правило жило в `entities/gvo-summary` и его звали экраны: сводка
// собиралась в браузере, а сервер хранил лишь ручные правки. С №166 сборку
// делает сервер и экраны читают её у него — а мок обязан отвечать тем же, и
// значит вывод ему всё ещё нужен.
//
// Правило переехало СЮДА, а не осталось общим, ровно поэтому: пока оно лежало
// в entities, любой экран мог собрать сводку сам, и никто бы не заметил. Две
// сборки уже разошлись однажды за один день (форма даты). Теперь у мока своя
// копия, как у всякого мока, и экрану она недоступна.
import type { SecurityEvent } from "@/entities/security-event";
import { ruDate, ruWeekdayName } from "@/lib/ru-date";
import { UNSPECIFIED } from "@/entities/gvo-summary";
import type {
  GvoGroup,
  GvoSummary,
  GvoSummaryPatch,
  GvoVisitDay,
} from "@/entities/gvo-summary";

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
 * действительно знает: дата ОМ → прибытие и убытие, ответственный ОМ →
 * «Ответственный», охраняемое лицо бюллетеня → «Охраняемые лица». «Объекты
 * посещения» приходят из таблицы объектов мероприятия (см. gvoVisitDays). Бортов, состава ГВО и транспорта в бюллетене
 * нет — они остаются пустыми и заполняются вручную по разделам.
 *
 * Расстановка (placementAssignments) СОЗНАТЕЛЬНО не подмешивается в состав
 * ГВО: это назначения на посты мероприятия, а не группа выездной охраны.
 */
export function deriveGvoSummary(event: SecurityEvent): GvoSummary {
  const day = formatRuDate(event.businessDate);
  const emptyGroup: GvoGroup = { name: "ГВО (состав уточняется)", members: [] };
  return {
    country: UNSPECIFIED,
    // Лицо, выбранное в окне создания ОМ. Пусто — в бюллетене его не назвали:
    // подставлять сюда «уточняется» вместо человека нечем.
    persons:
      event.protectedPersonName.trim() === ""
        ? []
        : [
            {
              name: event.protectedPersonName,
              role: "охраняемое лицо",
              facts: [],
            },
          ],
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
    visits: gvoVisitDays(event),
  };
}

/**
 * «Объекты посещения» — из ТАБЛИЦЫ объектов мероприятия, а не из патча сводки
 * («Реестр ОМ-35.1»). До этого список жил в двух местах: объекты мероприятия
 * (по ним идёт расстановка) и свободный текст патча, — и они расходились
 * молча: объект, дописанный в сводке, не получал ни постов, ни готовности.
 *
 * День берётся у строки; пустой — объект показывается в дате мероприятия.
 * Дни идут по возрастанию даты, а внутри дня объекты — в порядке, в котором
 * их завёл человек (`position`, он же порядок раскрытия строки реестра).
 */
export function gvoVisitDays(event: SecurityEvent): GvoVisitDay[] {
  const byDay = new Map<string, GvoVisitDay>();
  const ordered = [...event.visitObjects].sort((a, b) => a.position - b.position);
  for (const visit of ordered) {
    const iso = visit.visitDay ?? event.businessDate;
    const existing = byDay.get(iso);
    const item = {
      obj: visit.objectName,
      note: visit.note.trim() === "" ? UNSPECIFIED : visit.note,
    };
    if (existing === undefined) {
      byDay.set(iso, {
        day: formatRuDate(iso),
        weekday: ruWeekday(iso),
        items: [item],
      });
      continue;
    }
    existing.items.push(item);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, day]) => day);
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
