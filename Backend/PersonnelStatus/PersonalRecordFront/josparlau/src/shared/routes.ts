// Канон-слот ARCH-FE-012 (L555): ВСЕ пути портала — только константы отсюда;
// строковые literal-пути в navigate/Link/Navigate/Route вне этого файла —
// eslint красный (no-restricted-syntax, ужесточение 8.7). Полная карта
// пилота — UX L59-68; /admin/* в карту НЕ входит (Д5: SPA-админки в пилоте
// нет, Django Admin живёт отдельно). Фабрик с параметрами пока нет —
// детальные маршруты приедут со своими сториями.
import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Network,
  Radar,
  MessageSquare,
  ScrollText,
  Settings2,
  ShieldAlert,
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
  /**
   * Smart Josparlau «Архив дела» (прототип Smart Josparlau.dc.html:1459):
   * read-only дело закрытого ОМ. Вложенный маршрут карточки, а не отдельный
   * раздел — в NAV_SECTIONS не живёт, вход — ссылка в шапке закрытой карточки.
   */
  securityEventArchive: '/security-events/:id/archive',
  securityEventArchiveTo: (id: string) =>
    `/security-events/${encodeURIComponent(id)}/archive`,
  /** Этап 4 (мастер-промпт §20): карточка сотрудника — read-only оперативный профиль. */
  employeeDetail: '/employees/:id',
  employeeDetailTo: (id: string) => `/employees/${encodeURIComponent(id)}`,
  /** Этап 5 (мастер-промпт §21): «Служба» → Объекты и паспорта. */
  objects: '/objects',
  objectDetail: '/objects/:id',
  objectDetailTo: (id: string) => `/objects/${encodeURIComponent(id)}`,
  /**
   * Мастер-промпт L5562 `/objects/:objectId/passports/:passportVersionId`:
   * «версия паспорта имеет собственный deep link» (L6038) и открывается
   * только для чтения — опубликованная версия неизменяема (§8.10).
   */
  objectPassportVersion: '/objects/:id/passports/:versionId',
  objectPassportVersionTo: (id: string, versionId: string) =>
    `/objects/${encodeURIComponent(id)}/passports/${encodeURIComponent(versionId)}`,
  /** Этап 6/7 (мастер-промпт §22): аналитика службы. */
  serviceAnalytics: '/analytics',
  /** §22.27 «Прямые ссылки»: маршрут аналитики ОМ назван в промпте отдельно и
   * перепроверяет СВОЁ право — переход с разрешённого дашборда службы доступа
   * к мероприятиям не даёт. */
  operationsAnalytics: '/analytics/operations',
  /**
   * §19.4 второй маршрут — сводный экран итоговых оценок и оперативного
   * рейтинга. Третий (`/employees/:id/operational-rating`) не заведён: он
   * требует связи persona↔сотрудник, и маршрут без неё вёл бы на честно
   * пустой экран.
   */
  ratings: '/ratings',
  /**
   * §19.14 «Рабочее пространство мероприятия» — то, что §19.4 называет первым
   * маршрутом (`/security-events/:id/evaluations`). Здесь мероприятие приходит
   * параметром `?event=`, а не сегментом: очередь принадлежит ОЦЕНЩИКУ, и
   * человек с заданиями в двух мероприятиях иначе не имел бы входа «показать
   * мои задания» вовсе.
   *
   * Право своё — `ops.rating.evaluate`. Правом сводки (`view_aggregate`) его
   * охранять нельзя: оценщик обязан выставить оценку, не видя, как она
   * сложится в рейтинг человека.
   */
  evaluationWorkspace: '/ratings/workspace',
  /**
   * §19.15 сводный экран «Итоговые оценки участников». Право входа —
   * `ops.rating.view_aggregate`: экран показывает РАЗРЕШЁННЫЙ агрегат и
   * безопасный контекст, а закрытых величин в нём нет ни одной (§19.16).
   * Состояние отбора живёт в search params — маршрут их только несёт.
   */
  evaluationRegistry: '/ratings/evaluations',
  /**
   * Карточка агрегата участника (§19.17, aggregate-only ветка). Динамический
   * сегмент соседствует со СТАТИЧЕСКИМИ `/ratings/analytics`, `/ratings/workspace`
   * и `/ratings/evaluations` — React Router ранжирует статический сегмент выше,
   * поэтому перехвата нет; порядок объявления на это не влияет, но проверен
   * тестом маршрутизации.
   */
  ratingEmployeeDetail: '/ratings/employees/:employeeId',
  /**
   * §19.27 журнал оценивания — СВОЙ маршрут и своё право
   * (`ops.rating.view_audit`). Не секция общего `/audit`: тот читают люди без
   * права на рейтинг, и события закрытого раздела раздавались бы вместе с ним.
   */
  ratingAudit: '/ratings/audit',
  /**
   * §19.29 выгрузка рейтинга — СВОЙ маршрут и своё право (`ops.rating.export`).
   * Не секция `/ratings`: там правом входа служит `ops.rating.view_aggregate`,
   * и заказ файла открывался бы каждому, кто вправе посмотреть сводку на
   * экране. Файл переживает экран и уходит из системы — это другое действие.
   */
  ratingExport: '/ratings/export',
  /**
   * Отчёт §22.16 «Аналитика рейтинга» — ОТДЕЛЬНЫЙ маршрут со СВОИМ правом
   * (`ops.analytics.view`). Секцией на `/ratings` он быть не мог: там правом
   * входа служит `ops.rating.view_aggregate`, и отчёт раздела аналитики
   * открывался бы тому, кому раздел аналитики не выдан.
   */
  ratingAnalytics: '/ratings/analytics',
  /** Отчётный реестр Smart Josparlau (§22.18). НЕ `/reports` — там донорский
   * экран «Расход дня» (E10), это другой раздел и другой владелец. */
  serviceReports: '/service-reports',
  /** §22.25 «История отчётов» — отдельный экран того же раздела. Право то же
   * (`ops.report.generate`), но маршрут проверяет его ЗАНОВО: §22.27 прямо
   * запрещает считать доступ разрешённым потому, что человек пришёл по ссылке
   * с разрешённого экрана. */
  serviceReportHistory: '/service-reports/history',
  /**
   * §22.27 «Прямые ссылки»: карточка одной работы. Промпт называет маршрут
   * `/reports/:reportJobId` — здесь он живёт под `/service-reports` по той же
   * причине, что и весь раздел (донорский `/reports` — «Расход дня», E10).
   *
   * ⚠️ Соседствует со СТАТИЧЕСКИМ `/service-reports/history`. React Router
   * ранжирует статический сегмент выше динамического, поэтому история не
   * становится «работой с идентификатором history» — но это свойство роутера,
   * а не наше решение, и оно закреплено тестом.
   */
  serviceReportJob: '/service-reports/:reportJobId',
  serviceReportJobTo: (reportJobId: string) =>
    `/service-reports/${encodeURIComponent(reportJobId)}`,
  /** §28 «Обратная связь»: реестр обращений и форма нового обращения. */
  feedback: '/feedback',
  /**
   * §28 detail — карточка обращения. Право маршрута то же, что у реестра
   * (`ops.feedback.view`), и repository проверяет видимость ЗАНОВО: невидимое
   * обращение отвечает «не найдено», а не «нет прав».
   */
  feedbackDetail: '/feedback/:feedbackId',
  feedbackDetailTo: (feedbackId: string) => `/feedback/${encodeURIComponent(feedbackId)}`,
  /** Мастер-промпт §21/§24: «Служба» → План дежурств. */
  duties: '/duties',
  /**
   * §21.32 «Карточка дежурства» — deep link на одну смену. Право то же, что у
   * плана (`ops.duty.view`): карточка ничего не открывает сверх строки плана,
   * она её разворачивает. Действия смены (ознакомление/заступление/завершение)
   * внутри неё гардятся отдельно — `ops.duty.manage`, как и в таблице.
   */
  dutyShiftDetail: '/duties/:id',
  dutyShiftDetailTo: (id: string) => `/duties/${encodeURIComponent(id)}`,
  /** Мастер-промпт §30: «Настройки» → Справочники. */
  dictionaries: '/dictionaries',
  dictionaryDetail: '/dictionaries/:code',
  dictionaryDetailTo: (code: string) => `/dictionaries/${encodeURIComponent(code)}`,
  /** Мастер-промпт §25: единый календарь смен (read model, см. FRONTEND_DECISIONS A44+). */
  calendar: '/calendar',
  /**
   * Мастер-промпт §29: администрирование политик. Отдельный маршрут от
   * `/audit` намеренно — промпт требует разделить read-only журнал и
   * role-restricted администрирование, хотя прототип сводит их одним экраном.
   */
  settings: '/settings',
  /**
   * Smart Josparlau §9.15 — печатная форма расстановки: вне AppLayout (сайдбар
   * и шапка на бумагу не попадают), за `ops.security_event.view` — гейт
   * зеркалит право чтения карточки в repository. В NAV_SECTIONS не живёт:
   * печатная форма — не раздел портала, вход — ссылка на карточке ОМ (правило
   * «роут без входа — мёртвый продукт»). Параметр — query, как у формы расхода.
   */
  printPlacement: '/print/placement',
  printPlacementTo: (securityEventId: string) =>
    `/print/placement?security_event_id=${encodeURIComponent(securityEventId)}`,
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
    route: ROUTES.operationsAnalytics,
    label: 'Аналитика мероприятий',
    icon: BarChart3,
    permission: 'ops.analytics.operations',
  },
  {
    route: ROUTES.evaluationWorkspace,
    label: 'Оценивание участников',
    icon: ClipboardCheck,
    permission: 'ops.rating.evaluate',
  },
  {
    route: ROUTES.evaluationRegistry,
    label: 'Итоговые оценки',
    icon: ClipboardList,
    permission: 'ops.rating.view_aggregate',
  },
  {
    route: ROUTES.ratings,
    label: 'Оперативный рейтинг',
    icon: BarChart3,
    permission: 'ops.rating.view_aggregate',
  },
  {
    route: ROUTES.ratingAudit,
    label: 'Журнал оценивания',
    icon: ScrollText,
    permission: 'ops.rating.view_audit',
  },
  {
    route: ROUTES.ratingExport,
    label: 'Выгрузка рейтинга',
    icon: FileText,
    permission: 'ops.rating.export',
  },
  {
    route: ROUTES.ratingAnalytics,
    label: 'Аналитика рейтинга',
    icon: BarChart3,
    permission: 'ops.analytics.view',
  },
  {
    route: ROUTES.serviceReports,
    label: 'Отчёты службы',
    icon: FileText,
    permission: 'ops.report.generate',
  },
  {
    route: ROUTES.audit,
    label: 'Аудит',
    icon: ScrollText,
    permission: 'audit.view',
  },
  {
    route: ROUTES.dictionaries,
    label: 'Справочники',
    icon: BookOpen,
    permission: 'ops.dictionary.view',
  },
  {
    route: ROUTES.calendar,
    label: 'Календарь смен',
    icon: CalendarDays,
    permission: 'ops.calendar.view',
  },
  {
    route: ROUTES.feedback,
    label: 'Обратная связь',
    icon: MessageSquare,
    permission: 'ops.feedback.view',
  },
  {
    route: ROUTES.settings,
    label: 'Настройки',
    icon: Settings2,
    permission: 'ops.settings.view',
  },
]
