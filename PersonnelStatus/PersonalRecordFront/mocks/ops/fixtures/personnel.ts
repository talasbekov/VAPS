// Read-only кадровый снимок для подбора кандидатов на расстановку —
// те же демо-сотрудники, что засеяны в локальный Django-стенд.
import type { PersonnelSummarySnapshot } from "@/entities/security-event";

interface PersonnelSeed {
  id: string;
  name: string;
  rankLabel: string;
  /** Позывной (`[МД-10]`, Plane №456). У большинства пуст — так же, как в
   *  живой базе: поле новое, и заполняют его по мере надобности. */
  callsign?: string;
  unit: string;
}

const SEED: PersonnelSeed[] = [
  { id: "emp-1", name: "Абенов С.", rankLabel: "Майор", unit: "Отдел охраны объектов" },
  { id: "emp-2", name: "Жаксылыков Д.", rankLabel: "Капитан", unit: "Отдел охраны объектов" },
  { id: "emp-3", name: "Оспанова А.", rankLabel: "Ст. лейтенант", unit: "Отдел охраны объектов" },
  { id: "emp-4", name: "Токтаров Н.", rankLabel: "Лейтенант", unit: "Отдел охраны объектов" },
  { id: "emp-5", name: "Сериков А.", rankLabel: "Прапорщик", unit: "Отдел охраны объектов" },
  { id: "emp-6", name: "Байжанов Е.", rankLabel: "Майор", unit: "Отдел пропускного режима" },
  { id: "emp-7", name: "Кусаинова Д.", rankLabel: "Капитан", unit: "Отдел пропускного режима" },
  { id: "emp-8", name: "Мукашев А.", rankLabel: "Лейтенант", unit: "Отдел пропускного режима" },
  { id: "emp-9", name: "Ахметова С.", rankLabel: "Ст. лейтенант", callsign: "Беркут", unit: "Отдел пропускного режима" },
  { id: "emp-10", name: "Есимов Б.", rankLabel: "Прапорщик", unit: "Отдел пропускного режима" },
];

/** Статус дня у демо-сотрудников (Plane №65, шаги «Р-1»/«Р-2»).
 *
 * На сервере статус СЧИТАЕТСЯ по строкам расхода на спрошенную дату; у мока
 * расхода нет, поэтому он задан таблицей — ровно чтобы бейдж статуса на
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

/** Агрегат рейтинга у демо-сотрудников (Plane №67, шаги РЙ-4/РЙ-5).
 *
 * На сервере агрегат СЧИТАЕТСЯ по оценкам и методике; у мока оценок в кадровой
 * ручке нет, поэтому он задан таблицей — тем же приёмом, что и статус дня
 * выше. Значения совпадают с участниками рейтинга мок-слоя (`emp-1`…`emp-6`
 * связаны, `emp-7`…`emp-10` нет), иначе мок противоречил бы сам себе: бейдж на
 * доске показывал бы одно, карточка рейтинга — другое.
 *
 * Отсутствие строки = `null` = «судить не по чему». Это НЕ ноль: ноль означал
 * бы плохую оценку.
 */
export const PERSONNEL_RATING: Record<string, number> = {
  "emp-1": 8.2,
  "emp-2": 7.5,
  "emp-3": 9.1,
  "emp-4": 6.8,
  "emp-5": 8.7,
  "emp-6": 9.4,
};

/** Полосы рейтинга — те же границы и коды, что у сервера
 * (`ratings.RATING_BANDS`). Разойтись они не имеют права: мок с другими
 * границами отбирал бы не тех, кого отберёт живой стек, и проба мока зеленела
 * бы на контракте, которого нет. */
export const RATING_BAND_MATCHES: Record<
  string,
  (value: number | null) => boolean
> = {
  "9_10": (value) => value !== null && value >= 9,
  "8_9": (value) => value !== null && value >= 8 && value < 9,
  "7_8": (value) => value !== null && value >= 7 && value < 8,
  below_7: (value) => value !== null && value < 7,
  no_data: (value) => value === null,
};

export function personnelRating(id: string): number | null {
  return PERSONNEL_RATING[id] ?? null;
}

/** Снимок БЕЗ статусов: как и сервер, мок отдаёт их только на спрошенную дату
 * (`business_date`), а без неё честно молчит. */
export const PERSONNEL_ROSTER: PersonnelSummarySnapshot[] = SEED.map((row) => ({
  ...row,
  statusCode: null,
  statusLabel: null,
}));

/** Строка снимка со статусом на дату — тем же правилом, что у сервера. */
export function personnelRowOn(
  row: PersonnelSummarySnapshot,
  businessDate: string
): PersonnelSummarySnapshot {
  if (businessDate === "") return row;
  return { ...row, ...personnelDayStatus(row.id) };
}

export function findPersonnel(id: string): PersonnelSummarySnapshot | undefined {
  return PERSONNEL_ROSTER.find((p) => p.id === id);
}
