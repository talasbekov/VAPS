"use client";
import { CombatAssignmentDetails } from '@/features/combat-duty/ui/CombatAssignmentDetails';

import { Fragment, useState, useMemo, useEffect, useRef} from "react";
import Link from "next/link";
import { useStaffUnitsPage } from "@/hooks/use-staff-units-page";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { moduleOpenFor } from "@/entities/portal-access";
import { useStaffUnitStatistics } from "@/hooks/use-staff-unit-statistics";
import { Pager } from "@/components/pager";
import { DivisionPicker } from "@/components/division-picker";
import { EVENT_PARTICIPATION_STATUS_CODES } from "@/entities/daily-grid";
import {
  EMPLOYEE_STATUS_ITEMS,
  UNKNOWN_STATUS_PAINT,
  getEmployeeStatusColor,
} from "@/lib/status";
import { useEmployeeStatusTypes } from "@/hooks/use-employee-status-types";
import { useStatusNaming, type StatusNaming } from "@/entities/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Search,
  MoreHorizontal,
  Edit,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  Eye,
  UserX,
} from "lucide-react";
import { formatIsoDate, parseIsoDate } from "@/shared/lib/date";
import { EditStatusDialog } from "@/features/employee-status-update/ui/EditStatusDialog";
import { canManageStatusInDivision } from "@/entities/status/access";
import { PlannedStatusesDialog } from "@/features/employee-status-update/ui/PlannedStatusesDialog";
import { EmployeeProfile } from "@/entities/employee/ui/EmployeeProfile";
import {
  participationLabelKey,
  useOpsSectionStatuses,
} from "@/hooks/use-ops-section-statuses";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { personnelFields } from "@/entities/employee/model/from-api";
import type { Employee as EmployeeType } from "@/entities/employee/model/types";
import { LoadFailure } from "@/components/load-failure";
import { EmployeeDutyPlacementDialog } from "@/components/employee-duty-placement-dialog";
import styles from "./status-table.module.css";

interface Employee {
  divisionId: number | null;
  id: string;
  number: number;
  name: string;
  department: string;
  directorateId: number | null;
  directorateName: string;
  departmentName: string;
  position: string;
  status: string;
  /** Сырой код ТЕКУЩЕГО статуса — РОВНО `current_status.status_type`, а не
   *  подпись. `local_status` прикомандированных сюда НЕ попадает: его
   *  учитывает только ТЕКСТ (`getFormattedEmployeeStatus` печатает оба
   *  статуса строкой), а код остаётся кодом текущего — см. `describeStatus`
   *  ниже. Прежняя редакция комментария называла оба источника и обещала
   *  того, чего код не делает (находка ревью ветки 22.08). Нужен, чтобы
   *  отличить «Участие в ОМ» (код `EVENT_ASSIGNMENT` из справочника
   *  operations, этой ручке в принципе не родной) от обычных статусов, не
   *  гадая по тексту подписи. */
  statusCode: string | null;
  /** ISO «ГГГГ-ММ-ДД» или пустая строка. Форматируется ТОЛЬКО на выводе:
   *  раньше в поле лежал уже готовый текст, и `isOverdue` пытался разобрать
   *  его обратно через `new Date("14.08.2026, 00:00:00")` — это NaN, поэтому
   *  подсветка просрочки не срабатывала ни разу. */
  startDate: string;
  endDate: string;
  phone: string;
  email: string;
  priority: "normal" | "high" | "critical";
}

/**
 * Текст статуса + его сырой код.
 *
 * Подпись спрашивается у СПРАВОЧНИКА (`useStatusNaming`, Plane №366): каталог
 * типов правится в админке, и код, заведённый заказчиком, обязан подписываться
 * сам, без правки клиента.
 *
 * 🔴 ЗДЕСЬ СТОЯЛА ВЕТОЧКА НА ДВА КОДА ОМ, и её снятие — половина смысла правки.
 * Она подписывала `EVENT_ASSIGNMENT` и `EVENT_ASSIGNMENT_GROUP` строкой
 * «Участие в ОМ» руками — то есть закрывала два кода из пяти новых и только на
 * этом экране. Три остальных (`IN_EVENT`, `GEV`, `BEFORE_DUTY`) читались как
 * «Не обновлено» здесь и всюду; жалоба заказчика по №365 пришла ровно про
 * `IN_EVENT`. Дописывать коды в веточку значило бы держать четвёртую копию
 * каталога — теперь подпись у всех пяти приходит оттуда же, откуда список в
 * окне простановки.
 */
function describeStatus(
  // `any`: вызывающие берут `emp`/`employee` из ответа API тем же способом
  // (`(unit as any).employee`), и своя строгая форма здесь разошлась бы с
  // `EmployeeStatusType` — тот кодов справочника не содержит.
  emp: any,
  naming: StatusNaming
): { text: string; code: string | null } {
  const code = emp?.current_status?.status_type ?? null;
  return { text: naming.formatEmployee(emp), code };
}

interface StatusTableProps {
  selectedEmployees: string[];
  onSelectionChange: (selected: string[]) => void;
  loading?: boolean;
  onRefresh?: () => void;
}

/** Размер страницы таблицы статусов — как у реестра (Plane №231). */
const STATUS_PAGE_SIZE = 50;

/** Подпись незанятой штатной единицы. Одно место на весь файл: строка
 *  сравнивалась с литералом в пяти местах, и одно из них (пункт меню
 *  «Запланировать статус») сравнение просто потеряло — окно открывалось у
 *  вакансии и упиралось в «Сотрудник не найден» (Plane №257). */
const VACANCY_NAME = "ВАКАНТ";

/** Строка без сотрудника: должность в штате есть, занять её некому. */
function isVacancyRow(employee: Employee): boolean {
  return employee.name === VACANCY_NAME;
}

