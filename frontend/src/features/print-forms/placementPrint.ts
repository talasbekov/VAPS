// Smart Josparlau §9.15 — чистая модель печатной формы расстановки
// (`/print/placement`). Ни React, ни apiClient: тестируется в env node.
//
// ⚠️ РУКОПИСНОЕ ЗЕРКАЛО ТИПОВ — легально и обязано объяснить себя (ARCH-FE-011).
// Источник данных — mock-эндпоинт `/api/ops/security-events/:id/`
// (Smart Josparlau, контракта в `schema.d.ts` у него нет — фича существует
// только во фронтовом demo-срезе). Импортировать типы из
// `features/security-events` НЕЛЬЗЯ: кросс-фичевый импорт красный по
// ARCH-FE-013 (boundaries). Поэтому здесь — узкая ручная поверхность ровно
// тех полей, которые печатаются, плюс тотальный рантайм-разбор: печатать
// `undefined` в документ расстановки недопустимо.
//
// ⚠️ §19.24 «В печатную расстановку не включай: rating, score, комментарии,
// оценщиков, sensitive reasons, документы по оцениванию». Здесь этих полей нет
// ДАЖЕ В МОДЕЛИ — не «не рендерим», а не разбираем вовсе, чтобы поле не могло
// протечь в документ через будущую правку вёрстки. По той же причине НЕ
// разбираются `result`/`comment` постов рекогносцировки: это оценочные пометки
// проверяющего, а не содержание расстановки.
import type { ApiFailure } from '../../shared/api/errors'

/** Заголовок документа. */
export const PLACEMENT_TITLE = 'РАССТАНОВКА СИЛ И СРЕДСТВ'

/**
 * §9.15: «preview не называется официальным документом; mock preview
 * маркируется как demo». Маркер печатается НА БУМАГЕ (не только на экране) —
 * распечатанный лист без него неотличим от официального артефакта.
 */
export const DEMO_MARK_TEXT =
  'ДЕМОНСТРАЦИОННЫЙ ПРЕДПРОСМОТР. Официальный документ расстановки формируется бэкендом (.docx) из утверждённой версии; этот лист — контрольная копия demo-среза и юридической силы не имеет.'

export const PLACEMENT_COLUMN_LABELS = [
  '№',
  'Сектор',
  'Пост',
  'Задача',
  'Требования к назначению',
  'Потребность',
  'Назначен',
  'Ознакомление',
] as const

export const TOTALS_LABEL = 'ИТОГО'

/** Пусто в ячейке — тире, а не пустая клетка: пустая читается как «потеряли». */
export const EMPTY_CELL = '—'

export const NOT_ASSIGNED_TEXT = 'не назначен'

export const ACKNOWLEDGED_TEXT = 'ознакомлен'

export const NOT_ACKNOWLEDGED_TEXT = 'не ознакомлен'

/** Пост, которого нет в рекогносцировке (см. `buildPlacementRows`). */
export const ORPHAN_SECTOR_TEXT = 'вне рекогносцировки'

/**
 * Русские подписи стадий. ДУБЛЬ `STAGE_LABEL`
 * (`features/security-events/lib/stageMeta.ts`) — ОСОЗНАННЫЙ: импорт соседней
 * фичи красный по ARCH-FE-013, а печатать в документ машинный код `PLACEMENT`
 * нельзя. Неизвестный код возвращается ДОСЛОВНО — выдумывать подпись стадии
 * для документа хуже, чем показать сырой код (§35).
 */
const STAGE_LABELS: Record<string, string> = {
  BULLETIN: 'Бюллетень',
  RECON: 'Рекогносцировка',
  DEMAND: 'Потребность',
  FORCES: 'Запрос сил',
  PLACEMENT: 'Расстановка',
  APPROVAL: 'Согласование',
  ACKNOWLEDGEMENT: 'Ознакомление',
  CONDUCT: 'Проведение',
  CLOSED: 'Закрыто',
}

export function stageLabel(code: string): string {
  return STAGE_LABELS[code] ?? code
}

export interface PlacementDocumentPost {
  id: string
  sector: string
  post: string
  task: string
  requirements: string
  need: number
}

export interface PlacementDocumentAssignment {
  postId: string
  employeeName: string
  acknowledgedAt: string | null
}

