// Story 10.4 — строка-карточка узла дерева готовности.
//
// Ключевой механизм стори живёт здесь: **свёрнутый узел детей не рендерит
// вовсе**. Не `hidden`, не `display:none` — скрытые узлы остаются в DOM, и
// перф-бюджет AC-4 сошёлся бы при неработающем механизме (урок 10.2: гард
// обязан стоять там, где путь реально проходит). Это же делает виртуализацию
// ненужной (Решение №5): при дефолтной раскладке смонтированы только корень и
// его дети.
//
// Цвет — токен-классы Tailwind через cva-карту (Решение №7). Произвольных hex,
// @apply и inline-style нет (ARCH-FE-014; tailwindcss/no-custom-classname:
// error не пропустил бы ad-hoc класс .traffic-green).
import { cva } from 'class-variance-authority'

import { cn } from '../../shared/lib/cn'
import { LATE_LABEL, STATUS_LABEL } from './trafficLight'
import type { TrafficLightStatus, TrafficLightTreeNode } from './trafficLight'

/**
 * Пять состояний — пять внешностей. De-facto конвенция 10.2/10.3
 * (emerald/amber/red), NEUTRAL и UNKNOWN разведены светлым и тёмным серым
 * (открытый вопрос №3 стори: принято). Токен-семейство светофора вместо
 * палитры — отдельное решение по дизайн-системе, не правка мимоходом.
 */
const markerVariants = cva('inline-block size-3 shrink-0 rounded-full border', {
  variants: {
    status: {
      GREEN: 'border-emerald-700 bg-emerald-500',
      YELLOW: 'border-amber-700 bg-amber-400',
      RED: 'border-red-800 bg-red-500',
      NEUTRAL: 'border-input bg-muted',
      UNKNOWN: 'border-slate-700 bg-slate-500',
    },
  },
})

const labelVariants = cva('rounded px-1.5 py-0.5 text-xs font-medium', {
  variants: {
    status: {
      GREEN: 'bg-emerald-100 text-emerald-900',
      YELLOW: 'bg-amber-100 text-amber-800',
      RED: 'bg-red-100 text-red-800',
      NEUTRAL: 'bg-muted text-muted-foreground',
      UNKNOWN: 'bg-slate-200 text-slate-800',
    },
  },
})

/**
 * Отступ уровня — СТАТИЧЕСКИЕ классы, а не inline-style и не собранный
 * литерал `ps-${n}`: ARCH-FE-014 запрещает inline-style, а JIT-сканер Tailwind
 * видит только целые классы в исходнике — вычисленное имя молча не попало бы в
 * сборку. Глубже 8 уровней отступ не растёт (оргструктура пилота мельче;
 * бесконечная лестница увела бы имя за край экрана).
 */
const LEVEL_INDENT = [
  'ps-0',
  'ps-4',
  'ps-8',
  'ps-12',
  'ps-16',
  'ps-20',
  'ps-24',
  'ps-28',
] as const

export interface TrafficLightNodeProps {
  node: TrafficLightTreeNode
  /** Глубина от корня — только для отступа и aria-level (корень = 1). */
  level: number
  expanded: ReadonlySet<string>
  onToggle: (divisionId: string) => void
}

export function TrafficLightNodeRow({
  node,
  level,
  expanded,
  onToggle,
}: TrafficLightNodeProps) {
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.division_id)
  const status: TrafficLightStatus = node.status

  return (
    <li
      data-traffic-node={node.division_id}
      aria-level={level}
      className={LEVEL_INDENT[Math.min(level - 1, LEVEL_INDENT.length - 1)]}
    >
      <div className="flex items-center gap-2 rounded-md border bg-card p-2 text-card-foreground">
        {hasChildren ? (
          <button
            type="button"
            // aria-expanded + <button> дают Enter/Space штатно — своих
            // keydown-обработчиков не заводим (они бы дублировали нативное
            // поведение и разъехались бы с ним, ревью 9.9).
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Свернуть' : 'Раскрыть'} ${node.name}`}
            onClick={() => onToggle(node.division_id)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded border border-input text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {isExpanded ? '−' : '+'}
          </button>
        ) : (
          // Распорка вместо кнопки: у листа раскрывашки нет, но колонка
          // сохраняется — иначе строки листьев съезжают влево.
          <span className="inline-block size-6 shrink-0" />
        )}

        <span className={cn(markerVariants({ status }))} aria-hidden="true" />

        <span className="font-medium">{node.name}</span>

        {/* Текст-метка — обязательный дубль цвета (AC-3, EXPERIENCE.md#L238):
            цвет никогда не единственный сигнал. */}
        <span className={cn(labelVariants({ status }))}>{STATUS_LABEL[status]}</span>

        {node.late ? (
          <span className="rounded border border-input px-1.5 py-0.5 text-xs text-muted-foreground">
            {LATE_LABEL}
          </span>
        ) : null}
      </div>

      {/* ⚠️ Механизм AC-4: свёрнутое поддерево НЕ монтируется. Замена этого
          тернарника на рендер с `hidden` красит перф-тест — мутация №2. */}
      {hasChildren && isExpanded ? (
        <ul className="mt-1 flex flex-col gap-1">
          {node.children.map((child) => (
            <TrafficLightNodeRow
              key={child.division_id}
              node={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
