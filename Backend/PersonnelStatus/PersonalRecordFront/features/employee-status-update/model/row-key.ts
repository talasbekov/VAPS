/**
 * Идентификатор сотрудника из составного ключа строки (`unitId-employeeId`).
 *
 * 🔴 Диалоги получают ИМЕННО составной ключ (у вакансии он `unitId-vacant-N`),
 * и слать его в отбор нельзя: сервер ждёт числа (Plane №234). Вакансия
 * возвращает `null` — у неё нет сотрудника, и запрашивать нечего.
 */
export function employeeIdOfKey(key: string | null): number | null {
  if (!key) return null;
  // Голый id (без дефиса) — тоже ключ: экраны свода (Plane №1233) знают
  // сотрудника только по id расхода, у них нет штатной единицы в ключе.
  // Тот же разбор, что у `employeeIdOf` таблицы статусов.
  const parts = key.split("-");
  const employeePart = parts.length > 1 ? parts[1] : parts[0];
  if (!employeePart || employeePart.startsWith("vacant")) return null;
  const parsed = Number.parseInt(employeePart, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
