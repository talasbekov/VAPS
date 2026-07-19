// Канон-слот ARCH-FE-012 (L555): ВСЕ пути портала — только константы отсюда;
// строковые literal-пути в navigate/Link/Navigate/Route вне этого файла —
// eslint красный (no-restricted-syntax, ужесточение 8.7). Полная карта
// пилота — UX L59-68; /admin/* в карту НЕ входит (Д5: SPA-админки в пилоте
// нет, Django Admin живёт отдельно). Фабрик с параметрами пока нет —
// детальные маршруты приедут со своими сториями.
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  Network,
  ScrollText,
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
   * ПЕРВАЯ фабрика в файле (шапка выше её и предвидела). Нужна, потому что
   * literal-путь вне этого файла — eslint error (ARCH-FE-012): голый
   * `<a href="/print/expense?...">` красный, легален только `<Link to={...}>`
   * с этой фабрикой.
   */
  printExpenseTo: (divisionId: string, businessDate: string) =>
    `/print/expense?division_id=${encodeURIComponent(divisionId)}&business_date=${encodeURIComponent(businessDate)}`,
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
    route: ROUTES.employees,
    label: 'Управление персоналом',
    icon: Users,
    permission: 'status.view',
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
    route: ROUTES.audit,
    label: 'Аудит',
    icon: ScrollText,
    permission: 'audit.view',
  },
]
