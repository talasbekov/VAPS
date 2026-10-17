export type StatusActionMode = "change" | "schedule";

/** The form chooses the last included day; operations stores [start, end). */
export function opsExclusiveEndDate(lastDay: Date | undefined): string {
  if (!lastDay || Number.isNaN(lastDay.getTime())) throw new Error("Укажите дату окончания.");
  const year = lastDay.getFullYear();
  if (year < 1 || year > 9999) throw new Error("Выберите допустимую дату окончания.");
  const civil = `${String(year).padStart(4, "0")}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;
  const exclusive = new Date(`${civil}T00:00:00Z`);
  exclusive.setUTCDate(exclusive.getUTCDate() + 1);
  if (exclusive.getUTCFullYear() > 9999) throw new Error("Выберите более раннюю дату окончания.");
  return exclusive.toISOString().slice(0, 10);
}

export function statusServerDates(tomorrow: string): { today: string; tomorrow: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tomorrow)) throw new Error("Не удалось определить дату сервера.");
  const date = new Date(`${tomorrow}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== tomorrow) {
    throw new Error("Не удалось определить дату сервера.");
  }
  date.setUTCDate(date.getUTCDate() - 1);
  return { today: date.toISOString().slice(0, 10), tomorrow };
}

/** Civil dates are serialized from local calendar parts, without a UTC shift. */
export function statusStartForSave({ mode, today, initialStartDate, chosenStartDate, inService }: {
  mode: StatusActionMode;
  today: string;
  initialStartDate?: Date;
  chosenStartDate?: Date;
  inService: boolean;
}): string {
  const start = inService && mode === "change"
    ? initialStartDate ?? new Date(`${today}T00:00:00`)
    : chosenStartDate;
  if (!start || Number.isNaN(start.getTime())) throw new Error("Укажите дату начала.");
  const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  if (mode === "schedule" && iso <= today) throw new Error("Для планирования выберите дату позже сегодняшней даты сервера.");
  if (mode === "change" && !initialStartDate && iso > today) throw new Error("Будущий статус создаётся в разделе «Запланированные статусы».");
  return iso;
}
