// Story 10.4 — чистая модель дерева светофора: разбор ответа, иерархия,
// свёртка, фильтр. Ни React, ни apiClient — тестируется в env node.
//
// ЕДИНСТВЕННЫЙ источник семантики цветов:
//   Backend/VAPS/apps/operations/submissions/traffic_light.py:53-71
//     TrafficLightStatus — GREEN | YELLOW | RED | NEUTRAL | UNKNOWN
//   :181-214  _PRECEDENCE / _worst — NEUTRAL(0) < GREEN(1) < YELLOW(2)
//             < RED(3) < UNKNOWN(4); пустой вход → NEUTRAL
//   :190-201  CascadeTrafficLight — узел каскада несёт РОВНО status + late
//             (drift здесь отсутствует by design, «cascade carries only colour»)
//   :321,326  visited-множество против цикла в parent (анти-цикл-констрейнта
//             на core_divisions нет — клиент обязан защищаться так же)
//
// ⚠️ Тип узла — из схемы (ARCH-FE-011: рукописные типы при наличии схемы =
// MUST NOT). 10.3a приехала с @extend_schema, поэтому `tsc` здесь работает
// контракт-тестом: расхождение бэка с этим файлом краснит гейт.
//
// Защитный разбор нужен ПОМИМО типов: openapi-typescript даёт гарантию времени
// компиляции, а не рантайма. По проводу может приехать что угодно — экран
// наблюдения не имеет права падать (AC-9).
import type { components } from '../../shared/api/schema'

/** Узел ответа роута 10.3a — дословно `TrafficLightNode` схемы. */
export type TrafficLightNode = components['schemas']['TrafficLightNode']

/** Пять значений `TrafficLightStatus`; NEUTRAL/UNKNOWN рождаются в свёртке. */
export type TrafficLightStatus = components['schemas']['TrafficLightNodeStatusEnum']

/**
 * Порядок — для перебора в тестах и рендере легенды; сам список обязан
 * совпадать с enum схемы. Расхождение ловит `satisfies` ниже: лишнее или
 * недостающее значение не скомпилируется.
 */
export const TRAFFIC_LIGHT_STATUSES = [
  'GREEN',
  'YELLOW',
  'RED',
  'NEUTRAL',
  'UNKNOWN',
] as const satisfies readonly TrafficLightStatus[]

/**
 * Текст-метки состояний (AC-3). Цвет НИКОГДА не единственный сигнал
 * (EXPERIENCE.md#L238) — метка рендерится рядом с маркером всегда.
 *
 * Шесть новых строк вне канон-регистра EXPERIENCE.md — открытый вопрос №1
 * стори к подписи; правка после подписи локализована здесь.
 */
export const STATUS_LABEL: Record<TrafficLightStatus, string> = {
  GREEN: 'сдано',
  YELLOW: 'сдано, расход разошёлся',
  RED: 'не сдано',
  NEUTRAL: 'нет данных',
  UNKNOWN: 'неопределён',
}

/** Метка опоздания — отдельный видимый сигнал, не оттенок цвета (AC-3). */
export const LATE_LABEL = 'с опозданием'

/** Узел дерева: узел ответа + собранные дети. Плоский список нормализован. */
export interface TrafficLightTreeNode extends TrafficLightNode {
  children: TrafficLightTreeNode[]
}

const STATUS_SET: ReadonlySet<string> = new Set(TRAFFIC_LIGHT_STATUSES)

/** Precedence — зеркало `_PRECEDENCE` (traffic_light.py:181-187). */
const PRECEDENCE: Record<TrafficLightStatus, number> = {
  NEUTRAL: 0,
  GREEN: 1,
  YELLOW: 2,
  RED: 3,
  UNKNOWN: 4,
}