/** Разобранная шапка+тело документа. */
export interface PlacementDocument {
  code: string
  title: string
  objectName: string
  businessDate: string
  ownerName: string
  stage: string
  posts: PlacementDocumentPost[]
  assignments: PlacementDocumentAssignment[]
  /** Момент снимка данных (§9.15 «документ сохраняет snapshot-данные»). */
  updatedAt: string
}

/** Строка таблицы документа: пост × назначение (см. `buildPlacementRows`). */
export interface PlacementPrintRow {
  sector: string
  post: string
  task: string
  requirements: string
  /** Потребность печатается ОДИН раз на пост — у второй и далее строк `null`. */
  need: number | null
  employeeName: string
  acknowledgement: string
}

export interface PlacementPrintTotals {
  need: number
  assigned: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parsePost(raw: unknown): PlacementDocumentPost | null {
  const record = asRecord(raw)
  if (record === null) return null
  const id = asText(record.id)
  if (id === '') return null
  return {
    id,
    sector: asText(record.sector),
    post: asText(record.post),
    task: asText(record.task),
    requirements: asText(record.requirements),
    need: asCount(record.need),
  }
}

function parseAssignment(raw: unknown): PlacementDocumentAssignment | null {
  const record = asRecord(raw)
  if (record === null) return null
  const postId = asText(record.postId)
  if (postId === '') return null
  return {
    postId,
    employeeName: asText(record.employeeName),
    acknowledgedAt:
      typeof record.acknowledgedAt === 'string' ? record.acknowledgedAt : null,
  }
}

/**
 * `unknown` → документ. `null` означает «тело не разобрать» — это НЕ пустая
 * расстановка: страница обязана различать «постов нет» и «ответ не тот»
 * (иначе испорченный ответ печатается как честный пустой лист).
 */
export function parsePlacementDocument(raw: unknown): PlacementDocument | null {
  const body = asRecord(raw)
  if (body === null) return null
  const id = asText(body.id)
  if (id === '') return null
  const posts = Array.isArray(body.reconSectorPosts)
    ? body.reconSectorPosts
        .map(parsePost)
        .filter((post): post is PlacementDocumentPost => post !== null)
    : []
  const assignments = Array.isArray(body.placementAssignments)
    ? body.placementAssignments
        .map(parseAssignment)
        .filter(
          (assignment): assignment is PlacementDocumentAssignment =>
            assignment !== null,
        )
    : []
  return {
    code: asText(body.code),
    title: asText(body.title),
    objectName: asText(body.objectName),
    businessDate: asText(body.businessDate),
    ownerName: asText(body.ownerName),
    stage: asText(body.stage),
    posts,
    assignments,
    updatedAt: asText(body.updatedAt),
  }
}

function acknowledgementText(assignment: PlacementDocumentAssignment): string {
  return assignment.acknowledgedAt === null
    ? NOT_ACKNOWLEDGED_TEXT
    : ACKNOWLEDGED_TEXT
}

/**
 * Пост × назначения → строки документа.
 *
 * Правила (все три — про «не соврать бумагой»):
 * 1. пост БЕЗ назначений печатается строкой «не назначен» — дырка в расстановке
 *    это факт документа, а не повод пропустить строку;
 * 2. пост с N назначениями даёт N строк, потребность в первой (объединение
 *    ячеек — вёрстка, а данные не теряются при копировании строк);
 * 3. назначение на пост, которого НЕТ в рекогносцировке (пост удалили после
 *    назначения), печатается отдельной строкой в хвосте — молча терять
 *    назначенного человека нельзя, а придумывать ему сектор/задачу — тем более.
 */
export function buildPlacementRows(
  document: PlacementDocument,
): PlacementPrintRow[] {
  const rows: PlacementPrintRow[] = []
  const knownPostIds = new Set(document.posts.map((post) => post.id))

  for (const post of document.posts) {
    const assignments = document.assignments.filter(
      (assignment) => assignment.postId === post.id,
    )
    if (assignments.length === 0) {
      rows.push({
        sector: post.sector,
        post: post.post,
        task: post.task,
        requirements: post.requirements,
        need: post.need,
        employeeName: NOT_ASSIGNED_TEXT,
        acknowledgement: EMPTY_CELL,
      })
      continue
    }
    assignments.forEach((assignment, index) => {
      rows.push({
        sector: post.sector,
        post: post.post,
        task: post.task,
        requirements: post.requirements,
        need: index === 0 ? post.need : null,
        employeeName: assignment.employeeName,
        acknowledgement: acknowledgementText(assignment),
      })
    })
  }

  for (const assignment of document.assignments) {
    if (knownPostIds.has(assignment.postId)) continue
    rows.push({
      sector: ORPHAN_SECTOR_TEXT,
      post: assignment.postId,
      task: EMPTY_CELL,
      requirements: EMPTY_CELL,
      need: null,
      employeeName: assignment.employeeName,
      acknowledgement: acknowledgementText(assignment),
    })
  }

  return rows
}

/**
 * Итоги. `assigned` считается по НАЗНАЧЕНИЯМ (включая «вне рекогносцировки»),
 * `need` — по постам: это два независимых факта, и сводить их к одному числу
 * («укомплектовано X из Y») документ не должен — расхождение видно оператору.
 */
export function placementTotals(
  document: PlacementDocument,
): PlacementPrintTotals {
  return {
    need: document.posts.reduce((sum, post) => sum + post.need, 0),
    assigned: document.assignments.length,
  }
}

/**
 * Точка в конце предложения подвала — только если значение ею НЕ кончается.
 * ФИО в ростере записаны как «Ерланов Д.» — наивная склейка давала «Ерланов Д..»
 * (тот же класс бага, что найден и исправлен в шаблоне journal entry §9.11).
 */
export function sentence(value: string): string {
  const text = value === '' ? EMPTY_CELL : value
  return text.endsWith('.') ? text : `${text}.`
}

export const MISSING_PARAMS_TEXT =
  'Не хватает параметра печати: нужен идентификатор охранного мероприятия (security_event_id).'

export const SCREEN_HINT_TEXT =
  'Экранная подсказка: этот блок на бумагу не выводится. Печать — Ctrl+P; ориентацию (альбомная) выберите в диалоге печати.'

export const LOADING_TEXT = 'Загрузка расстановки…'

/** 200 с телом, которое не разобрать (см. `parsePlacementDocument`). */
export const UNPARSEABLE_TEXT =
  'Ответ сервера не похож на карточку мероприятия — печатать нечего.'

/** Разобрали, но постов нет: расстановки ещё не существует. */
export const NO_POSTS_TEXT =
  'В мероприятии нет постов рекогносцировки — расстановка ещё не формировалась.'

export const PERMISSION_TEXT = 'Мероприятие вне вашей зоны доступа.'

export const NOT_FOUND_TEXT = 'Мероприятие не найдено.'

export type PrintFailureKind = 'permission' | 'not-found' | 'other' | 'silent'

export interface PrintFailureDescription {
  kind: PrintFailureKind
  /** Для `silent` — пустой (страница ничего не рисует). */
  message: string
}

/**
 * Карта отказов. Порядок ветвления — как в `describePrintFailure`
 * (`expensePrint.ts`): `kind === 'network'` ПЕРВЫМ (у `NetworkError` нет
 * `.status` вовсе), затем статусы, в хвосте тотальный catch-all.
 *
 * `401` — `silent`: `providers.tsx` чистит credential и `RequireAuth` уводит на
 * `/login`, текст успел бы только мигнуть. Остальное получает ТЕКСТ (а не
 * молчание): страница читает через `useQuery`, у которого тоста нет, а тост
 * тут и нельзя — он отрендерился бы в портал ВНЕ `.print-root` и покрасил бы
 * DOM-скан печатного канона.
 */
export function describePlacementFailure(
  error: ApiFailure,
): PrintFailureDescription {
  if (error.kind === 'network') {
    return {
      kind: 'other',
      message: `Не удалось загрузить расстановку: ${error.message}`,
    }
  }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 403) return { kind: 'permission', message: PERMISSION_TEXT }
  if (error.status === 404) return { kind: 'not-found', message: NOT_FOUND_TEXT }
  return {
    kind: 'other',
    message: `Не удалось загрузить расстановку: ${error.message}`,
  }
}
