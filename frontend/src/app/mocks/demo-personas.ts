// Каталог demo-persona (§8.9 «Runtime-only данные»: DemoPersona НЕ продуктовый
// API). Один persona = один dev-credential (X-User-Id) + плоский набор кодов
// прав, которые identity-handlers.ts отдаёт на GET /api/operations/my-permissions/.
// Коды — рабочий план Smart Josparlau (см. docs/frontend/FRONTEND_ROLE_MATRIX.md),
// НЕ выдаются за production-роли (запрет §35).
import { ROUTES } from '../../shared/routes'

export interface DemoPersona {
  id: string
  /** userId dev-credential (`X-User-Id`) — устойчив между reset (не зависит от seed). */
  userId: string
  label: string
  description: string
  permissions: string[]
  /** Куда вести persona сразу после переключения (значение — одна из ROUTES). */
  homeRoute: string
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    id: 'event_planner',
    userId: 'demo-event-planner',
    label: 'Организатор ОМ',
    description: 'Создаёт мероприятия, ведёт бюллетень, штаб',
    permissions: [
      'ops.dashboard.view',
      'ops.security_event.view',
      'ops.security_event.create',
      'ops.bulletin.manage',
      'ops.demand.manage',
      'ops.placement.manage',
      'ops.acknowledgement.manage',
      'ops.conduct.manage',
      'ops.closure.manage',
      'ops.dictionary.view',
      'ops.calendar.view',
      // §28: завести обращение и видеть СВОИ. Права видеть чужие у автора
      // нет — на этом разделении и держится демонстрация §28.
      'ops.feedback.create',
      'ops.feedback.view',
    ],
    // Этап 2 реализовал только реестр/бюллетень ОМ — реальная посадочная
    // страница этой persona, не «/» (там status.view, которого нет ни у одной
    // ops.*-persona).
    homeRoute: ROUTES.securityEvents,
  },
  {
    id: 'recon_officer',
    userId: 'demo-recon-officer',
    label: 'Офицер рекогносцировки',
    description: 'Проводит рекогносцировку назначенных ОМ',
    permissions: [
      'ops.security_event.view',
      'ops.recon.manage',
      'ops.dictionary.view',
      'ops.calendar.view',
    ],
    homeRoute: ROUTES.securityEvents,
  },
  {
    id: 'broker',
    userId: 'demo-broker',
    label: 'Брокер сил',
    description: 'Распределяет запросы сил между группами',
    permissions: ['ops.force_request.view', 'ops.force_allocation.manage', 'ops.dictionary.view'],
    homeRoute: ROUTES.home,
  },
  {
    id: 'placement_approver',
    userId: 'demo-placement-approver',
    label: 'Утверждающий расстановку',
    description: 'Согласовывает и утверждает расстановку',
    permissions: ['ops.placement.view', 'ops.placement.approve', 'ops.dictionary.view'],
    homeRoute: ROUTES.home,
  },
  {
    id: 'objects_admin',
    userId: 'demo-objects-admin',
    label: 'Ведение объектов',
    description: 'Паспорта объектов, сектора, посты, план дежурств, справочники',
    permissions: [
      'ops.object.view',
      'ops.object.manage',
      'ops.passport.publish',
      'ops.duty.view',
      'ops.duty.manage',
      // §21.34 «SOFT_OVERRIDE — возможно с обоснованием и отдельным
      // permission»: обход обязательного отдыха при планировании дежурства.
      // Отдельное право, а не часть ops.duty.manage — иначе «отдельный
      // permission» промпта был бы формальностью.
      'ops.duty.override_rest',
      // §21.27 «Утвердить план». Отдельное право от `ops.duty.manage`: планирует
      // смены и утверждает получившийся месяц — разные роли (тот же принцип, что
      // ops.placement.approve). У этой persona есть оба, чтобы демо-сценарий
      // проходился целиком; разделение проверяется тестами репозитория.
      'ops.duty.approve_plan',
      // §24.5 «уполномоченный согласующий»/«руководитель боевого
      // департамента» — тематически ближайший текущий владелец плана
      // дежурств, тот же принцип, что ops.dictionary.manage (A40).
      'ops.combat_group.review',
      'ops.dictionary.view',
      'ops.dictionary.manage',
      'ops.calendar.view',
      // §29/§21.7: политикой свежести паспортов владеет тот, кто ВЕДЁТ объекты,
      // а не тот, кто настраивает наблюдения аналитики. Отсюда у этой persona
      // есть `manage_passport_policy`, но НЕТ `ops.settings.manage`
      // (наблюдения) и `manage_conflict_rules` — на одном экране «Настроек» ей
      // открыт ровно свой раздел. Зеркально к `analyst`, у которого наоборот.
      'ops.settings.view',
      'ops.settings.manage_passport_policy',
    ],
    // Этап 5 реализовал реестр объектов/паспорт — реальная посадочная
    // страница этой persona (`ops.dashboard.view`, которого у неё нет, home не подходит).
    homeRoute: ROUTES.objects,
  },
  {
    id: 'combat_department_chief',
    userId: 'demo-combat-department-chief',
    label: 'Начальник боевого управления',
    description:
      'Подаёт состав боевой группы на Трассу и ведёт его несение (§24.5-24.6, §24.19-24.23, §24.21)',
    permissions: [
      'ops.duty.view',
      'ops.combat_group.submit',
      // §24.19-24.23 — начальник управления отвечает за ознакомление,
      // заступление и факт несения службы СВОЕГО состава (тот же принцип,
      // что submit: ответственность не передаётся центральному оператору).
      'ops.combat_group.acknowledge',
      'ops.combat_group.checkin',
      'ops.combat_group.complete',
      // §24.21 — замена участника ДО заступления/во время READY, тот же
      // принцип: свой состав, своя ответственность.
      'ops.combat_group.replace',
      'ops.dictionary.view',
    ],
    homeRoute: ROUTES.duties,
  },
  {
    id: 'analyst',
    userId: 'demo-analyst',
    label: 'Аналитик',
    description: 'Дашборды, отчёты, экспорт',
    permissions: [
      'ops.analytics.view',
      // §22.26/§22.12: раскрытие показателя до строк — своё право, отдельное от
      // просмотра дашборда. Персональная детализация
      // (`ops.analytics.personal_detail`) аналитику НЕ выдана: на этом
      // разделении держится демонстрация §22.30 «privacy suppressed» — он видит
      // смены за числом, но не видит, кто именно в них стоял.
      'ops.analytics.drilldown',
      // §22.26: «просмотр аналитики службы» и «просмотр аналитики ОМ» — разные
      // пункты списка прав. Аналитику выданы оба: разделение демонстрируется
      // не на нём, а на persona без аналитики вовсе.
      'ops.analytics.operations',
      'ops.export.run',
      // §22.26: запуск отчёта — своё право, отдельное от просмотра аналитики.
      // Sensitive export (`ops.report.export_sensitive`) аналитику НЕ выдан:
      // на этом разделении держится демонстрация §20.32 «sensitive export —
      // отдельная операция».
      'ops.report.generate',
      'ops.dictionary.view',
      'ops.calendar.view',
      // §20.28 «просмотр другого сотрудника»: контролёру нужен доступ к
      // карточке, иначе журнал раскрытий некуда открыть. Право раскрытия при
      // этом ему НЕ даётся — на нём и держится демонстрация разделения.
      'status.view',
      // §20.33: читать журнал раскрытий ИИН — контрольная функция, и она
      // СОЗНАТЕЛЬНО отделена от права раскрывать (`personnel.identity.reveal`,
      // которого у этой persona нет). Контролёр видит, кто кем интересовался,
      // не получая доступа к самому идентификатору.
      'personnel.identity.audit',
      // §28: аналитик здесь снова в роли КОНТРОЛЁРА — видит чужие обращения
      // (`ops.feedback.view_all`), но не их закрытое содержание
      // (`ops.feedback.view_confidential` ему НЕ выдан). На этом разделении
      // держится демонстрация признака «конфиденциально»: строка видна,
      // содержание — нет. Чужие ЧЕРНОВИКИ не открываются и этим правом.
      'ops.feedback.create',
      'ops.feedback.view',
      'ops.feedback.view_all',
      // §28 detail: разбирать обращения он вправе, а вести ВНУТРЕННИЕ ЗАМЕТКИ
      // (`ops.feedback.internal_note`) — нет. Промпт называет заметку «только
      // по праву», и на этом разделении держится её демонстрация: заметка
      // пишется о человеке, обратившемся за помощью, и право её вести — не то
      // же, что право менять статус.
      'ops.feedback.triage',
      // §29: аналитик владеет МЕТОДИКОЙ СВОИХ наблюдений — блок «Требует
      // внимания» считается по порогам, которые он же и правит. А вот ПРАВИЛА
      // КОНФЛИКТОВ §21.34 ему не подчиняются:
      // `ops.settings.manage_conflict_rules` НЕ выдан, потому что их правка
      // меняет исход ЧУЖОЙ операции — назначение на дежурство либо
      // отвергается, либо требует обоснования. Без такой persona разделение
      // прав по разделам было бы недостижимо: у администратора wildcard, и оба
      // раздела всегда открывались бы с кнопками.
      'ops.settings.view',
      'ops.settings.manage',
      // §22.5: ПРЕДЕЛЫ (глубина произвольного периода, период отчёта, срок
      // хранения файла) аналитику НЕ подчиняются — `manage_analytics_limits` и
      // `manage_reporting_limits` не выданы. Ограничение действует на того, кто
      // им связан: аналитик правит методику своих наблюдений, но не рамки, в
      // которых ему разрешено запрашивать и выгружать. Срок хранения — ещё и
      // окно доступности sensitive-выгрузки.
    ],
    // Этап 7 реализовал реестр аналитики службы — реальная посадочная
    // страница этой persona (`status.view`, которого у неё нет, home не подходит).
    homeRoute: ROUTES.serviceAnalytics,
  },
  {
    id: 'admin',
    userId: 'demo-admin',
    label: 'Администратор (эталон)',
    description: 'Полный доступ — как существующий admin-wildcard',
    permissions: ['*'],
    homeRoute: ROUTES.home,
  },
] as const

export function findDemoPersona(id: string): DemoPersona | undefined {
  return DEMO_PERSONAS.find((p) => p.id === id)
}

export function findDemoPersonaByUserId(userId: string): DemoPersona | undefined {
  return DEMO_PERSONAS.find((p) => p.userId === userId)
}

export const DEFAULT_DEMO_PERSONA_ID = DEMO_PERSONAS[0].id
