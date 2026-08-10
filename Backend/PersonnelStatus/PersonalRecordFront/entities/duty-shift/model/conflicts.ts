// Обнаружение конфликтов плана — чистая модель, считается «сервером»
// (мок-слоем), страница получает готовое. Правила:
//   • пересечение смен одного сотрудника в один день — HARD, без обхода;
//   • нарушение отдыха после дежурства — severity из политики
//     (HARD_BLOCK → HARD, SOFT_OVERRIDE → SOFT, обходится обоснованием).
// Отменённая смена сотрудника не занимает: не пересекается и не требует
// отдыха после себя.
// Арифметика дат — Date.UTC, без локального new Date(строка).
import type {
  ConflictPolicy,
  DutyPlanConflict,
  DutyShift,
  DutyTypeDefinition,
} from "./types";

export function dutyAddDays(date: string, amount: number): string {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  return new Date(Date.UTC(year, monthIndex, day + amount))
    .toISOString()
    .slice(0, 10);
}

export function dutyDaysBetween(a: string, b: string): number {
  const toUtc = (date: string) =>
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10))
    );
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function overlapMessage(
  employeeName: string,
  date: string,
  shiftCount: number
): string {
  return `${employeeName}: ${shiftCount} дежурства на ${date} — пересечение недопустимо.`;
}

export function restMessage(
  employeeName: string,
  previousDate: string,
  nextDate: string,
  restMinutes: number
): string {
  const hours = Math.round(restMinutes / 60);
  return `${employeeName}: дежурство ${nextDate} нарушает отдых ${hours} ч после дежурства ${previousDate}.`;
}

export function detectDutyConflicts(
  shifts: readonly DutyShift[],
  dutyTypes: readonly DutyTypeDefinition[],
  policy: ConflictPolicy
): DutyPlanConflict[] {
  const typeByCode = new Map(dutyTypes.map((type) => [type.dutyTypeCode, type]));
  const byEmployee = new Map<string, DutyShift[]>();
  for (const shift of shifts.filter((s) => s.stateCode !== "CANCELLED")) {
    const bucket = byEmployee.get(shift.employeeName) ?? [];
    bucket.push(shift);
    byEmployee.set(shift.employeeName, bucket);
  }

  const conflicts: DutyPlanConflict[] = [];
  for (const [employeeName, employeeShifts] of [...byEmployee.entries()].sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    const byDate = new Map<string, DutyShift[]>();
    for (const shift of employeeShifts) {
      const bucket = byDate.get(shift.businessDate) ?? [];
      bucket.push(shift);
      byDate.set(shift.businessDate, bucket);
    }
    const dates = [...byDate.keys()].sort();

    for (const date of dates) {
      const sameDay = byDate.get(date) ?? [];
      if (sameDay.length > 1) {
        conflicts.push({
          conflictId: `overlap:${employeeName}:${date}`,
          code: "DUTY_OVERLAP",
          severity: "HARD",
          employeeName,
          businessDate: date,
          message: overlapMessage(employeeName, date, sameDay.length),
          policyVersion: policy.conflictPolicyVersion,
        });
      }
    }

    for (let index = 1; index < dates.length; index += 1) {
      const previousDate = dates[index - 1];
      const nextDate = dates[index];
      // отдых — от конца предыдущего дня; между днями ровно (Δсуток − 1)
      // полных суток
      const freeMinutes = (dutyDaysBetween(previousDate, nextDate) - 1) * 24 * 60;
      for (const previous of byDate.get(previousDate) ?? []) {
        const type = typeByCode.get(previous.dutyTypeCode);
        if (type === undefined || type.restAfterMinutes <= 0) continue;
        if (freeMinutes >= type.restAfterMinutes) continue;
        conflicts.push({
          conflictId: `rest:${employeeName}:${previousDate}:${nextDate}`,
          code: "REST_AFTER_DUTY",
          severity: policy.restAfterDutyMode === "HARD_BLOCK" ? "HARD" : "SOFT",
          employeeName,
          businessDate: nextDate,
          message: restMessage(
            employeeName,
            previousDate,
            nextDate,
            type.restAfterMinutes
          ),
          policyVersion: policy.conflictPolicyVersion,
        });
        break;
      }
    }
  }

  return conflicts.sort(
    (a, b) =>
      a.businessDate.localeCompare(b.businessDate) ||
      a.conflictId.localeCompare(b.conflictId)
  );
}
