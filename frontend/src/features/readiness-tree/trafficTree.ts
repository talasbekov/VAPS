// Story 10.4 — типы и чистые функции светофор-дерева (Task 6).
// Типы — ТОЛЬКО из регенерированного schema.d.ts (ARCH-FE-011), ручных дублей
// контракта нет; функции чистые (зеркало dayState.ts 10.3) — страница рендерит
// готовую вью-модель. Фича readiness-tree — СВОЯ директория: ESLint boundaries
// банит features→features, из daily-grid ничего не импортируется (урок 10.3).
import type { components, paths } from '../../shared/api/schema'

export type TrafficTreeResponse =
  paths['/api/operations/daily-submissions/traffic-tree/']['get']['responses']['200']['content']['application/json']

export type TrafficTreeNode = components['schemas']['TrafficTreeNode']

/**
 * Интервал polling-обновления дерева (Д4: контракт Q4 не подписан — 60с,
 * константа в ОДНОМ месте; меняется здесь и только здесь).
 */
export const REFRESH_INTERVAL_MS = 60_000

/** Узел вью-модели: серверный узел + непосредственные дети (порядок ответа). */
export interface TreeVM {
  node: TrafficTreeNode
  children: TreeVM[]
}

/**
 * Лес из плоского parent_id-списка (Д1 контракта 10-01). Корни = parent_id
 * null; дети — в порядке ответа (сервер сортирует (name, division_id)).
 * Defensive: сирота (parent_id вне ответа — гонка справочника между
 * подсборкой имён и снапшотом прав) поднимается в корни, не теряется.
 */
export function buildForest(nodes: TrafficTreeNode[]): TreeVM[] {
  const byId = new Map<string, TreeVM>()
  for (const node of nodes) byId.set(node.division_id, { node, children: [] })
  const roots: TreeVM[] = []
  for (const node of nodes) {
    const vm = byId.get(node.division_id)
    if (vm === undefined) continue
    const parent =
      node.parent_id === null ? undefined : byId.get(node.parent_id)
    if (parent === undefined) roots.push(vm)
    else parent.children.push(vm)
  }
  return roots
}

/** Текст-статус и семантика узла: цвет НИКОГДА не единственный сигнал (AC-8). */
export interface StatusMeta {
  /** Человекочитаемый статус (5 значений каскада 5.5b). */
  label: string
  /** Tailwind-класс цветового маркера. */
  markerClass: string
  /** «Отстающий» для фильтра AC-10: RED/YELLOW/UNKNOWN (и незнакомые строки). */
  laggard: boolean
}

const STATUS_META: Record<string, StatusMeta> = {
  GREEN: {
    label: 'сдано и сходится',
    markerClass: 'bg-green-500',
    laggard: false,
  },
  YELLOW: {
    label: 'расход разошёлся',
    markerClass: 'bg-yellow-400',
    laggard: true,
  },
  RED: { label: 'не сдано', markerClass: 'bg-red-500', laggard: true },
  // Q5 (Д): NEUTRAL — серый маркер + «нет данных»; визуал, не семантика.
  NEUTRAL: { label: 'нет данных', markerClass: 'bg-gray-300', laggard: false },
  UNKNOWN: {
    label: 'неопределён',
    markerClass: 'bg-purple-500',
    laggard: true,
  },
}

/**
 * Метаданные статуса; defensive к незнакомой строке (дрейф контракта):
 * трактуется как UNKNOWN — «не знаю» честнее «всё ок» (precedence 5.5b).
 */
export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? STATUS_META.UNKNOWN
}

/**
 * Фильтр «только отстающие» (AC-10): узлы с каскадным статусом GREEN/NEUTRAL
 * скрываются ЦЕЛИКОМ (каскад worst-colour: зелёный узел = зелёное поддерево);
 * RED/YELLOW/UNKNOWN остаются, их дети фильтруются рекурсивно.
 */
export function laggardsOnly(forest: TreeVM[]): TreeVM[] {
  const result: TreeVM[] = []
  for (const tree of forest) {
    if (!statusMeta(tree.node.status).laggard) continue
    result.push({ node: tree.node, children: laggardsOnly(tree.children) })
  }
  return result
}
