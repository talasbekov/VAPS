// Demo-сид охранных мероприятий (§8.7: только синтетические данные — ни ИИН,
// ни реальных объектов/маршрутов). Названия/канва — по духу прототипа
// (Smart Josparlau.dc.html:107-119 «Готовность ОМ», :255 таблица реестра), НЕ
// дословная копия вёрстки (промпт §1.1: прототип — инвентарь, не код-донор).
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import type {
  ReconChecklistItem,
  ReconSectorPost,
  SecurityEvent,
  SecurityEventStage,
  StaffingDemandRow,
} from '../model/types'
import { aggregateForceRequests } from './demandLogic'
import { PERSONNEL_ROSTER } from './personnelRoster'

export interface SecurityEventsSlice {
  events: SecurityEvent[]
}

/** Стандартный шаблон чек-листа рекогносцировки — состав по духу прототипа (hint-placeholder-count=6, точные подписи не заданы шаблоном, домен — предметная область ОМ). */
export const RECON_CHECKLIST_TEMPLATE: readonly string[] = [
  'Периметр и точки доступа',
  'Пути эвакуации',
  'Освещение и видеонаблюдение',
  'Связь и оповещение',
  'Парковка и подъездные пути',
  'Медицинское обеспечение',
]

function buildChecklist(ctx: SeedContext, doneCount: number): ReconChecklistItem[] {
  return RECON_CHECKLIST_TEMPLATE.map((label, index) => ({
    id: ctx.ids.next('recon-checklist-item'),
    label,
    done: index < doneCount,
    result: index < doneCount ? 'MATCHES' : null,
    comment: '',
  }))
}

function buildSectorPosts(
  ctx: SeedContext,
  rows: ReadonlyArray<Omit<ReconSectorPost, 'id'>>,
): ReconSectorPost[] {
  return rows.map((row) => ({ id: ctx.ids.next('recon-sector-post'), ...row }))
}

function buildDemandRows(
  ctx: SeedContext,
  rows: ReadonlyArray<Omit<StaffingDemandRow, 'id'>>,
): StaffingDemandRow[] {
  return rows.map((row) => ({ id: ctx.ids.next('demand-row'), ...row }))
}

const SEED_EVENTS: ReadonlyArray<{
  title: string
  objectName: string
  daysFromStart: number
  stage: SecurityEventStage
  readinessPercent: number
  forceNeed: number
  conflictsCount: number
  ownerName: string
  briefDescription: string
  initialTasks: string
  /** Сколько пунктов чек-листа уже отмечены выполненными (0 = ещё не начата). */
  checklistDone: number
  /** Начальные строки «Посты и секторы» (пусто = ещё не рассчитано). */
  sectorPosts: ReadonlyArray<Omit<ReconSectorPost, 'id'>>
  /** Строки потребности (пусто = этап ещё не начат). */
  demandRows: ReadonlyArray<Omit<StaffingDemandRow, 'id'>>
  demandApproved: boolean
  /** Индексы reconSectorPosts, уже укомплектованные хотя бы одним назначением (round-robin по PERSONNEL_ROSTER). */
  assignedPostIndexes: number[]
}> = [
  {
    title: 'Международный экономический форум',
    objectName: 'Дворец Независимости',
    daysFromStart: 2,
    stage: 'PLACEMENT',
    readinessPercent: 82,
    forceNeed: 64,
    conflictsCount: 2,
    ownerName: 'Ерланов Д.',
    briefDescription:
      'Международный форум с участием иностранных делегаций, три дня, повышенный протокольный уровень.',
    initialTasks:
      'Согласовать периметр с комендатурой объекта, подготовить схему постов, уточнить список аккредитованных лиц.',
    checklistDone: 6,
    sectorPosts: [
      {
        sector: 'A',
        post: 'Главный вход',
        task: 'Досмотр и пропускной режим',
        need: 4,
        requirements: 'Досмотровая подготовка',
        result: 'MATCHES',
        comment: '',
      },
      {
        sector: 'B',
        post: 'Пресс-зона',
        task: 'Контроль аккредитации',
        need: 2,
        requirements: '—',
        result: 'MATCHES',
        comment: '',
      },
    ],
    demandRows: [
      { sector: 'A', task: 'Досмотр и пропускной режим', shift: 'День 08:00–20:00', need: 4, group: 'Группа досмотра', requirements: 'Досмотровая подготовка', comment: '' },
      { sector: 'B', task: 'Контроль аккредитации', shift: 'День 08:00–20:00', need: 2, group: 'Физическая охрана', requirements: '—', comment: '' },
    ],
    demandApproved: true,
    // PLACEMENT в процессе: только первый пост (Главный вход) укомплектован.
    assignedPostIndexes: [0],
  },
  {
    title: 'Официальный визит делегации',
    objectName: 'Резиденция',
    daysFromStart: 3,
    stage: 'DEMAND',
    readinessPercent: 61,
    forceNeed: 22,
    conflictsCount: 0,
    ownerName: 'Ерланов Д.',
    briefDescription: 'Однодневный визит иностранной делегации в резиденцию.',
    initialTasks: 'Рассчитать потребность в силах по направлениям, запросить резерв.',
    checklistDone: 6,
    sectorPosts: [
      {
        sector: 'A',
        post: 'Парадный подъезд',
        task: 'Встреча и сопровождение',
        need: 3,
        requirements: 'Протокольная подготовка',
        result: 'MATCHES',
        comment: '',
      },
    ],
    demandRows: [
      { sector: 'A', task: 'Встреча и сопровождение', shift: 'День 09:00–18:00', need: 3, group: 'Управление ОМ', requirements: 'Протокольная подготовка', comment: '' },
    ],
    demandApproved: false,
    assignedPostIndexes: [],
  },
  {
    title: 'Городской спортивный форум',
    objectName: 'Астана Арена',
    daysFromStart: 5,
    stage: 'APPROVAL',
    readinessPercent: 94,
    forceNeed: 118,
    conflictsCount: 0,
    ownerName: 'Нуртаев Е.',
    briefDescription: 'Городской спортивный форум с массовым посещением.',
    initialTasks: 'Согласовать расстановку с руководителем управления до 20 июля.',
    checklistDone: 6,
    sectorPosts: [
      {
        sector: 'A',
        post: 'Сектор трибун 1-4',
        task: 'Досмотр зрителей',
        need: 12,
        requirements: 'Досмотровая подготовка',
        result: 'MATCHES',
        comment: '',
      },
    ],
    demandRows: [
      { sector: 'A', task: 'Досмотр зрителей', shift: 'День 10:00–23:00', need: 12, group: 'Группа досмотра', requirements: 'Досмотровая подготовка', comment: '' },
    ],
    demandApproved: true,
    // APPROVAL: пост считается укомплектованным по упрощённому правилу Этапа 2
    // («хотя бы одно назначение», не точное совпадение с need — FRONTEND_DECISIONS).
    assignedPostIndexes: [0],
  },
  {
    title: 'Рабочее совещание акимата',
    objectName: 'Дом Министерств',
    daysFromStart: 1,
    stage: 'BULLETIN',
    readinessPercent: 12,
    forceNeed: 0,
    conflictsCount: 0,
    ownerName: 'Нуртаев Е.',
    briefDescription: '',
    initialTasks: '',
    checklistDone: 0,
    sectorPosts: [],
    demandRows: [],
    demandApproved: false,
    assignedPostIndexes: [],
  },
  {
    title: 'Культурный форум приграничных регионов',
    objectName: 'Дворец Мира и Согласия',
    daysFromStart: 9,
    stage: 'RECON',
    readinessPercent: 28,
    forceNeed: 0,
    conflictsCount: 0,
    ownerName: 'Ерланов Д.',
    briefDescription: 'Культурный форум приграничных регионов, ожидается иностранное участие.',
    initialTasks: 'Провести рекогносцировку объекта, уточнить зоны и посты.',
    checklistDone: 2,
    sectorPosts: [
      {
        sector: 'A',
        post: 'Главный вход',
        task: 'Досмотр',
        need: 2,
        requirements: 'Досмотровая подготовка',
        result: null,
        comment: '',
      },
    ],
    demandRows: [],
    demandApproved: false,
    assignedPostIndexes: [],
  },
]

