// Read-only кадровый снимок для подбора кандидатов на расстановку —
// те же демо-сотрудники, что засеяны в локальный Django-стенд.
import type { PersonnelSummarySnapshot } from "@/entities/security-event";

export const PERSONNEL_ROSTER: PersonnelSummarySnapshot[] = [
  { id: "emp-1", name: "Абенов С.", rankLabel: "Майор", unit: "Отдел охраны объектов" },
  { id: "emp-2", name: "Жаксылыков Д.", rankLabel: "Капитан", unit: "Отдел охраны объектов" },
  { id: "emp-3", name: "Оспанова А.", rankLabel: "Ст. лейтенант", unit: "Отдел охраны объектов" },
  { id: "emp-4", name: "Токтаров Н.", rankLabel: "Лейтенант", unit: "Отдел охраны объектов" },
  { id: "emp-5", name: "Сериков А.", rankLabel: "Прапорщик", unit: "Отдел охраны объектов" },
  { id: "emp-6", name: "Байжанов Е.", rankLabel: "Майор", unit: "Отдел пропускного режима" },
  { id: "emp-7", name: "Кусаинова Д.", rankLabel: "Капитан", unit: "Отдел пропускного режима" },
  { id: "emp-8", name: "Мукашев А.", rankLabel: "Лейтенант", unit: "Отдел пропускного режима" },
  { id: "emp-9", name: "Ахметова С.", rankLabel: "Ст. лейтенант", unit: "Отдел пропускного режима" },
  { id: "emp-10", name: "Есимов Б.", rankLabel: "Прапорщик", unit: "Отдел пропускного режима" },
];

/** Статус дня у демо-сотрудников (Plane №65, шаг «Р-1»).
 *
 * На сервере статус СЧИТАЕТСЯ на деловую дату по строкам расхода; у мока
 * расхода нет, поэтому здесь он задан таблицей — ровно чтобы бейдж статуса на
 * расстановке было чем проверить. Отсутствие строки = статуса нет, что и есть
 * «в строю»: строки «в строю» в справочнике не существует.
 */
export const PERSONNEL_DAY_STATUS: Record<string, { code: string; label: string }> = {
  "emp-3": { code: "VACATION", label: "Отпуск" },
  "emp-7": { code: "ON_DUTY", label: "На дежурстве" },
};

export function personnelDayStatus(id: string): {
  statusCode: string | null;
  statusLabel: string | null;
} {
  const row = PERSONNEL_DAY_STATUS[id];
  return {
    statusCode: row?.code ?? null,
    statusLabel: row?.label ?? null,
  };
}

export function findPersonnel(id: string): PersonnelSummarySnapshot | undefined {
  return PERSONNEL_ROSTER.find((p) => p.id === id);
}
