// Smart Josparlau «Архив дела» (прототип Smart Josparlau.dc.html:1459-1490,
// мастер-промпт L5643 «архив открывается только в read-only режиме») — чистая
// модель. Ни React, ни apiClient: тестируется в env node.
//
// Модель ОМ импортируется из своей же фичи (`../model/types`) — в отличие от
// печатной формы (`features/print-forms/placementPrint.ts`), которой пришлось
// держать рукописное зеркало типов: там кросс-фичевый импорт красный по
// ARCH-FE-013, здесь мы ВНУТРИ владельца данных.
//
// Архив ничего не мутирует и не досчитывает: он раскладывает уже накопленные
// стадиями факты. Всё, чего в модели нет (оценки участников, версии
// расстановки), сообщается ТЕКСТОМ причины, а не пустым числом (§35).
import type { JournalEntry, SecurityEvent } from '../model/types'

export const ARCHIVE_TITLE = 'Архив дела'

export const READ_ONLY_BADGE = 'read-only'

/**
 * Дело открывается ТОЛЬКО после закрытия (мастер-промпт L3952: «архивирование
 * возможно только после успешного закрытия»). До закрытия — не пустой архив,
 * а отказ с причиной: пустая страница читалась бы как «данные потеряли».
 */
export function isArchiveOpen(event: SecurityEvent): boolean {
  return event.stage === 'CLOSED'
}

export const NOT_CLOSED_TEXT =
  'Дело откроется после закрытия мероприятия — до этого момента работа идёт в карточке ОМ.'

/** Пост, назначение на который осталось без поста рекогносцировки. */
export const ORPHAN_POST_TEXT = 'Пост удалён из расчёта'

export const NOT_ASSIGNED_TEXT = 'не назначен'
export const ACKNOWLEDGED_TEXT = 'ознакомлен'
export const NOT_ACKNOWLEDGED_TEXT = 'не ознакомлен'

export interface ArchiveAssignee {
  id: string
  name: string
  acknowledged: boolean
}

/** Пост × назначенные на него люди на момент закрытия. */
export interface ArchivePostGroup {
  postId: string
  sector: string
  post: string
  task: string
  /** Потребность поста; `null` у осиротевшей группы — придумывать её нельзя. */
  need: number | null
  assignees: ArchiveAssignee[]
  isOrphan: boolean
}

export type ArchiveSectionKey =
  | 'bulletin'
  | 'recon'
  | 'demand'
  | 'placement'
  | 'replacements'
  | 'journal'
  | 'closure'
  | 'ratings'

export interface ArchiveSectionSummary {
  key: ArchiveSectionKey
  title: string
  /** Единиц содержимого. `null` — раздела в demo-срезе нет вовсе (не «ноль»). */
  count: number | null
  /** Что стоит за числом, а при нуле/`null` — почему пусто. */
  note: string
}

export interface ArchiveCase {
  closedAt: string | null
  postGroups: ArchivePostGroup[]
  /** Замены состава (§9.11) — отдельный раздел прототипа «Изменения и замены». */
  replacements: JournalEntry[]
  /** Остальной журнал штаба: инструктаж, указания, инциденты. */
  journal: JournalEntry[]
  /**
   * Направления, по которым итога закрытия НЕТ, хотя пост такого сектора в
   * расчёте был. Закрытие требует итоги всех направлений (Epic 18.1 FR-30),
   * но дело читают годы спустя — расхождение показываем, а не заглаживаем.
   */
  missingClosureDirections: string[]
  sections: ArchiveSectionSummary[]
}

function assignee(
  id: string,
  name: string,
  acknowledgedAt: string | null,
): ArchiveAssignee {
  return { id, name, acknowledged: acknowledgedAt !== null }
}

/**
 * Посты × назначения. Правило то же, что в печатной форме
 * (`buildPlacementRows`): пост без людей остаётся строкой дела, а назначение на
 * исчезнувший пост уходит в хвост отдельной группой — молча терять назначенного
 * человека в архиве нельзя, а придумывать ему сектор/задачу — тем более.
 */
export function buildPostGroups(event: SecurityEvent): ArchivePostGroup[] {
  const groups: ArchivePostGroup[] = event.reconSectorPosts.map((post) => ({
    postId: post.id,
    sector: post.sector,
    post: post.post,
    task: post.task,
    need: post.need,
    assignees: event.placementAssignments
      .filter((a) => a.postId === post.id)
      .map((a) => assignee(a.id, a.employeeName, a.acknowledgedAt)),
    isOrphan: false,
  }))

  const knownPostIds = new Set(event.reconSectorPosts.map((post) => post.id))
  const orphans = event.placementAssignments.filter(
    (a) => !knownPostIds.has(a.postId),
  )
  if (orphans.length > 0) {
    groups.push({
      postId: '',
      sector: ORPHAN_POST_TEXT,
      post: ORPHAN_POST_TEXT,
      task: '',
      need: null,
      assignees: orphans.map((a) =>
        assignee(a.id, a.employeeName, a.acknowledgedAt),
      ),
      isOrphan: true,
    })
  }
  return groups
}

