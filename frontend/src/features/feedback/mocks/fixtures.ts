// Demo-сид обратной связи (§8.7: только синтетические данные).
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import type { FeedbackRegistry, FeedbackRequest } from '../model/types'

export interface FeedbackSlice {
  requests: FeedbackRequest[]
  registry: FeedbackRegistry
}

/**
 * Справочник §28 целиком: типы, приоритеты, статусы, модули.
 *
 * Подписи живут ЗДЕСЬ, а не в компоненте: экран, который сам знает, что
 * `WRONG_DATA` — это «Неверные данные», перестаёт зависеть от справочника, и
 * добавление типа на сервере ничего в нём не меняет. Порядок тоже отсюда —
 * сводка по статусам обязана быть стабильной.
 */
export const FEEDBACK_REGISTRY: FeedbackRegistry = {
  types: [
    { code: 'BUG', label: 'Ошибка' },
    { code: 'WRONG_DATA', label: 'Неверные данные' },
    { code: 'UX', label: 'UX' },
    { code: 'IDEA', label: 'Идея' },
    { code: 'ACCESS', label: 'Доступ' },
    { code: 'HELP', label: 'Помощь' },
  ],
  priorities: [
    { code: 'LOW', label: 'Низкий' },
    { code: 'NORMAL', label: 'Обычный' },
    { code: 'HIGH', label: 'Высокий' },
    { code: 'CRITICAL', label: 'Критический' },
  ],
  statuses: [
    { code: 'DRAFT', label: 'Черновик' },
    { code: 'NEW', label: 'Новое' },
    { code: 'IN_REVIEW', label: 'На рассмотрении' },
    { code: 'NEED_INFO', label: 'Нужна информация' },
    { code: 'ACCEPTED', label: 'Принято в работу' },
    { code: 'PLANNED', label: 'Запланировано' },
    { code: 'FIXED', label: 'Исправлено' },
    { code: 'RELEASED', label: 'Реализовано' },
    { code: 'REJECTED', label: 'Отклонено' },
    { code: 'CLOSED', label: 'Закрыто' },
    { code: 'DUPLICATE', label: 'Дубликат' },
  ],
  // Модули — разделы, которые в портале РЕАЛЬНО существуют. Выдуманный модуль
  // в списке выбора обещал бы раздел, которого нет.
  modules: [
    { moduleCode: 'SECURITY_EVENTS', label: 'Реестр ОМ' },
    { moduleCode: 'DUTIES', label: 'План дежурств' },
    { moduleCode: 'OBJECTS', label: 'Объекты и паспорта' },
    { moduleCode: 'ANALYTICS', label: 'Аналитика службы' },
    { moduleCode: 'PERSONNEL', label: 'Личный состав' },
    { moduleCode: 'OTHER', label: 'Другое' },
  ],
  registryVersion: 'feedback-registry-2026.07.1',
}

const PLANNER = { userId: 'demo-event-planner', safeLabel: 'Организатор ОМ' }
const ANALYST = { userId: 'demo-analyst', safeLabel: 'Аналитик' }
const OBJECTS_ADMIN = { userId: 'demo-objects-admin', safeLabel: 'Ведение объектов' }

/**
 * Сеяные обращения. Их девять, и это НЕ округление до красивого числа:
 * страница реестра — четыре строки (`FEEDBACK_PAGE_SIZE`), и девять дают
 * ТРИ страницы, из которых последняя неполная. Две страницы не отличили бы
 * «последняя страница» от «страница с остатком».
 *
 * Среди них намеренно есть:
 * — чужой ЧЕРНОВИК (`fb-draft-foreign`) — его не должен видеть никто, кроме
 *   автора, даже обладатель права видеть все обращения;
 * — чужое КОНФИДЕНЦИАЛЬНОЕ (`fb-confidential`) с уникальным словом в описании,
 *   которого нет в теме, — на нём проверяется, что поиск не находит по
 *   вырезанному содержанию;
 * — обращение с согласием на техническую информацию и обращение без него.
 */
