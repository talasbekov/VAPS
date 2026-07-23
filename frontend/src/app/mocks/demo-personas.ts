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
    permissions: ['ops.security_event.view', 'ops.recon.manage'],
    homeRoute: ROUTES.securityEvents,
  },
  {
    id: 'broker',
    userId: 'demo-broker',
    label: 'Брокер сил',
    description: 'Распределяет запросы сил между группами',
    permissions: ['ops.force_request.view', 'ops.force_allocation.manage'],
    homeRoute: ROUTES.home,
  },
  {
    id: 'placement_approver',
    userId: 'demo-placement-approver',
    label: 'Утверждающий расстановку',
    description: 'Согласовывает и утверждает расстановку',
    permissions: ['ops.placement.view', 'ops.placement.approve'],
    homeRoute: ROUTES.home,
  },
  {
    id: 'objects_admin',
    userId: 'demo-objects-admin',
    label: 'Ведение объектов',
    description: 'Паспорта объектов, сектора, посты',
    permissions: ['ops.object.view', 'ops.object.manage', 'ops.passport.publish'],
    // Этап 5 реализовал реестр объектов/паспорт — реальная посадочная
    // страница этой persona (`ops.dashboard.view`, которого у неё нет, home не подходит).
    homeRoute: ROUTES.objects,
  },
  {
    id: 'analyst',
    userId: 'demo-analyst',
    label: 'Аналитик',
    description: 'Дашборды, отчёты, экспорт',
    permissions: ['ops.analytics.view', 'ops.export.run'],
    homeRoute: ROUTES.home,
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
