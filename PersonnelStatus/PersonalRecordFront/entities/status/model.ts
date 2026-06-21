import type { Employee } from "@/lib/api";

// Тип кодов статусов из API (совпадает с TextChoices на бэке)
export type EmployeeStatusType = Employee["status"];

// Человекочитаемые названия статусов (как в Django TextChoices)
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatusType, string> = {
  in_service: "В строю",
  vacation: "Отпуск",
  leave_by_report: "Отпуск по рапорту",
  sick_leave: "Больничный",
  business_trip: "Командировка",
  training: "Учёба",
  competition: "На соревнованиях",
  other_absence: "Отсутствие по иным причинам",
  on_duty: "На дежурстве",
  after_duty: "После дежурства",
  seconded_from: "Прикомандирован из",
  seconded_to: "Откомандирован в",
};

// Цвета бейджей для каждого статуса (единый набор для всего фронта)
export const EMPLOYEE_STATUS_COLORS: Record<EmployeeStatusType, string> = {
  in_service: "bg-green-100 text-green-800",
  vacation: "bg-yellow-100 text-yellow-800",
  leave_by_report: "bg-amber-100 text-amber-800",
  sick_leave: "bg-red-100 text-red-800",
  business_trip: "bg-purple-100 text-purple-800",
  training: "bg-indigo-100 text-indigo-800",
  competition: "bg-pink-100 text-pink-800",
  other_absence: "bg-orange-100 text-orange-800",
  on_duty: "bg-blue-100 text-blue-800",
  after_duty: "bg-cyan-100 text-cyan-800",
  seconded_from: "bg-teal-100 text-teal-800",
  seconded_to: "bg-gray-100 text-gray-800",
};

// Хелпер: получить название статуса по коду
export const getEmployeeStatusLabel = (
  statusType: EmployeeStatusType | null | undefined,
  fallback = "Не обновлено"
): string => {
  if (!statusType) return fallback;
  return EMPLOYEE_STATUS_LABELS[statusType] ?? fallback;
};

// Хелпер: получить цвет бейджа по коду
export const getEmployeeStatusColor = (
  statusType: EmployeeStatusType | null | undefined,
  fallback = "bg-gray-100 text-gray-800"
): string => {
  if (!statusType) return fallback;
  return EMPLOYEE_STATUS_COLORS[statusType] ?? fallback;
};

// Маппинг "русское название -> код статуса" (удобно для Select'ов)
export const EMPLOYEE_STATUS_CODE_BY_LABEL: Record<string, EmployeeStatusType> =
  Object.fromEntries(
    Object.entries(EMPLOYEE_STATUS_LABELS).map(([code, label]) => [
      label,
      code as EmployeeStatusType,
    ])
  );

// Статусы в виде, удобном для UI-компонентов (Select, фильтры, легенды и т.п.)
export const EMPLOYEE_STATUS_ITEMS = (
  Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatusType[]
).map((code) => ({
  code,
  label: EMPLOYEE_STATUS_LABELS[code],
  color: EMPLOYEE_STATUS_COLORS[code],
}));

// Статусы, которые можно выбирать вручную (без откомандирования — для этого есть отдельный функционал)
const EXCLUDED_FROM_SELECTION: EmployeeStatusType[] = [
  "seconded_from",
  "seconded_to",
];

export const SELECTABLE_STATUS_ITEMS = EMPLOYEE_STATUS_ITEMS.filter(
  (item) => !EXCLUDED_FROM_SELECTION.includes(item.code)
);

// Хелпер: получить отформатированный статус с учетом local_status для прикомандированных
export const getFormattedEmployeeStatus = (
  employee:
    | {
        current_status?: { status_type: EmployeeStatusType } | null;
        local_status?: { status_type: EmployeeStatusType } | null;
        is_seconded?: boolean;
      }
    | null
    | undefined
): string => {
  if (!employee) return "Не обновлено";

  const currentStatus = employee.current_status?.status_type;
  const localStatus = employee.local_status?.status_type;
  const isSeconded = employee.is_seconded;

  // Если сотрудник прикомандирован и есть local_status, показываем оба статуса
  // Проверяем is_seconded или наличие local_status (на случай, если is_seconded не установлен)
  if ((isSeconded || localStatus) && localStatus && currentStatus) {
    const currentLabel = getEmployeeStatusLabel(currentStatus);
    const localLabel = getEmployeeStatusLabel(localStatus);
    return `${currentLabel} / ${localLabel}`;
  }

  // Если есть только local_status (без current_status), показываем его
  if (localStatus && !currentStatus) {
    return getEmployeeStatusLabel(localStatus);
  }

  // Иначе показываем только current_status
  return getEmployeeStatusLabel(currentStatus);
};