function seedRequests(ctx: SeedContext): FeedbackRequest[] {
  // Отсчёт назад от сценарного времени — СВОИМИ часами того же канона, а не
  // `new Date()`: смещение канона (+05:00) обязано сохраниться, иначе даты
  // сеяных обращений съедут на сутки в минусовых таймзонах (§8.8).
  const at = (offsetMinutes: number): string => {
    const shifted = new DemoClock(ctx.clock.now())
    shifted.advanceMs(-offsetMinutes * 60_000)
    return shifted.now()
  }
  return [
    {
      feedbackId: 'fb-1001',
      subject: 'Не открывается карточка мероприятия по прямой ссылке',
      description:
        'При переходе по ссылке из уведомления карточка мероприятия показывает пустой экран, приходится открывать реестр и искать мероприятие заново.',
      typeCode: 'BUG',
      priorityCode: 'HIGH',
      statusCode: 'IN_REVIEW',
      moduleCode: 'SECURITY_EVENTS',
      expectedResult: 'Карточка открывается сразу по ссылке.',
      reproductionSteps: '1. Открыть уведомление. 2. Нажать ссылку. 3. Увидеть пустой экран.',
      attachments: [{ fileName: 'ekran.png', sizeBytes: 184_320, mimeType: 'image/png' }],
      contact: 'вн. 12-45',
      confidential: false,
      relatedRoute: '/security-events',
      technicalInfo: {
        appRevision: 'demo-2026.07',
        viewport: '1440×900',
        platform: 'desktop',
        capturedAt: at(600),
      },
      author: PLANNER,
      createdAt: at(600),
      submittedAt: at(600),
      updatedAt: at(600),
    },
    {
      feedbackId: 'fb-1002',
      subject: 'В плане дежурств путается подпись состояния',
      description:
        'Две соседние колонки подписаны похоже, из-за этого приходится сверяться с легендой на каждой строке.',
      typeCode: 'UX',
      priorityCode: 'NORMAL',
      statusCode: 'ACCEPTED',
      moduleCode: 'DUTIES',
      expectedResult: 'Подписи колонок различаются с первого взгляда.',
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: '/duties',
      technicalInfo: null,
      author: OBJECTS_ADMIN,
      createdAt: at(540),
      submittedAt: at(540),
      updatedAt: at(540),
    },
    {
      feedbackId: 'fb-confidential',
      subject: 'Обращение по доступу',
      // Слово «журавль» в теме НЕ встречается — на нём и проверяется область
      // поиска: по вырезанному описанию находиться не должно.
      description:
        'Прошу разобраться с доступом: журавль в списке подразделений отображается не тому сотруднику, что нарушает разграничение.',
      typeCode: 'ACCESS',
      priorityCode: 'CRITICAL',
      statusCode: 'NEW',
      moduleCode: 'PERSONNEL',
      expectedResult: 'Доступ ограничен своим подразделением.',
      reproductionSteps: 'Открыть список подразделений под учётной записью без права.',
      attachments: [{ fileName: 'vypiska.pdf', sizeBytes: 51_200, mimeType: 'application/pdf' }],
      contact: 'личный приём',
      confidential: true,
      relatedRoute: '/organization',
      technicalInfo: null,
      // Автор — НЕ аналитик, и это условие демонстрации: аналитик здесь
      // контролёр (видит чужие обращения, закрытое содержание — нет). Будь он
      // автором, признак «конфиденциально» на нём было бы не показать вовсе.
      author: OBJECTS_ADMIN,
      createdAt: at(480),
      submittedAt: at(480),
      updatedAt: at(480),
    },
    {
      feedbackId: 'fb-draft-foreign',
      subject: 'Черновик обращения аналитика',
      description: 'Не дописано: нужно приложить пример выгрузки.',
      typeCode: 'IDEA',
      priorityCode: 'LOW',
      statusCode: 'DRAFT',
      moduleCode: 'ANALYTICS',
      expectedResult: null,
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: '/analytics/service',
      technicalInfo: null,
      author: ANALYST,
      createdAt: at(420),
      submittedAt: null,
      updatedAt: at(420),
    },
    {
      feedbackId: 'fb-1005',
      subject: 'Добавить фильтр по объекту в аналитику',
      description: 'Сейчас приходится выгружать отчёт целиком, чтобы посмотреть один объект.',
      typeCode: 'IDEA',
      priorityCode: 'NORMAL',
      statusCode: 'PLANNED',
      moduleCode: 'ANALYTICS',
      expectedResult: 'Фильтр по объекту на экране аналитики.',
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: '/analytics/service',
      technicalInfo: null,
      author: ANALYST,
      createdAt: at(360),
      submittedAt: at(360),
      updatedAt: at(360),
    },
    {
      feedbackId: 'fb-1006',
      subject: 'Неверный пост в снимке паспорта',
      description: 'В снимке паспорта объекта пост назван старым именем, хотя версия уже новая.',
      typeCode: 'WRONG_DATA',
      priorityCode: 'HIGH',
      statusCode: 'FIXED',
      moduleCode: 'OBJECTS',
      expectedResult: 'Снимок содержит имя поста действующей версии.',
      reproductionSteps: 'Открыть дежурство, привязанное к версии 1.',
      attachments: [],
      contact: 'вн. 12-45',
      confidential: false,
      relatedRoute: '/objects',
      technicalInfo: null,
      author: PLANNER,
      createdAt: at(300),
      submittedAt: at(300),
      updatedAt: at(300),
    },
    {
      feedbackId: 'fb-1007',
      subject: 'Как отменить смену без удаления',
      description: 'Не нашёл, где отменить смену так, чтобы она осталась в плане.',
      typeCode: 'HELP',
      priorityCode: 'LOW',
      statusCode: 'CLOSED',
      moduleCode: 'DUTIES',
      expectedResult: null,
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: '/duties',
      technicalInfo: null,
      author: OBJECTS_ADMIN,
      createdAt: at(240),
      submittedAt: at(240),
      updatedAt: at(240),
    },
    {
      feedbackId: 'fb-1008',
      subject: 'Повтор обращения про карточку мероприятия',
      description: 'То же, что уже сообщали: карточка не открывается по прямой ссылке.',
      typeCode: 'BUG',
      priorityCode: 'NORMAL',
      statusCode: 'DUPLICATE',
      moduleCode: 'SECURITY_EVENTS',
      expectedResult: null,
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: '/security-events',
      technicalInfo: null,
      author: OBJECTS_ADMIN,
      createdAt: at(180),
      submittedAt: at(180),
      updatedAt: at(180),
    },
    {
      feedbackId: 'fb-1009',
      subject: 'Просьба вернуть сортировку по дате',
      description: 'После обновления список стал сортироваться иначе, привычный порядок пропал.',
      typeCode: 'UX',
      priorityCode: 'NORMAL',
      statusCode: 'REJECTED',
      moduleCode: 'OTHER',
      expectedResult: null,
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: null,
      technicalInfo: null,
      author: PLANNER,
      createdAt: at(120),
      submittedAt: at(120),
      updatedAt: at(120),
    },
  ]
}

export function buildFeedbackSeed(ctx: SeedContext): {
  sliceName: string
  data: FeedbackSlice
} {
  return {
    sliceName: 'feedback',
    data: {
      requests: seedRequests(ctx),
      registry: {
        ...FEEDBACK_REGISTRY,
        types: [...FEEDBACK_REGISTRY.types],
        priorities: [...FEEDBACK_REGISTRY.priorities],
        statuses: [...FEEDBACK_REGISTRY.statuses],
        modules: [...FEEDBACK_REGISTRY.modules],
      },
    },
  }
}