/** Отстающие для фильтра (AC-6). NEUTRAL — «нечего сдавать», не отставание. */
const LAGGING: ReadonlySet<TrafficLightStatus> = new Set<TrafficLightStatus>([
  'RED',
  'YELLOW',
  'UNKNOWN',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Разбор ответа роута: конверт `{business_date, nodes[]}` → плоский список.
 *
 * Тотальный: любой не-конверт и любой не-массив `nodes` → `[]`; узел без
 * пригодного `division_id` отбрасывается (без него его нечем адресовать ни в
 * `expanded`, ни в `parent_id` детей); неизвестная строка `status` → UNKNOWN
 * — НЕ throw и НЕ «GREEN по умолчанию»: «не знаю» честнее, чем «всё ок»
 * (мотив тот же, что у UNKNOWN на вершине precedence).
 */
export function parseTrafficLightTree(raw: unknown): TrafficLightNode[] {
  const envelope = asRecord(raw)
  if (envelope === null) return []
  if (!Array.isArray(envelope.nodes)) return []

  const parsed: TrafficLightNode[] = []
  for (const item of envelope.nodes) {
    const record = asRecord(item)
    if (record === null) continue

    const divisionId = record.division_id
    if (typeof divisionId !== 'string' || divisionId === '') continue

    const status = record.status
    const parentId = record.parent_id
    const name = record.name

    parsed.push({
      division_id: divisionId,
      name: typeof name === 'string' ? name : '',
      parent_id: typeof parentId === 'string' && parentId !== '' ? parentId : null,
      status:
        typeof status === 'string' && STATUS_SET.has(status)
          ? (status as TrafficLightStatus)
          : 'UNKNOWN',
      // Строгое равенство: 'да'/1/'false' — не true. Отсутствие → false.
      late: record.late === true,
    })
  }
  return parsed
}

/**
 * Плоский список → иерархия по `parent_id`.
 *
 * Два инварианта, оба вынужденные (AC-9):
 * - **сирота становится корнем.** Родителя может не быть в ответе штатно: при
 *   RBAC-сужении видимый корень имеет непустой `parent` вне скоупа актора.
 *   Молча уронить такой узел значило бы спрятать подразделение целиком.
 * - **цикл обрывается.** Анти-цикл-констрейнта на `core_divisions` нет
 *   (`core/models.py:146-152` — self-FK без него), бэк защищается visited
 *   (`traffic_light.py:321,326`). Без такой же защиты клиент повесил бы вкладку
 *   бесконечной рекурсией — не «тест упал», а «браузер не отвечает».
 */
export function buildTree(nodes: readonly TrafficLightNode[]): TrafficLightTreeNode[] {
  const byId = new Map<string, TrafficLightTreeNode>()
  for (const node of nodes) {
    // Дубль id не удваивает узел: первый выигрывает (детерминированно).
    if (byId.has(node.division_id)) continue
    byId.set(node.division_id, { ...node, children: [] })
  }

  const roots: TrafficLightTreeNode[] = []
  for (const node of byId.values()) {
    const parent = node.parent_id === null ? undefined : byId.get(node.parent_id)
    // Сам себе родитель — тоже корень (вырожденный цикл длины 1).
    if (parent === undefined || parent === node || createsCycle(node, parent, byId)) {
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }
  return roots
}

/**
 * Приведёт ли подвешивание `node` к `parent` к циклу: идём вверх от `parent` по
 * `parent_id` и смотрим, не встретится ли `node`. Visited-множество страхует от
 * зацикливания самого обхода (цикл может не проходить через `node`).
 */
function createsCycle(
  node: TrafficLightTreeNode,
  parent: TrafficLightTreeNode,
  byId: ReadonlyMap<string, TrafficLightTreeNode>,
): boolean {
  const visited = new Set<string>([node.division_id])
  let current: TrafficLightTreeNode | undefined = parent
  while (current !== undefined) {
    if (visited.has(current.division_id)) return true
    visited.add(current.division_id)
    current = current.parent_id === null ? undefined : byId.get(current.parent_id)
  }
  return false
}

/**
 * Худший цвет по precedence — зеркало `_worst` (traffic_light.py:203-214).
 *
 * ⚠️ **Только для фильтра и тест-паритета с бэком. НЕ источник цвета в
 * рендере** (AC-2, Решение №4): клиент не видит узлы вне скоупа и свернул бы по
 * неполному множеству; цвет узла берётся строго из `status` ответа.
 *
 * Пустой вход → NEUTRAL (бэк: `max(..., default=NEUTRAL)`), а не `undefined`.
 */
export function worstStatus(...statuses: readonly TrafficLightStatus[]): TrafficLightStatus {
  let worst: TrafficLightStatus = 'NEUTRAL'
  for (const status of statuses) {
    if (PRECEDENCE[status] > PRECEDENCE[worst]) worst = status
  }
  return worst
}

/** Отстающий = RED | YELLOW | UNKNOWN (AC-6). */
export function isLagging(status: TrafficLightStatus): boolean {
  return LAGGING.has(status)
}

/**
 * Фильтр «только отстающие»: узел остаётся, если отстающий он сам ИЛИ кто-то в
 * его поддереве.
 *
 * Поддерево проверяется явно, а не через каскадный `status` предка: каскад его
 * уже свернул, но полагаться на это — значит потерять красный лист при любом
 * рассинхроне ответа. Фильтр обязан ПОКАЗЫВАТЬ ветку к отстающему, а не только
 * прятать зелёное.
 */
export function filterLagging(
  tree: readonly TrafficLightTreeNode[],
): TrafficLightTreeNode[] {
  const kept: TrafficLightTreeNode[] = []
  for (const node of tree) {
    const children = filterLagging(node.children)
    if (isLagging(node.status) || children.length > 0) {
      kept.push({ ...node, children })
    }
  }
  return kept
}

/**
 * Множество `division_id` ПРЕДКОВ отстающих узлов — для авто-раскрытия при
 * включённом фильтре (AC-6). Без него отстающий лист под свёрнутым предком
 * остался бы невидим, и фильтр «показать отстающих» ничего бы не показал.
 *
 * Чистая функция: экран объединяет результат с `expanded`, сам `expanded` не
 * трогая (иначе выключение фильтра затёрло бы ручную раскладку безвозвратно).
 */
export function laggingAncestors(tree: readonly TrafficLightTreeNode[]): Set<string> {
  const ancestors = new Set<string>()

  const walk = (node: TrafficLightTreeNode): boolean => {
    let hasLagging = false
    for (const child of node.children) {
      if (walk(child)) hasLagging = true
    }
    if (hasLagging) ancestors.add(node.division_id)
    return hasLagging || isLagging(node.status)
  }

  for (const root of tree) walk(root)
  return ancestors
}

/**
 * Сколько узлов БУДЕТ смонтировано при данной раскладке — детерминированный
 * счётчик перф-бюджета AC-4 (architecture.md §перф-инварианты: счётчики, не
 * тайминги). Считает ровно ту же ветвь, что рендерит `TrafficLightNode`:
 * дети свёрнутого узла не монтируются вовсе.
 */
export function visibleNodeCount(
  tree: readonly TrafficLightTreeNode[],
  expanded: ReadonlySet<string>,
): number {
  let count = 0
  for (const node of tree) {
    count += 1
    if (expanded.has(node.division_id)) {
      count += visibleNodeCount(node.children, expanded)
    }
  }
  return count
}
