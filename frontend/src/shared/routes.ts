// Канон-слот ARCH-FE-012 (L555): ВСЕ пути портала — только константы отсюда;
// строковые literal-пути в navigate/Link/Navigate/Route вне этого файла —
// eslint красный (no-restricted-syntax, ужесточение 8.7). Полная карта
// пилота — UX L59-68; /admin/* в карту НЕ входит (Д5: SPA-админки в пилоте
// нет, Django Admin живёт отдельно). Фабрик с параметрами пока нет —
// детальные маршруты приедут со своими сториями.
import {
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Network,
  Radar,
  ScrollText,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const ROUTES = {
  login: '/login',
  /** Дашборд «Расход» (E10). */
  home: '/',
  employees: '/employees',
  dailyExpense: '/daily-expense',
  organization: '/organization',
  reports: '/reports',
  audit: '/audit',
  /**
   * Тест-страница печатного каркаса (8.8, ARCH-FE-014/L255): вне AppLayout,
   * в NAV_SECTIONS не живёт. Фабрики реальных печатных форм — со сториями E10.
   */
  printTest: '/print/test',
  /**
   * Печатная форма расхода (10.7): вне AppLayout, за правом
   * `daily_report.generate`, в NAV_SECTIONS не живёт (печатная форма — не
   * раздел портала). Параметры — query, зеркалит форму запроса API.
   */
  printExpense: '/print/expense',
  /**
   * Журнал «сообщено → исправлено» (10.9): ВНУТРИ layout-route, за
   * `RequireAuth`, но БЕЗ `RequirePermission` — журнал доступен всем
   * авторизованным (AC стори 13.4, epics.md#L1378).
   *
   * 🔴 В `NAV_SECTIONS` НЕ ЖИВЁТ, и это структурная причина, а не вкус:
   * `NavSection.permission` обязателен (см. интерфейс ниже), а `AppLayout`
   * фильтрует разделы через `hasPermission(s.permission)` — «доступно всем» в
   * эту модель не выражается без её переделки. ВХОД НА СТРАНИЦУ — ссылка
   * версии в футере каркаса (правило «роут без входа — мёртвый продукт»).
   */
  changelog: '/changelog',
  /**
   * ПЕРВАЯ фабрика в файле (шапка выше её и предвидела). Нужна, потому что
   * literal-путь вне этого файла — eslint error (ARCH-FE-012): голый
   * `<a href="/print/expense?...">` красный, легален только `<Link to={...}>`
   * с этой фабрикой.
   */
  printExpenseTo: (divisionId: string, businessDate: string) =>
    `/print/expense?division_id=${encodeURIComponent(divisionId)}&business_date=${encodeURIComponent(businessDate)}`,
  /**
   * Smart Josparlau (мастер-промпт §11, Этап 2): «Командный центр» — ОТДЕЛЬНЫЙ
   * дашборд от `home` (тот занят существующим «Расход», E10, за `status.view`).
   * Оба дашборда сосуществуют — свой раздел, своё право, свой NAV_SECTIONS-пункт.
   */
  commandCenter: '/command-center',
  securityEvents: '/security-events',
  /** `:id` — литерал маршрута для `<Route path>`, НЕ ссылка; ссылка — фабрика ниже. */
  securityEventDetail: '/security-events/:id',
  securityEventDetailTo: (id: string) =>
    `/security-events/${encodeURIComponent(id)}`,
  /** Этап 4 (мастер-промпт §20): карточка сотрудника — read-only оперативный профиль. */
  employeeDetail: '/employees/:id',
  employeeDetailTo: (id: string) => `/employees/${encodeURIComponent(id)}`,
  /** Этап 5 (мастер-промпт §21): «Служба» → Объекты и паспорта. */
  objects: '/objects',
  objectDetail: '/objects/:id',
  objectDetailTo: (id: string) => `/objects/${encodeURIComponent(id)}`,
  /** Этап 6/7 (мастер-промпт §22): аналитика службы. */
  serviceAnalytics: '/analytics',
  /** Мастер-промпт §21/§24: «Служба» → План дежурств. */
  duties: '/duties',
  /**
   * Story 14.11j (Epic 14): «Служба» → Планы дежурств — РЕАЛЬНЫЙ бэк
   * (`/api/operations/duty-plans/`). НЕ путать с `duties` выше (Smart
   * Josparlau, чужой, всё ещё несуществующий бэк `/api/ops/duty-shifts/`) —
   * два похожих по смыслу раздела сосуществуют осознанно (14.11i's Scope
   * Decision, коллизия имён разрешена явным решением пользователя).
   */
  dutyPlans: '/duty-plans',
  /** Story 14.11k: деталь ОДНОГО плана дежурств + грид его смен. */
  dutyPlanDetail: '/duty-plans/:id',
  dutyPlanDetailTo: (id: string | number) => `/duty-plans/${encodeURIComponent(String(id))}`,
  /**
   * Story 16.8h2 (Epic 16): «Расстановка» — РЕАЛЬНЫЙ бэк
   * (`/api/operations/assignment-versions/`). Отдельный от
   * `SecurityEventDetailPage` экран — та страница целиком pending-contract
   * (фиктивный event id), embedding невозможен без миграции вне объёма 16.8
   * (пользовательское решение при create-story 16.8h2).
   */
  placementVersions: '/placement',
  /** Story 16.8h2: деталь ОДНОЙ версии Расстановки + назначения + конфликты. */
  placementVersionDetail: '/placement/:id',
  placementVersionDetailTo: (id: string | number) =>
    `/placement/${encodeURIComponent(String(id))}`,
} as const

export interface NavSection {
  /**
   * ⚠️ `Extract<…, string>`, а не весь union значений ROUTES: с появлением
   * фабрики `printExpenseTo` union включает функциональный тип, и без Extract
   * навигация начала бы принимать функцию как маршрут. `tsc` сам по себе не
   * покраснел бы (`Object.values(ROUTES)` в репозитории не используется) —
   * поэтому сужение сознательное.
   */
  route: Extract<(typeof ROUTES)[keyof typeof ROUTES], string>
  /** Русская подпись раздела (порядок и имена — прототип, бриф 1 L44-46). */
  label: string
  icon: LucideIcon
  /** Код права из seed_operations (дословно); сравнение — usePermissions. */
  permission: string
}

// Роль-фильтрованный сайдбар (UX L52): раздел виден только с его правом
// (или wildcard `*`); фильтрует AppLayout через hasPermission.
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    route: ROUTES.home,
    label: 'Дашборд',
    icon: LayoutDashboard,
    permission: 'status.view',
  },
  {
    route: ROUTES.commandCenter,
    label: 'Командный центр',
    icon: Radar,
    permission: 'ops.dashboard.view',
  },
  {
    route: ROUTES.securityEvents,
    label: 'Реестр ОМ',
    icon: ShieldAlert,
    permission: 'ops.security_event.view',
  },
  {
    route: ROUTES.employees,
    label: 'Управление персоналом',
    icon: Users,
    permission: 'status.view',
  },
  {
    route: ROUTES.objects,
    label: 'Объекты и паспорта',
    icon: Building2,
    permission: 'ops.object.view',
  },
  {
    route: ROUTES.duties,
    label: 'План дежурств',
    icon: CalendarClock,
    permission: 'ops.duty.view',
  },
  {
    route: ROUTES.dutyPlans,
    label: 'Планы дежурств',
    icon: CalendarClock,
    permission: 'duty.manage',
  },
  {
    /**
     * Story 16.8h5 (Epic 16): «Расстановка» — реальный бэк
     * (`/api/operations/assignment-versions/`). Гейт — `assignment.create`
     * (OMD), единственный код, хотя list/detail в бэке принимают любой из
     * assignment.create/.submit/.return/.approve — `RequirePermission`
     * несёт ОДИН код (тот же компромисс, что `dutyPlans`'s `duty.manage`).
     */
    route: ROUTES.placementVersions,
    label: 'Расстановка',
    icon: UserCheck,
    permission: 'assignment.create',
  },
  {
    route: ROUTES.dailyExpense,
    label: 'Расход дня',
    icon: ClipboardList,
    permission: 'daily_report.mark_update',
  },
  {
    route: ROUTES.organization,
    label: 'Подразделения',
    icon: Network,
    permission: 'status.view',
  },
  {
    route: ROUTES.reports,
    label: 'Отчёты',
    icon: FileText,
    permission: 'daily_report.generate',
  },
  {
    route: ROUTES.serviceAnalytics,
    label: 'Аналитика службы',
    icon: BarChart3,
    permission: 'ops.analytics.view',
  },
  {
    route: ROUTES.audit,
    label: 'Аудит',
    icon: ScrollText,
    permission: 'audit.view',
  },
]