export function buildArchiveCase(event: SecurityEvent): ArchiveCase {
  const postGroups = buildPostGroups(event)
  // Каждая запись журнала попадает РОВНО в один из двух списков: замены —
  // отдельный раздел прототипа, остальное — журнал штаба.
  const replacements = event.journalEntries.filter(
    (entry) => entry.type === 'REPLACEMENT',
  )
  const journal = event.journalEntries.filter(
    (entry) => entry.type !== 'REPLACEMENT',
  )

  const summarised = new Set(
    event.closureDirectionSummaries.map((item) => item.direction),
  )
  const missingClosureDirections = Array.from(
    new Set(event.reconSectorPosts.map((post) => post.sector)),
  ).filter((sector) => sector.trim() !== '' && !summarised.has(sector))

  const checklistDone = event.reconChecklist.filter((item) => item.done).length
  const assignedCount = event.placementAssignments.length
  const needTotal = event.reconSectorPosts.reduce(
    (sum, post) => sum + post.need,
    0,
  )
  const allocated = event.forceRequests.reduce(
    (sum, request) => sum + request.allocatedCount,
    0,
  )

  const sections: ArchiveSectionSummary[] = [
    {
      key: 'bulletin',
      title: 'Карточка, бюллетень, задачи',
      count: null,
      note:
        event.briefDescription.trim() === '' && event.initialTasks.trim() === ''
          ? 'Бюллетень не заполнялся до закрытия'
          : 'Описание и первичные задачи направлениям на момент закрытия',
    },
    {
      key: 'recon',
      title: 'Рекогносцировка',
      count: event.reconSectorPosts.length,
      note:
        event.reconSectorPosts.length === 0
          ? 'Посты и секторы не рассчитывались'
          : `Чек-лист ${checklistDone} из ${event.reconChecklist.length}, постов ${event.reconSectorPosts.length}`,
    },
    {
      key: 'demand',
      title: 'Расчёты и заявки',
      count: event.demandRows.length,
      note:
        event.demandRows.length === 0
          ? 'Потребность не рассчитывалась'
          : `Запросов группам ${event.forceRequests.length}, выделено ${allocated}`,
    },
    {
      key: 'placement',
      title: 'Расстановка на момент закрытия',
      count: assignedCount,
      note:
        assignedCount === 0
          ? 'Назначений не было'
          : `Потребность ${needTotal}, назначено ${assignedCount}`,
    },
    {
      key: 'replacements',
      title: 'Изменения и замены',
      count: replacements.length,
      note:
        replacements.length === 0
          ? 'Замен состава не было'
          : 'Замены выбывших сотрудников (§9.11)',
    },
    {
      key: 'journal',
      title: 'Журнал штаба, инциденты',
      count: journal.length,
      note:
        journal.length === 0
          ? 'Записей журнала не было'
          : 'Инструктаж, указания, инциденты',
    },
    {
      key: 'closure',
      title: 'Итоги закрытия',
      count: event.closureDirectionSummaries.length,
      note:
        missingClosureDirections.length > 0
          ? `Без итога остались направления: ${missingClosureDirections.join(', ')}`
          : 'Итоги по всем направлениям расчёта',
    },
    {
      key: 'ratings',
      title: 'Оценки участников',
      // Ни числа, ни нуля: раздела в demo-срезе НЕ существует, а «0 оценок»
      // читалось бы как «оценивали и никого не оценили» (§35, D3/A24).
      count: null,
      note: 'Скрытые оценки участников (D3) в demo-срезе не реализованы — цифр здесь нет и быть не может',
    },
  ]

  return {
    closedAt: event.closedAt,
    postGroups,
    replacements,
    journal,
    missingClosureDirections,
    sections,
  }
}

/**
 * Версии расстановки (карточка прототипа «Все версии расстановки»): модель
 * demo-среза хранит ОДНУ действующую расстановку, `placementVersionId` из
 * мастер-промпта (L5647) в ней нет. Честный текст вместо списка из одной
 * выдуманной «версии 1».
 */
export const NO_PLACEMENT_VERSIONS_TEXT =
  'История версий расстановки не ведётся в demo-срезе: сохраняется одно действующее распределение, показанное выше.'
