import type { Employee } from "@/lib/api";

// Тип кодов статусов из API (совпадает с TextChoices на бэке).
//
// `NonNullable` намеренно: у сотрудника статуса может НЕ БЫТЬ, и поле в
// `Employee` необязательное — но «нет статуса» не код статуса, и в таблицах
// кодов ему места нет. Отсутствие обрабатывают хелперы ниже
// (`getEmployeeStatusLabel` и соседи принимают `null | undefined`).
export type EmployeeStatusType = NonNullable<Employee["status"]>;

// Человекочитаемые названия статусов (как в Django TextChoices)
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatusType, string> = {
  in_service: "В строю",
  vacation: "Отпуск",
  leave_by_report: "Отпуск по рапорту",
  sick_leave: "Больничный",
  business_trip: "Командировка",
  training: "Учёба",
  competition: "На соревнованиях",
  conference: "Конференция",
  other_absence: "Отсутствие по иным причинам",
  on_duty: "На дежурстве",
  after_duty: "После дежурства",
  // Без предлога: подпись обрывалась на «в»/«из» в расчёте на название
  // подразделения, которого сюда никто не подставляет — бейдж читался как
  // незаконченная фраза. Соседний справочник расхода уже пишет «Откомандирован».
  seconded_from: "Прикомандирован",
  seconded_to: "Откомандирован",
};

/**
 * Полная палитра статуса: один оттенок в трёх видах записи.
 *
 * Зачем. До этого «статус → цвет» жил в пяти местах и расходился: командировка
 * была фиолетовой в таблице и синей в оргструктуре, отпуск — жёлтым в бейдже и
 * синим в календаре, а две копии таблицы «класс → hex» по 28 литералов лежали в
 * двух диалогах. Один статус выглядел по-разному на трёх экранах.
 *
 * Три вида нужны потому, что три разных потребителя: Tailwind-классы для
 * бейджей, класс-точка для оргструктуры и hex для inline-стилей (там классы
 * Tailwind не применить) — сетка месяца, панель дня и два диалога статусов.
 * Оттенок при этом ОДИН.
 *
 * FullCalendar из перечня потребителей убран 29.08.2026 (Plane №318): его виды
 * сняты, пакеты из поставки удалены. Сам `hex` остаётся — inline-стили его
 * читают, и их четверо.
 */
export interface StatusPaint {
  /** Бейдж: заливка + текст (совпадает с EMPLOYEE_STATUS_COLORS). */
  badge: string;
  /** Точка-индикатор: сплошная заливка того же оттенка. */
  dot: string;
  /** Тот же оттенок в hex — для `style={{}}` там, где классы не применить. */
  hex: { bg: string; text: string; accent: string };
}

export const EMPLOYEE_STATUS_PAINT: Record<EmployeeStatusType, StatusPaint> = {
  in_service: {
    badge: "bg-green-100 text-green-800",
    dot: "bg-green-500",
    hex: { bg: "#dcfce7", text: "#166534", accent: "#22c55e" },
  },
  vacation: {
    badge: "bg-yellow-100 text-yellow-800",
    dot: "bg-yellow-500",
    hex: { bg: "#fef9c3", text: "#713f12", accent: "#eab308" },
  },
  leave_by_report: {
    badge: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
    hex: { bg: "#fef3c7", text: "#92400e", accent: "#f59e0b" },
  },
  sick_leave: {
    badge: "bg-red-100 text-red-800",
    dot: "bg-red-500",
    hex: { bg: "#fee2e2", text: "#991b1b", accent: "#ef4444" },
  },
  business_trip: {
    badge: "bg-purple-100 text-purple-800",
    dot: "bg-purple-500",
    hex: { bg: "#f3e8ff", text: "#6b21a8", accent: "#a855f7" },
  },
  training: {
    badge: "bg-indigo-100 text-indigo-800",
    dot: "bg-indigo-500",
    hex: { bg: "#e0e7ff", text: "#3730a3", accent: "#6366f1" },
  },
  competition: {
    badge: "bg-pink-100 text-pink-800",
    dot: "bg-pink-500",
    hex: { bg: "#fce7f3", text: "#9d174d", accent: "#ec4899" },
  },
  conference: {
    badge: "bg-violet-100 text-violet-800",
    dot: "bg-violet-500",
    hex: { bg: "#ede9fe", text: "#5b21b6", accent: "#8b5cf6" },
  },
  other_absence: {
    badge: "bg-orange-100 text-orange-800",
    dot: "bg-orange-500",
    hex: { bg: "#ffedd5", text: "#9a3412", accent: "#f97316" },
  },
  on_duty: {
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
    hex: { bg: "#dbeafe", text: "#1e40af", accent: "#3b82f6" },
  },
  after_duty: {
    badge: "bg-cyan-100 text-cyan-800",
    dot: "bg-cyan-500",
    hex: { bg: "#cffafe", text: "#164e63", accent: "#06b6d4" },
  },
  seconded_from: {
    badge: "bg-teal-100 text-teal-800",
    dot: "bg-teal-500",
    hex: { bg: "#ccfbf1", text: "#115e59", accent: "#14b8a6" },
  },
  seconded_to: {
    badge: "bg-gray-100 text-gray-800",
    dot: "bg-gray-500",
    hex: { bg: "#f3f4f6", text: "#1f2937", accent: "#6b7280" },
  },
};

/** Нейтральная краска для неизвестного кода — тоже одна на весь фронт. */
export const UNKNOWN_STATUS_PAINT: StatusPaint = {
  badge: "bg-gray-100 text-gray-800",
  dot: "bg-gray-400",
  hex: { bg: "#f3f4f6", text: "#1f2937", accent: "#9ca3af" },
};

export const getEmployeeStatusPaint = (
  statusType: EmployeeStatusType | string | null | undefined
): StatusPaint =>
  (statusType != null &&
    EMPLOYEE_STATUS_PAINT[statusType as EmployeeStatusType]) ||
  UNKNOWN_STATUS_PAINT;

// Цвета бейджей — ПРОИЗВОДНАЯ от палитры ниже, а не вторая её копия: иначе
// таблицы расходятся молча (так и вышло — пять источников на 13 статусов).
export const EMPLOYEE_STATUS_COLORS: Record<EmployeeStatusType, string> =
  Object.fromEntries(
    (Object.keys(EMPLOYEE_STATUS_PAINT) as EmployeeStatusType[]).map((code) => [
      code,
      EMPLOYEE_STATUS_PAINT[code].badge,
    ])
  ) as Record<EmployeeStatusType, string>;

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

/**
 * Цвет точки-индикатора по коду. Нет статуса — СЕРАЯ точка.
 *
 * Зачем хелпер, а не обращение к таблице напрямую: места, где рисуется точка,
 * подставляли зелёный «в строю» всякий раз, когда статуса не было
 * (`statusColors[status] || statusColors.in_service`). Вакантная должность в
 * оргструктуре из-за этого светилась зелёным, как человек в строю.
 */
export const getEmployeeStatusDot = (
  statusType: EmployeeStatusType | null | undefined,
  fallback = "bg-gray-300"
): string => {
  if (!statusType) return fallback;
  return EMPLOYEE_STATUS_PAINT[statusType]?.dot ?? fallback;
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