/**
 * Ячейка «По разделу ОМ» — весь учёт раздела в одном месте (Plane №314).
 *
 * Что здесь показывается и почему именно так:
 *   • действующий статус по справочнику РАЗДЕЛА (имя, а не код: код читает
 *     машина, человек читает имя);
 *   • мероприятия, на которые человек привлечён, ссылками на их карточки;
 *   • «—», когда в разделе строки нет, и «…», пока данные едут: пустая
 *     ячейка одинаково описывала бы «не привлечён» и «ещё не знаем».
 *
 * Ссылка ведёт ТОЛЬКО на существующее ОМ. Пустой `event_code` означает, что
 * мероприятия в базе больше нет (участие переживает его удаление), и ссылка
 * на карточку вела бы в 404 — тот же класс, что №255/№257. Найдено снимком
 * экрана: в таблице стояло «→ ОМ #2701» ссылкой на снесённое уборкой ОМ.
 *
 * `legacyHint` — запасной путь для строк, у которых КАДРОВЫЙ код говорит об
 * участии, а мероприятий не нашлось: статус проставлен без привязки (так
 * заводили до Ш-3) либо данные ещё едут.
 */
function SectionAccountCell({
  status,
  participations,
  loading,
  legacyHint,
  forcesOpen,
  reserve,
}: {
  /** Открыт ли человеку модуль «Сбор сил» (ключ пункта меню, №939). */
  forcesOpen: boolean;
  reserve: { campaignCode: string; campaignTitle: string; kindCode: string } | null;
  status: { code: string; name: string; assignment?: import('@/entities/combat-duty').CombatAssignment | null } | null;
  participations: {
    event_id: number;
    event_code: string;
    event_title: string;
    visit_object_name?: string;
    post_label?: string;
    acknowledged_at?: string | null;
  }[];
  loading: boolean;
  legacyHint: boolean;
}) {
  if (loading && status === null && participations.length === 0 && reserve === null) {
    return <span className="text-muted-foreground text-xs">Загрузка…</span>;
  }
  if (status === null && participations.length === 0 && reserve === null) {
    // Запасной путь: КАДРОВЫЙ код говорит об участии, а мероприятий в разделе
    // не нашлось. Ссылка на общий разрез и подпись, называющая причину, —
    // ровно то, что стояло здесь до №314; переехало в свою колонку целиком,
    // вместе с формулировкой (её стережёт проба `tables-data`).
    if (legacyHint) {
      return (
        <div className="flex max-w-[170px] flex-col items-start gap-0.5">
          {forcesOpen ? (
            <Link
              href="/employees?view=forces"
              className="text-primary-ink text-xs font-medium hover:underline"
            >
              → Сбор сил
            </Link>
          ) : (
            <span className="text-foreground text-xs font-medium">Сбор сил</span>
          )}
          <span className="text-muted-foreground text-[11px] leading-tight">
            Мероприятие у статуса не указано
          </span>
        </div>
      );
    }
    return (
      <span
        className="text-muted-foreground text-xs"
        title="В разделе ОМ у сотрудника нет действующей строки на этот день"
      >
        —
      </span>
    );
  }
  return (
    <div className="flex max-w-[260px] flex-col items-start gap-0.5">
      {reserve !== null && (
        <span
          className="text-amber-700 text-xs font-medium leading-tight"
          title={reserve.campaignTitle}
        >
          Резерв ОМ · {reserve.campaignCode} · Физнаряд
        </span>
      )}
      {status !== null && (
        /* Две строки максимум, полное имя — в подсказке. Имена справочника
           раздела длинные («Привлечён на мероприятие (наряд)»), и без предела
           они растили высоту строки таблицы втрое — ровно та ошибка, которую
           снимок поймал у подписи в №314 на прошлом заходе. */
        <span
          className="text-foreground line-clamp-2 text-xs font-medium leading-tight"
          title={status.name}
        >
          {status.name}
        </span>
      )}
      <CombatAssignmentDetails assignment={status?.assignment} />
      {participations.map((participation) =>
        participation.event_code ? (
          <Link
            // Ключ — по видимой подписи (Plane №819). Сегодня он равен
            // `event_id` (сервер отдаёт для пары сотрудник+ОМ одну и ту же
            // расстановку — разбор в `use-ops-section-statuses.ts`), но собран
            // по подписи на вырост: `event_id` начнёт склеивать разные строки
            // молча, как только расстановка станет множественной.
            key={participationLabelKey(participation)}
            href={`/security-ops/events/${participation.event_id}`}
            // Подпись стала длиннее (объект · пост · ознакомлен) — переносится,
            // а не обрезается: снимок №427 поймал «· Пост 1 · …» без хвоста.
            className="text-primary-ink text-xs leading-tight hover:underline"
            title={participation.event_title}
          >
            {/* «ОМ-код → объект · Пост · ознакомлен» (Plane №427, [СБС-32]/
                [ОЗН-06]); до распределения штабом — один код. */}
            → {participation.event_code}
            {participation.visit_object_name ? ` → ${participation.visit_object_name}` : ""}
            {participation.post_label ? ` · ${participation.post_label}` : ""}
            {participation.acknowledged_at ? " · ознакомлен" : ""}
          </Link>
        ) : (
          <span
            key={participationLabelKey(participation)}
            className="text-muted-foreground whitespace-nowrap text-xs"
            title="Мероприятие удалено — открыть его карточку нельзя"
          >
            ОМ снят (#{participation.event_id})
          </span>
        )
      )}
    </div>
  );
}

export function StatusTable({
  selectedEmployees,
  onSelectionChange,
  loading: externalLoading = false,
  onRefresh,
}: StatusTableProps) {
  // Роль-наблюдатель (Plane №348). Заказчик завёл «Сотрудника», который «видит
  // своё управление, но БЕЗ возможности редактирования»; бэкенд правку и так
  // отклоняет, но экран показывал ему все управляющие элементы — то есть
  // обещал действие, которое закончится отказом.
  //
  // ВЫБОР: прячем то, чего роль не может, а не гасим. Погашенная кнопка —
  // разговор про «сейчас нельзя, позже можно»; у роли права не появится
  // никогда, и вечно серая панель просто занимает место. Так же ведёт себя
  // меню слева: пункт без права не рисуется вовсе.
  // ИСКЛЮЧЕНИЕ — меню строки: там пустое место читается как «кнопку забыли»,
  // и вместо него ставится строка с причиной (то же правило, что у вакансии
  // ниже).
  // Право РАЗДЕЛА (Plane №352, Ш-1): портальный набор `statuses/update` снят
  // вместе со старой системой ролей.
  const access = useOpsPermissions();
  const { hasPermission: hasOpsPermission } = access;
  // Ссылка «→ Сбор сил» в колонке раздела — по ключу модуля, как пункт меню
  // (№939, ревью №825): персоне без прав сбора сил ссылка вела на «Доступ закрыт».
  const forcesOpen = moduleOpenFor("/employees", hasOpsPermission);
  const canEdit = hasOpsPermission("status.manage");
  const canReadDuty = !access.isLoading && hasOpsPermission("status.view");
  const [dutyEmployee, setDutyEmployee] = useState<{ id: number; name: string } | null>(null);
  const pendingDutyEmployee = useRef<{ id: number; name: string } | null>(null);
  const canEditEmployee = (employee: Employee) => !isVacancyRow(employee) && canManageStatusInDivision(access, employee.divisionId);
  const [searchQuery, setSearchQuery] = useState("");
  const [directorateFilter, setDirectorateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // `statusCode` не сортируемое поле (нет управления, задающего его как
  // ключ сортировки, и код — не то же самое, что видимый текст статуса):
  // Сортировка отсюда УБРАНА (Plane №231): менять её было нечем — ни одна
  // кнопка не звала `setSortBy`, — а с постраничной загрузкой клиентская
  // сортировка переставляла бы только показанные пятьдесят строк, выдавая это
  // за порядок всего подразделения. Порядок задаёт сервер (уровень должности,
  // импортный порядок, номер слота), таблица его сохраняет внутри управления.
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [statusActionMode, setStatusActionMode] = useState<"change" | "schedule">("change");
  const [selectedEmployeeForEdit, setSelectedEmployeeForEdit] =
    useState<Employee | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [selectedEmployeeForSchedule, setSelectedEmployeeForSchedule] =
    useState<Employee | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [selectedEmployeeForProfile, setSelectedEmployeeForProfile] =
    useState<EmployeeType | null>(null);

  // ── Страница вместо всего состава (Plane №231) ──────────────────────
  //
  // Таблица звала весь состав подразделения и фильтровала его в браузере: на
  // пяти тысячах сотрудников экран открывался 14,2 секунды и держал 5124
  // строки в DOM, а три пробы форм падали по таймауту клика. Отбор ушёл на
  // сервер целиком — клиентский поиск по загруженной странице искал бы среди
  // пятидесяти строк и молчал бы о том, что остальные не смотрел.
  const [page, setPage] = useState(1);
  const statistics = useStaffUnitStatistics();
  // Мероприятия участия — ОДИН запрос на всю таблицу (Plane №281). Строка
  // таблицы адресует сотрудника ключом `${staffUnitId}-${employeeId}`, а
  // участия приходят по числовому id — отсюда разбор ключа в `eventsOf`.
  const sectionStatuses = useOpsSectionStatuses();
  // Подписи статусов — из справочника (Plane №366): иначе тип, заведённый
  // заказчиком в админке, читается как «Не обновлено».
  const naming = useStatusNaming();
  const directorateId =
    directorateFilter === "all" ? undefined : Number(directorateFilter) || undefined;

  const {
    data,
    isLoading: queryLoading,
    isError: queryFailed,
    isFetching: queryFetching,
    isPlaceholderData,
    refetch,
  } = useStaffUnitsPage({
    page,
    pageSize: STATUS_PAGE_SIZE,
    search: searchQuery || undefined,
    directorateId,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  // Смена отбора возвращает на первую страницу: остаться на седьмой при новом
  // поиске значит показать пустоту там, где результаты есть.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, directorateFilter, statusFilter]);

  const internalLoading = queryLoading || externalLoading;

  // Преобразуем данные из API в формат Employee
  const employees = useMemo<Employee[]>(() => {
    if (!data || !data.staff_units || !Array.isArray(data.staff_units))
      return [];

    const result: Employee[] = [];
    let globalIndex = 1;

    data.staff_units.forEach((unit) => {
      // Реальный API возвращает unit.employee (один объект), а не unit.employees (массив)
      // Проверяем оба варианта для обратной совместимости
      const employee = (unit as any).employee;
      const employeesArray = (unit as any).employees;

      // Если есть массив employees (старый формат)
      if (Array.isArray(employeesArray) && employeesArray.length > 0) {
        employeesArray.forEach((empData: any) => {
          const emp = empData.employee;
          const status = emp?.current_status;

          // Используем форматированный статус с учетом local_status для прикомандированных
          const { text: statusText, code: statusCode } = describeStatus(emp, naming);

          let priority: "normal" | "high" | "critical" = "normal";
          if (!status) {
            priority = "critical";
          } else if (
            status.end_date &&
            new Date(status.end_date) < new Date()
          ) {
            priority = "high";
          }

          result.push({
            id: emp
              ? `${unit.id}-${emp.id}`
              : `${unit.id}-vacant-${globalIndex}`,
            number: globalIndex++,
            name: emp ? [emp.last_name, emp.first_name, emp.middle_name].filter(Boolean).join(" ") : VACANCY_NAME,
            department: unit.division?.name || "Не указан",
            divisionId: unit.division?.id ?? null,
            directorateId: unit.directorate_id ?? null,
            directorateName: unit.directorate_name || "Без управления",
            departmentName: unit.department_name || "",
            position: empData.position?.name || "Должность не указана",
            status: statusText,
            statusCode,
            startDate: status?.start_date ?? "",
            endDate: status?.end_date ?? "",
            phone: "",
            email: "",
            priority,
          });
        });
      }
      // Если есть один employee (новый формат API)
      else if (employee) {
        const status = employee.current_status;

        // Используем форматированный статус с учетом local_status для прикомандированных
        const { text: statusText, code: statusCode } = describeStatus(employee, naming);

        let priority: "normal" | "high" | "critical" = "normal";
        if (!status) {
          priority = "critical";
        } else if (status.end_date && new Date(status.end_date) < new Date()) {
          priority = "high";
        }

        result.push({
          id: `${unit.id}-${employee.id}`,
          number: globalIndex++,
          name: [employee.last_name, employee.first_name, employee.middle_name].filter(Boolean).join(" "),
          department: unit.division?.name || "Не указан",
          divisionId: unit.division?.id ?? null,
          directorateId: unit.directorate_id ?? null,
          directorateName: unit.directorate_name || "Без управления",
          departmentName: unit.department_name || "",
          position: (unit as any).position?.name || "Должность не указана",
          status: statusText,
          statusCode,
          startDate: status?.start_date ?? "",
          endDate: status?.end_date ?? "",
          phone: "",
          email: "",
          priority,
        });
      }
      // Если нет сотрудника - вакансия
      else {
        result.push({
          id: `${unit.id}-vacant`,
          number: globalIndex++,
          name: VACANCY_NAME,
          department: unit.division?.name || "Не указан",
          divisionId: unit.division?.id ?? null,
          directorateId: unit.directorate_id ?? null,
          directorateName: unit.directorate_name || "Без управления",
          departmentName: unit.department_name || "",
          position: (unit as any).position?.name || "Должность не указана",
          status: "Не обновлено",
          statusCode: null,
          startDate: "",
          endDate: "",
          phone: "",
          email: "",
          priority: "critical",
        });
      }
    });

    return result;
  }, [data, naming]);

  // Управления — из статистики доступной области, включая тех, кого нет
  // на текущей странице. Идентификатор различает одинаковые названия.
  const directorates = useMemo<{ id: number; label: string }[]>(() => {
    const stats = statistics.data;
    if (!stats) return [];
    const rows = stats.directorates.map((row) => ({
      id: row.directorate_id, name: row.directorate_name, ancestors: row.ancestors ?? [],
    }));
    return rows.map((row) => ({
      id: row.id,
      label: row.ancestors.length > 0 ? `${row.ancestors.join(" › ")} › ${row.name}` : row.name,
    }));
  }, [statistics.data]);

  // Функция для обновления данных
  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    } else {
      refetch();
    }
  };

  /** Числовой id сотрудника. Понимает ОБА вида ключа, и это не перестраховка:
   *  строка таблицы адресует сотрудника составным `${staffUnitId}-${employeeId}`,
   *  а карточка профиля — просто `${employeeId}` (её собирает `personnelFields`).
   *  Разбор «взять кусок после дефиса» на втором виде молча давал пусто, и блок
   *  мероприятий в карточке не показывался ни разу.
   *  null — вакансия либо не разобралось. */
  const employeeIdOf = (employee: { id: string }) => {
    const parts = employee.id.split("-");
    const raw = parts.length > 1 ? parts[1] : parts[0];
    if (!raw || raw.startsWith("vacant")) return null;
    const employeeId = Number(raw);
    return Number.isNaN(employeeId) ? null : employeeId;
  };

  /** Мероприятия, на которые привлечён сотрудник строки. Пусто — их нет либо
   *  данные ещё едут (`sectionStatuses.loading` различает эти два случая). */
  const eventsOf = (employee: { id: string }) => {
    const employeeId = employeeIdOf(employee);
    if (employeeId === null) return [];
    return sectionStatuses.byEmployee.get(employeeId) ?? [];
  };

  /** Действующий статус сотрудника ПО КАТАЛОГУ РАЗДЕЛА (Plane №314).
   *  `null` — строки в разделе нет либо данные ещё едут. */
  const sectionStatusOf = (employee: { id: string }) => {
    const employeeId = employeeIdOf(employee);
    if (employeeId === null) return null;
    return sectionStatuses.statusByEmployee.get(employeeId) ?? null;
  };

  const reserveOf = (employee: { id: string }) => {
    const employeeId = employeeIdOf(employee);
    if (employeeId === null) return null;
    return sectionStatuses.reserveByEmployee.get(employeeId) ?? null;
  };

  // Функция для открытия диалога редактирования
  const handleEditStatus = (employee: Employee, mode: "change" | "schedule" = "change") => {
    // Вторая застава после меню (Plane №257): у вакансии сотрудника нет, и
    // форма заведения статуса ей не адресована — открывать окно, которое
    // заведомо упрётся в «Сотрудник не найден», хуже, чем не открыть.
    if (!canEditEmployee(employee)) return;
    setStatusActionMode(mode);
    setSelectedEmployeeForEdit(employee);
    setEditDialogOpen(true);
  };

  // Функция для открытия диалога планирования
  const handleScheduleStatus = (employee: Employee) => {
    if (!canEditEmployee(employee)) return;
    setSelectedEmployeeForSchedule(employee);
    setScheduleDialogOpen(true);
  };

  // Функция для открытия профиля сотрудника
  const handleViewProfile = (employee: Employee) => {
    if (!data || !data.staff_units || !Array.isArray(data.staff_units)) return;

    // Проверяем, что это не вакантная должность
    if (isVacancyRow(employee)) return;

    // Парсим ID - формат: unitId-employeeId или unitId-vacant-index
    const [unitIdStr, employeeIdStr] = employee.id.split("-");
    const unitId = parseInt(unitIdStr, 10);
    const employeeId =
      employeeIdStr && !employeeIdStr.startsWith("vacant")
        ? parseInt(employeeIdStr, 10)
        : null;

    if (!employeeId) return;

    const staffUnit = data.staff_units.find((unit) => unit.id === unitId);
    if (!staffUnit) return;

    // Проверяем оба формата: новый (unit.employee) и старый (unit.employees)
    const unitEmployee = (staffUnit as any).employee;
    const employeesArray = (staffUnit as any).employees;

    let emp: any = null;

    if (unitEmployee && unitEmployee.id === employeeId) {
      // Новый формат: один employee
      emp = unitEmployee;
    } else if (Array.isArray(employeesArray)) {
      // Старый формат: массив employees
      const empData = employeesArray.find(
        (e: any) => e.employee?.id === employeeId
      );
      emp = empData?.employee;
    }

    if (!emp) return;

    // Кадровые поля разбирает общий `personnelFields` — тот же, что у
    // `/employees`. Своя копия здесь подставляла пустые строки в звание, ИИН
    // и дату найма, и карточка с этого экрана выглядела беднее той же
    // карточки с соседнего.
    const employeeProfile: EmployeeType = {
      ...personnelFields(emp, naming),
      number: employee.number,
      position: employee.position,
      department: employee.department,
      departmentId: staffUnit.division?.id.toString() ?? "",
    };

    setSelectedEmployeeForProfile(employeeProfile);
    setProfileDialogOpen(true);
  };

  // Функция для обработки успешного обновления
  const handleEditSuccess = () => {
    handleRefresh();
    if (onRefresh) {
      onRefresh();
    }
  };

  const loading = externalLoading || internalLoading;

  // Фильтр «Все статусы» — по СПРАВОЧНИКУ (Plane №354). Иначе заведённый
  // администратором тип можно проставить, но нельзя найти: список фильтра
  // остался бы прежним, и человек решил бы, что статус не сохранился.
  // Запасной путь — прежний зашитый перечень: пока справочник не доехал,
  // фильтр обязан оставаться рабочим, а не пустым.
  const { types: catalogStatusTypes } = useEmployeeStatusTypes(false);
  const statusTypeSource =
    catalogStatusTypes.length > 0
      ? catalogStatusTypes.map((item) => ({
          code: item.code,
          label: item.label,
          color: item.color || getEmployeeStatusColor(item.code as never),
        }))
      : EMPLOYEE_STATUS_ITEMS;

  const statusTypes = statusTypeSource.map((item) => {
    let icon = Calendar;
    switch (item.code) {
      case "in_service":
        icon = CheckCircle;
        break;
      case "on_duty":
      case "after_duty":
        icon = Clock;
        break;
      case "sick_leave":
      case "other_absence":
        icon = AlertCircle;
        break;
      default:
        icon = Calendar;
    }

    return {
      value: item.label,
      color: item.color,
      icon,
    };
  });

  // Цвет и значок берутся ПО КОДУ, а не по подписи (Plane №366). Раньше код
  // добывался обратным поиском по русскому тексту
  // (`EMPLOYEE_STATUS_CODE_BY_LABEL[status]`), и это работало ровно до первого
  // типа из справочника: у «Участие в ОМ» в таблице подписей строки нет, поиск
  // отдавал `undefined`, и статус красился серым «как неизвестный», даже когда
  // подпись у него уже была правильная.
  const getStatusBadge = (status: string, code: string | null) => {
    if (!code) {
      // Статуса НЕТ вовсе (вакансия, никто не отмечал) — тот же серый, что у
      // нераспознанного кода: один источник, а не вторая копия.
      return <Badge className={UNKNOWN_STATUS_PAINT.badge}>{status}</Badge>;
    }

    const statusType = statusTypes.find((s) => s.value === status);
    const colorClass = naming.colorOf(code);

    if (!statusType) {
      return <Badge className={colorClass}>{status}</Badge>;
    }

    const Icon = statusType.icon;
    return (
      <Badge className={colorClass}>
        <Icon className="h-3 w-3 mr-1" />
        {status}
      </Badge>
    );
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "border-l-4 border-red-500";
      case "high":
        return "border-l-4 border-yellow-500";
      default:
        return "border-l-4 border-transparent";
    }
  };

  // ОТБОР СЧИТАЕТ СЕРВЕР (Plane №231). Здесь остаётся только порядок строк —
  // он же порядок ответа, и сортировка по номеру ничего не переставляет, а
  // делает это явным.
  const filteredEmployees = useMemo(
    () => [...employees].sort((a, b) => a.number - b.number),
    [employees]
  );

  const directorateGroups = useMemo(() => {
    const groups = new Map<number | null, { id: number | null; label: string; employees: Employee[] }>();
    for (const employee of filteredEmployees) {
      let group = groups.get(employee.directorateId);
      if (!group) {
        group = {
          id: employee.directorateId,
          label: employee.directorateId === null
            ? "Без управления"
            : [employee.departmentName, employee.directorateName].filter(Boolean).join(" › "),
          employees: [],
        };
        groups.set(employee.directorateId, group);
      }
      group.employees.push(employee);
    }
    return [...groups.values()];
  }, [filteredEmployees]);

  const selectableIds = filteredEmployees.filter(canEditEmployee).map(employee => employee.id);
  const selectedIds = new Set(selectedEmployees);
  const selectedOnPage = selectableIds.filter(id => selectedIds.has(id)).length;
  const selectionUnavailable = loading || queryFetching || isPlaceholderData || queryFailed;
  const hasFilters = Boolean(searchQuery || directorateFilter !== "all" || statusFilter !== "all");
  const resetFilters = () => { setSearchQuery(""); setDirectorateFilter("all"); setStatusFilter("all"); };

  const handleSelectAll = (checked: boolean) => {
    if (selectionUnavailable) return;
    if (checked) {
      onSelectionChange([...new Set([...selectedEmployees, ...selectableIds])]);
    } else {
      const visibleIds = new Set(selectableIds);
      onSelectionChange(selectedEmployees.filter(id => !visibleIds.has(id)));
    }
  };

  const handleSelectEmployee = (employeeId: string, checked: boolean) => {
    if (selectionUnavailable || !selectableIds.includes(employeeId)) return;
    if (checked) {
      onSelectionChange([...new Set([...selectedEmployees, employeeId])]);
    } else {
      onSelectionChange(selectedEmployees.filter((id) => id !== employeeId));
    }
  };

  /** Срок статуса вышел. Считается по ISO-дате: разбирать обратно то, что
   *  сами же отформатировали, значит зависеть от локали вывода. */
  const isOverdue = (endDate: string) => {
    const date = parseIsoDate(endDate);
    if (date === null) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Сотрудники организации</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span role="status">
            {canEdit ? (
              <>
                Выбрано: {selectedEmployees.length} · найдено строк: {data?.matched_count ?? filteredEmployees.length}
              </>
            ) : (
              <>Найдено строк: {data?.matched_count ?? filteredEmployees.length}</>
            )}
            </span>
            {canEdit && selectedEmployees.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => onSelectionChange([])}>Снять весь выбор</Button>}
          </div>
        </div>
        {canEdit && <p className="text-xs text-muted-foreground">Флажок в заголовке выбирает доступных сотрудников этой страницы. Выбор сохраняется при поиске и переходе по страницам.</p>}
        {canEdit && <label className="flex min-h-11 items-center gap-2 text-sm md:hidden">
          <Checkbox
            aria-label="Выбрать доступных сотрудников страницы"
            disabled={selectionUnavailable || selectableIds.length === 0}
            checked={selectedOnPage === 0 ? false : selectedOnPage === selectableIds.length ? true : "indeterminate"}
            onCheckedChange={checked => handleSelectAll(checked === true)}
          />
          Выбрать на этой странице
        </label>}
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Поиск сотрудников в таблице статусов"
              placeholder="Поиск по ФИО, подразделению, должности..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Тот же выбор с поиском, что в реестре (Plane №232). */}
          <DivisionPicker
            value={directorateFilter}
            options={directorates}
            onChange={setDirectorateFilter}
            allLabel="Все управления"
            ariaLabel="Фильтр по управлению"
          />

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Фильтр по статусу">
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {statusTypes.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && <Button type="button" variant="outline" onClick={resetFilters}>Сбросить фильтры</Button>}
        </div>

        {/* Table */}
        <div className="rounded-md border">
          <Table className={styles.roster} aria-label="Сотрудники и статусы" data-can-select={canEdit}>
            <TableHeader>
              <TableRow>
                {canEdit && (
                  <TableHead className="w-12">
                    <Checkbox
                      aria-label="Выбрать сотрудников на этой странице"
                      title="Выбрать доступных сотрудников этой страницы"
                      disabled={selectionUnavailable || selectableIds.length === 0}
                      checked={
                        selectedOnPage === 0 ? false : selectedOnPage === selectableIds.length ? true : "indeterminate"
                      }
                      onCheckedChange={checked => handleSelectAll(checked === true)}
                    />
                  </TableHead>
                )}
                <TableHead className="w-16">№</TableHead>
                <TableHead>ФИО</TableHead>
                <TableHead>Управление</TableHead>
                <TableHead>Должность</TableHead>
                {/* ДВЕ КОЛОНКИ, А НЕ ОДНА (Plane №314, решение заказчика
                    30.08.2026). У экрана два источника: кадровая ручка
                    штатки (`EmployeeStatus`) и каталог раздела ОМ
                    (`/api/operations/statuses/`). Оба факта верны каждый в
                    своём учёте, но в ОДНОЙ ячейке строка утверждала разом «в
                    строю» и «привлечён на ОМ» — и это читалось как
                    противоречие данных. Мост кодов (раздел перекрывает
                    кадровый) заказчиком отвергнут: кадровым статусом живут
                    кадровые отчёты, и прятать его нельзя. */}
                <TableHead>Статус (кадровый)</TableHead>
                <TableHead>По разделу ОМ</TableHead>
                {/* ПОДПИСИ КОЛОНОК СОКРАЩЕНЫ (Plane №331, решение заказчика
                    30.08.2026). Замерено на 1280 px: таблица 1367 px в
                    контейнере 908 px, и две колонки дат были самыми широкими
                    — 163 и 168 px, причём ширину задавали ЗАГОЛОВКИ, а не
                    даты под ними (дата занимает ~85 px). «Обновлён» и
                    «Следующий» отвечают на тот же вопрос: слово «обновление»
                    в колонке таблицы статусов не добавляет ничего, чего не
                    сказал бы заголовок экрана. */}
                <TableHead className="whitespace-nowrap">Обновлён</TableHead>
                <TableHead className="whitespace-nowrap">Следующий</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {directorateGroups.map((group) => (
                <Fragment key={group.id ?? "without-directorate"}>
                  <TableRow data-directorate-id={group.id ?? "none"} className="bg-muted/50">
                    <TableCell colSpan={canEdit ? 10 : 9} className="font-semibold">
                      {group.label}
                    </TableCell>
                  </TableRow>
                  {group.employees.map((employee) => (
                <TableRow
                  key={employee.id}
                  // Адрес строки для проб и для отладки: ФИО на стенде
                  // повторяются (однофамильцев с одинаковым именем по
                  // несколько), и проба, ищущая строку текстом, проверяла бы
                  // ЧУЖОГО человека. Тот же приём, что в таблице сбора сил.
                  data-employee-id={employeeIdOf(employee) ?? undefined}
                  // Подсветка просрочки ОСТАЁТСЯ: она несёт смысл, а не
                  // декорацию. Уходит только зебра.
                  className={`${getPriorityColor(employee.priority)} hover:bg-muted ${
                    isOverdue(employee.endDate) ? "bg-red-50" : ""
                  }`}
                >
                  {canEdit && (
                    <TableCell data-status-cell="select">
                      <Checkbox
                        aria-label={isVacancyRow(employee) ? "Выбор вакансии недоступен" : `Выбрать сотрудника: ${employee.name}`}
                        disabled={selectionUnavailable || !canEditEmployee(employee)}
                        checked={selectedEmployees.includes(employee.id)}
                        onCheckedChange={(checked) =>
                          handleSelectEmployee(employee.id, checked as boolean)
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-medium" data-status-cell="number">
                    {employee.number}
                  </TableCell>
                  {/* Подстрока телефона снята: ручка штатки телефон не
                      отдаёт вовсе (`employee.phone` — всегда пустая строка),
                      и пустая строка держала лишнюю строку высоты в КАЖДОЙ
                      строке таблицы без единого символа текста. */}
                  <TableCell data-status-cell="name">
                    <div className="font-medium">{employee.name}</div>
                    <details className="mt-1 text-xs text-muted-foreground md:hidden">
                      <summary className="min-h-9 cursor-pointer py-2">Должность и даты</summary>
                      <dl className="space-y-2 pb-2">
                        <div><dt className="font-medium">Должность</dt><dd>{employee.position}</dd></div>
                        <div><dt className="font-medium">Обновлён</dt><dd>{formatIsoDate(employee.startDate, "Не обновлено")}</dd></div>
                        <div><dt className="font-medium">Следующий</dt><dd className={isOverdue(employee.endDate) ? "text-destructive-ink font-medium" : ""}>{formatIsoDate(employee.endDate, "Не указано")}{isOverdue(employee.endDate) && <AlertCircle className="ml-1 inline h-4 w-4" aria-label="Срок прошёл" />}</dd></div>
                      </dl>
                    </details>
                  </TableCell>
                  {/* Отдел и должность — с ПРЕДЕЛОМ ширины и полным текстом
                      в подсказке (Plane №331). Они были вторыми и первыми по
                      ширине (210 и 295 px из 1367): длинные названия вроде
                      «Заместитель начальника управления» растягивали колонку
                      на всех, а читают её по началу строки. */}
                  <TableCell className="text-sm" data-status-cell="directorate">
                    <span
                      className="block max-w-[130px] truncate"
                      title={employee.directorateName}
                    >
                      {employee.directorateName}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm" data-status-cell="position">
                    <span
                      className="block max-w-[150px] truncate"
                      title={employee.position}
                    >
                      {employee.position}
                    </span>
                  </TableCell>
                  {/* Статус — точка входа в СПИСОК статусов сотрудника
                      (текущий + запланированные), а не в форму заведения
                      нового: щелчок по уже проставленному статусу — это
                      вопрос «что у человека сейчас и что впереди», и форма
                      на этот вопрос не отвечает. Завести новый статус
                      по-прежнему можно пунктом меню «Запланировать статус».
                      Кнопка, а не onClick на ячейке: строка кликабельна и с
                      клавиатуры, и роль элемента не приходится угадывать. */}
                  {/* whitespace-normal перебивает умолчание примитива
                      (nowrap): у соседних ячеек это верно (одна строка,
                      известной ширины), а подпись под ссылкой — фраза на
                      два-три слова короче своей ширины, и nowrap растянул бы
                      её в одну строку через всю таблицу вместо переноса. */}
                  <TableCell className="whitespace-normal" data-status-cell="status">
                    <span className="mb-1 block text-xs text-muted-foreground md:hidden">Статус (кадровый)</span>
                    {!canEditEmployee(employee) ? (
                      getStatusBadge(employee.status, employee.statusCode)
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <button
                          type="button"
                          onClick={() => handleScheduleStatus(employee)}
                          title="Открыть статусы сотрудника"
                          className="rounded focus:outline-none focus:ring-2 focus:ring-blue-500 hover:opacity-80"
                        >
                          {getStatusBadge(employee.status, employee.statusCode)}
                        </button>
                      </div>
                    )}
                  </TableCell>
                  {/* УЧЁТ РАЗДЕЛА ОМ — СВОЯ КОЛОНКА (Plane №314). Здесь всё,
                      что приходит из каталога раздела: действующий статус по
                      его справочнику и мероприятия, на которые человек
                      привлечён. Кадровый бейдж остался слева и не подменяется.

                      Прочерк означает «в разделе строки нет», и это НЕ то же
                      самое, что «данные ещё едут»: пока идёт запрос, колонка
                      не вправе утверждать, что человек ни на что не привлечён
                      (`sectionStatuses.loading` различает эти два случая). */}
                  <TableCell className="whitespace-normal" data-status-cell="ops">
                    <span className="mb-1 block text-xs text-muted-foreground md:hidden">По разделу ОМ</span>
                    {isVacancyRow(employee) ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <SectionAccountCell
                        forcesOpen={forcesOpen}
                        reserve={reserveOf(employee)}
                        status={sectionStatusOf(employee)}
                        participations={eventsOf(employee)}
                        loading={sectionStatuses.loading}
                        legacyHint={
                          employee.statusCode !== null &&
                          EVENT_PARTICIPATION_STATUS_CODES.has(employee.statusCode)
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums" data-status-cell="updated">
                    {formatIsoDate(employee.startDate, "Не обновлено")}
                  </TableCell>
                  <TableCell className="text-sm" data-status-cell="next">
                    <div
                      className={
                        isOverdue(employee.endDate)
                          ? "text-destructive-ink font-medium"
                          : ""
                      }
                    >
                      {formatIsoDate(employee.endDate, "Не указано")}
                      {isOverdue(employee.endDate) && (
                        <AlertCircle className="h-4 w-4 inline ml-1" aria-hidden="true" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell data-status-cell="actions">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-11 w-11 p-0 md:h-8 md:w-8"
                          // Имя с фамилией: в таблице таких кнопок столько же,
                          // сколько строк, и «Действия» без адресата не
                          // отличает одну от другой.
                          aria-label={`Действия: ${employee.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      {/* Loading the day panel can move the row below the
                          viewport after this menu opens. A side placement
                          lets Radix keep the menu vertically inside it. */}
                      <DropdownMenuContent align="end" side="left" sticky="always" collisionPadding={8}
                        onCloseAutoFocus={(event) => {
                          if (!pendingDutyEmployee.current) return;
                          // Let the menu release its modal pointer lock before mounting the dialog.
                          event.preventDefault();
                          setDutyEmployee(pendingDutyEmployee.current);
                          pendingDutyEmployee.current = null;
                        }}>
                        <DropdownMenuLabel>Действия</DropdownMenuLabel>
                        {canReadDuty && !isVacancyRow(employee) && employeeIdOf(employee) !== null && (
                          <DropdownMenuItem onSelect={() => { pendingDutyEmployee.current = { id: employeeIdOf(employee)!, name: employee.name }; }}>
                            <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
                            Назначения в наряд
                          </DropdownMenuItem>
                        )}
                        {/* У ВАКАНСИИ действий нет НИ ОДНОГО: все четыре
                            адресованы человеку, которого на должности нет
                            (Plane №257). Раньше три пункта прятались, а
                            четвёртый — «Запланировать статус» — оставался и
                            обещал операцию, которой нет: окно открывалось,
                            форма заполнялась, сохранение падало в «Сотрудник
                            не найден».

                            Меню при этом НЕ прячется и не гасится целиком:
                            пустое место в столбце действий читается как
                            «кнопку забыли нарисовать», а погашенный триггер
                            не отвечает на вопрос «почему». Вместо этого одна
                            нерабочая строка объясняет причину — то же
                            правило, что у пустого состояния списка: не белое
                            пятно, а фраза. */}
                        {!isVacancyRow(employee) && !canEditEmployee(employee) ? (
                          <DropdownMenuItem disabled>
                            <UserX className="mr-2 h-4 w-4" aria-hidden="true" />
                            Только просмотр — правка статусов закрыта
                          </DropdownMenuItem>
                        ) : isVacancyRow(employee) ? (
                          <DropdownMenuItem disabled>
                            <UserX className="mr-2 h-4 w-4" aria-hidden="true" />
                            Должность вакантна — действий нет
                          </DropdownMenuItem>
                        ) : (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleEditStatus(employee)}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Изменить статус
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleScheduleStatus(employee)}
                            >
                              <Calendar className="mr-2 h-4 w-4" />
                              Запланированные статусы
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleViewProfile(employee)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Просмотр профиля
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>

        <Pager
          page={page}
          pageSize={STATUS_PAGE_SIZE}
          matched={data?.matched_count ?? filteredEmployees.length}
          hasNext={data?.has_next ?? false}
          busy={queryFetching}
          onChange={setPage}
        />

        {loading && (
          <div className="text-center py-8 text-muted-foreground">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
            <p className="mt-2">Загрузка данных...</p>
          </div>
        )}

        {/* Отказ запроса и «никто не подошёл под фильтр» — разные факты:
            раньше оба давали «Сотрудники не найдены» на главном экране. */}
        {!loading && queryFailed && (
          <LoadFailure
            what="список сотрудников"
            onRetry={() => void refetch()}
            isRetrying={queryFetching}
            className="items-center text-center"
          />
        )}

        {!loading && !queryFailed && filteredEmployees.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Сотрудники не найдены</p>
          </div>
        )}
      </CardContent>

      {/* Диалог редактирования статуса */}
      {canReadDuty && dutyEmployee && (
        <EmployeeDutyPlacementDialog
          key={dutyEmployee.id}
          employeeId={dutyEmployee.id}
          employeeName={dutyEmployee.name}
          onClose={() => setDutyEmployee(null)}
        />
      )}

      <EditStatusDialog
        mode={statusActionMode}
        open={editDialogOpen && selectedEmployeeForEdit !== null && canEditEmployee(selectedEmployeeForEdit)}
        onOpenChange={setEditDialogOpen}
        employeeId={selectedEmployeeForEdit?.id || null}
        employeeName={selectedEmployeeForEdit?.name}
        currentStatus={selectedEmployeeForEdit?.status}
        employeePosition={selectedEmployeeForEdit?.position}
        employeeDepartment={selectedEmployeeForEdit?.department}
        onSuccess={handleEditSuccess}
      />

      {/* Диалог просмотра запланированных статусов */}
      <PlannedStatusesDialog
        open={scheduleDialogOpen && selectedEmployeeForSchedule !== null && canEditEmployee(selectedEmployeeForSchedule)}
        onOpenChange={setScheduleDialogOpen}
        employeeId={selectedEmployeeForSchedule?.id || null}
        employeeName={selectedEmployeeForSchedule?.name}
        // Список закрываем ДО открытия формы: два Radix-диалога разом дерутся
        // за фокус-ловушку. Сотрудник берётся из состояния списка — он же
        // адресат формы, и спрашивать его заново не у чего.
        onSchedule={() => {
          const employee = selectedEmployeeForSchedule;
          if (!employee) return;
          setScheduleDialogOpen(false);
          handleEditStatus(employee, "schedule");
        }}
      />

      {/* Диалог просмотра профиля */}
      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          {/* Заголовок обязателен: без него Radix ругается в консоли, а
              скринридер объявляет диалог без имени. Визуально он не нужен —
              карточка профиля печатает имя сама. */}
          <DialogHeader className="sr-only">
            <DialogTitle>
              Профиль сотрудника
              {selectedEmployeeForProfile
                ? `: ${selectedEmployeeForProfile.name}`
                : ""}
            </DialogTitle>
          </DialogHeader>
          {selectedEmployeeForProfile && (
            <EmployeeProfile
              employee={selectedEmployeeForProfile}
              onClose={() => setProfileDialogOpen(false)}
              events={eventsOf(selectedEmployeeForProfile)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
