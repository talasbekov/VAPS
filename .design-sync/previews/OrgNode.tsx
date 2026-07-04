import { OrgNode } from "my-v0-project";

// Аватар-заглушка (data-URI, силуэт) — чтобы не было битых <img> в превью.
const AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23e2e8f0'/%3E%3Ccircle cx='16' cy='12' r='6' fill='%2394a3b8'/%3E%3Cpath d='M4 32c0-6.6 5.4-10 12-10s12 3.4 12 10' fill='%2394a3b8'/%3E%3C/svg%3E";

// Точки статуса — как в доноре (OrgChart.tsx statusColors).
const statusColors: Record<string, string> = {
  in_service: "bg-green-500",
  vacation: "bg-yellow-500",
  leave_by_report: "bg-yellow-400",
  sick_leave: "bg-red-500",
  business_trip: "bg-blue-500",
  training: "bg-purple-500",
  competition: "bg-pink-500",
  other_absence: "bg-gray-500",
  on_duty: "bg-indigo-500",
  after_duty: "bg-cyan-500",
  seconded_from: "bg-orange-500",
  seconded_to: "bg-teal-500",
};

const sizeClasses = { small: "w-8 h-8", medium: "w-12 h-12", large: "w-16 h-16" };

// Реплика renderEmployee из донора (OrgChart.tsx).
const renderEmployee = (
  employee: any,
  size: "small" | "medium" | "large" = "small"
) => (
  <div
    key={employee.id}
    className="flex items-center gap-2 p-2 bg-white/80 backdrop-blur-sm rounded-lg border border-gray-200 shadow-sm group"
  >
    <div className="relative">
      <img
        src={employee.avatar || AVATAR}
        alt={employee.name}
        className={`${sizeClasses[size]} rounded-full object-cover ring-2 ring-white shadow-sm`}
      />
      <div
        className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${
          statusColors[employee.status] || statusColors.in_service
        } shadow-sm`}
      />
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-gray-900 truncate">
        {employee.name}
      </div>
      <div className="text-xs text-gray-500 truncate">{employee.position}</div>
    </div>
  </div>
);

const noop = () => {};

// Управление кадров: начальник + 3 сотрудника, есть дочерние отделы (закрыто).
const departmentUnit = {
  id: "u-20",
  name: "Управление кадров",
  head: {
    id: "h-1",
    name: "Бекетов Марат Оралович",
    position: "Начальник управления",
    status: "in_service" as const,
    avatar: AVATAR,
  },
  employees: [
    {
      id: "e-1",
      name: "Ахметов Данияр",
      position: "Главный специалист",
      status: "in_service" as const,
      avatar: AVATAR,
    },
    {
      id: "e-2",
      name: "Смагулова Айгерим",
      position: "Старший инспектор",
      status: "vacation" as const,
      avatar: AVATAR,
    },
    {
      id: "e-3",
      name: "Оспанов Ерлан",
      position: "Инспектор",
      status: "sick_leave" as const,
      avatar: AVATAR,
    },
  ],
  color:
    "bg-gradient-to-br from-green-100 via-green-150 to-green-200 border-green-300",
  type: "department" as const,
  children: [
    {
      id: "u-21",
      name: "Отдел комплектования",
      head: {
        id: "h-2",
        name: "Нурланов Аскар",
        position: "Начальник отдела",
        status: "in_service" as const,
        avatar: AVATAR,
      },
      employees: [],
      color:
        "bg-gradient-to-br from-green-50 via-green-100 to-green-150 border-green-200",
      type: "directorate" as const,
    },
  ],
};

// Руководство: карточка с короной, без дочерних узлов.
const leadershipUnit = {
  id: "u-1",
  name: "Руководство департамента",
  head: {
    id: "h-0",
    name: "Тулегенов Серик Кайратович",
    position: "Директор департамента",
    status: "business_trip" as const,
    avatar: AVATAR,
  },
  employees: [
    {
      id: "e-10",
      name: "Жанибеков Тимур",
      position: "Заместитель директора",
      status: "in_service" as const,
      avatar: AVATAR,
    },
    {
      id: "e-11",
      name: "Касымова Дана",
      position: "Помощник директора",
      status: "training" as const,
      avatar: AVATAR,
    },
  ],
  color:
    "bg-gradient-to-br from-blue-100 via-blue-150 to-blue-200 border-blue-300",
  type: "leadership" as const,
};

export const DepartmentCollapsed = () => (
  <OrgNode
    unit={departmentUnit}
    level={1}
    isExpanded={false}
    focusedUnitId="root"
    expandedUnits={new Set<string>()}
    onToggleExpand={noop}
    onSelectUnit={noop}
    renderEmployee={renderEmployee}
    rootId="root"
  />
);

export const LeadershipUnit = () => (
  <OrgNode
    unit={leadershipUnit}
    level={0}
    isExpanded={false}
    focusedUnitId="root"
    expandedUnits={new Set<string>()}
    onToggleExpand={noop}
    onSelectUnit={noop}
    renderEmployee={renderEmployee}
    rootId="root"
  />
);
