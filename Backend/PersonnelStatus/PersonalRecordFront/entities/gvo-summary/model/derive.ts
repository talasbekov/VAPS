// Показ сводки ГВО: подписи шапки, счёт состава, право на правку.
//
// ВЫВОДА БАЗЫ ЗДЕСЬ БОЛЬШЕ НЕТ (Plane №166). Сводку собирает сервер и отдаёт
// ручкой; экран её показывает, а не считает. Правило вывода осталось только у
// мока (`mocks/ops/gvo-derive.ts`) — как у всякого мока, и экрану оно
// недоступно: пока оно лежало здесь, любой экран мог собрать сводку сам, и
// две сборки успели разойтись за один день на форме даты.
import type { SecurityEvent } from "@/entities/security-event";
import { UNSPECIFIED } from "./types";
import type { GvoSummary } from "./types";

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

/**
 * Может ли этот человек ПРАВИТЬ сводку ГВО этого мероприятия (Plane «Реестр
 * ОМ-35.6»). Требование заказчика: «внутри старший ГВО или админ могут
 * добавлять, редактировать, удалять всё».
 *
 * Две половины, как на сервере: код права `gvo.manage` (у админа проходит по
 * «*») ИЛИ старший ЭТОГО мероприятия — старший мероприятия из бюллетеня, он же
 * старший ГВО у визита иностранного ОЛ. `event.manage` сюда НЕ входит: сводку
 * заполняет старший ГВО, а не всякий, кто ведёт мероприятие.
 *
 * Правило живёт ОДНОЙ функцией: скопированное по экранам, оно расходится с
 * сервером на первой же правке, и человек видит кнопку, которая отвечает 403.
 * Сервер при этом остаётся хозяином решения — здесь только показ кнопок.
 */
export function canManageGvoSummary(params: {
  hasPermission: (code: string) => boolean;
  /** Кадровая запись текущей учётки; null — привязки нет (сид её не делает). */
  myEmployeeId: string | null;
  event: SecurityEvent;
}): boolean {
  if (params.hasPermission("gvo.manage")) return true;
  return (
    params.myEmployeeId !== null &&
    params.event.chiefEmployeeId === params.myEmployeeId
  );
}

