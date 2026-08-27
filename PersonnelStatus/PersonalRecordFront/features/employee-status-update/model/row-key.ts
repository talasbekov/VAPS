/**
 * Идентификатор сотрудника из составного ключа строки (`unitId-employeeId`).
 *
 * 🔴 Диалоги получают ИМЕННО составной ключ (у вакансии он `unitId-vacant-N`),
 * и слать его в отбор нельзя: сервер ждёт числа (Plane №234). Вакансия
 * возвращает `null` — у неё нет сотрудника, и запрашивать нечего.
 */
export function employeeIdOfKey(key: string | null): number | null {
  if (!key) return null;
  const [, employeePart] = key.split("-");
  if (!employeePart || employeePart.startsWith("vacant")) return null;
  const parsed = Number.parseInt(employeePart, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