export function buildSecurityEventsSeed(ctx: SeedContext): {
  sliceName: string
  data: SecurityEventsSlice
} {
  const now = ctx.clock.now()
  const events: SecurityEvent[] = SEED_EVENTS.map((seed) => {
    const businessDate = new Date(
      new Date(ctx.clock.now()).getTime() +
        seed.daysFromStart * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10)
    const id = ctx.ids.next('security-event')
    const demandRows = buildDemandRows(ctx, seed.demandRows)
    const sectorPosts = buildSectorPosts(ctx, seed.sectorPosts)
    const placementAssignments = seed.assignedPostIndexes.map((postIndex, i) => {
      const post = sectorPosts[postIndex]
      const employee = PERSONNEL_ROSTER[i % PERSONNEL_ROSTER.length]
      return {
        id: ctx.ids.next('placement-assignment'),
        postId: post.id,
        employeeId: employee.id,
        employeeName: employee.name,
        acknowledgedAt: null,
      }
    })
    return {
      id,
      code: `ОМ-${businessDate.slice(0, 4)}-${id.split('-').pop()}`,
      title: seed.title,
      objectName: seed.objectName,
      businessDate,
      stage: seed.stage,
      readinessPercent: seed.readinessPercent,
      forceNeed: seed.forceNeed,
      conflictsCount: seed.conflictsCount,
      ownerName: seed.ownerName,
      briefDescription: seed.briefDescription,
      initialTasks: seed.initialTasks,
      reconChecklist: buildChecklist(ctx, seed.checklistDone),
      reconSectorPosts: sectorPosts,
      demandRows,
      demandApproved: seed.demandApproved,
      forceRequests: seed.demandApproved
        ? aggregateForceRequests(
            demandRows,
            (_group, index) => `force-request-${id}-${index}`,
          ).map((request) => ({
            ...request,
            // Прошедшие FORCES стадии (PLACEMENT/APPROVAL) — уже полностью
            // выделены; DEMAND-стадия ниже не попадает сюда (approved:false).
            allocatedCount: request.requestedCount,
            status: 'ALLOCATED' as const,
          }))
        : [],
      placementAssignments,
      approvalStatus: 'PENDING' as const,
      approvalComment: '',
      journalEntries: [],
      closureDirectionSummaries: [],
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    }
  })
  return { sliceName: 'security-events', data: { events } }
}
