// Story 10.4 — экран №2 «Готовность сдачи» (/organization, контракт 10-01):
// дерево вложенных строк-карточек поверх GET traffic-tree с каскадными
// цветами 5.5b, фильтром «только отстающие» и polling-обновлением 60с (Д4).
// Ленивые ветки = ленивый DOM, не сеть (Д3): весь видимый лес приходит одним
// ответом, рендерится по умолчанию только верхний уровень; раскрытие узла
// рендерит только его детей — сетевых до-запросов НЕТ.
// Каналы ошибок — ARCH-FE-015: страница рендерит только доменные состояния
// (загрузка / баннер доменной ошибки / пустое дерево); 5xx/сеть/401 НЕ
// перехватываются (тост/logout-цепь 8.6 — ответственность хука/клиента).
// ARCH-FE-013: своя фича-директория, из daily-grid ничего не импортируется.
import { useCallback, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import { ApiError } from '../../shared/api/errors'
import { Card } from '../../shared/ui/Card'
import {
  buildForest,
  laggardsOnly,
  REFRESH_INTERVAL_MS,
  statusMeta,
} from './trafficTree'
import type { TrafficTreeResponse, TreeVM } from './trafficTree'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Сегодняшняя ЛОКАЛЬНАЯ дата — дефолт date-input (оператор живёт в местных
 * сутках; зеркало todayLocalIso 10.2 — дубль осознанный: boundaries банят
 * импорт из daily-grid, общий date-хелпер в shared — отдельный defer). */
function todayLocalIso(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

/** «Обновлено HH:MM:SS» из dataUpdatedAt — клиентское время (серверный
 * date-форматтер-defer 10.3 не триггерится). */
function formatClock(timestamp: number): string {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function ReadinessTreePage() {
  const [businessDate, setBusinessDate] = useState(todayLocalIso)
  const [laggards, setLaggards] = useState(false)
  // Раскрытые узлы (ленивый DOM, Д3): по умолчанию пусто — отрендерен только
  // верхний уровень. UI-стейт оператора, не копия серверных данных.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const validDate = ISO_DATE_RE.test(businessDate)
  const query = useQuery<TrafficTreeResponse, ApiFailure>({
    queryKey: ['traffic-tree', businessDate],
    queryFn: () =>
      apiClient.get<TrafficTreeResponse>(
        `/api/operations/daily-submissions/traffic-tree/?business_date=${businessDate}`,
      ),
    enabled: validDate,
    // Интервальное обновление (AC-11, Д4): 60с, константа в одном месте.
    refetchInterval: REFRESH_INTERVAL_MS,
    // Канон L472: без авто-ретраев — ошибка сразу отдаёт явное состояние.
    retry: false,
    // Смена даты меняет queryKey — дерево прежней даты держится до прихода
    // нового ответа (без loading-мигания).
    placeholderData: keepPreviousData,
  })

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Доменная ошибка → баннер экрана; 5xx (kind 'server'), сеть (NetworkError —
  // не ApiError) и 401 (logout-цепь 8.6 в providers) НЕ перехватываются.
  const domainError =
    query.error instanceof ApiError &&
    query.error.kind !== 'server' &&
    query.error.status !== 401
      ? query.error
      : null

  const forest = query.data !== undefined ? buildForest(query.data.nodes) : null
  const visibleForest =
    forest === null ? null : laggards ? laggardsOnly(forest) : forest

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <h1 className="text-2xl font-semibold leading-none tracking-tight">
          Готовность сдачи
        </h1>
        <label className="flex items-center gap-2 text-sm">
          Дата
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={laggards}
            onChange={(event) => setLaggards(event.target.checked)}
          />
          Только отстающие
        </label>
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={() => void query.refetch()}
        >
          Обновить
        </button>
        {query.dataUpdatedAt > 0 && (
          <span
            data-testid="updated-at"
            className="text-sm text-muted-foreground"
          >
            Обновлено {formatClock(query.dataUpdatedAt)}
          </span>
        )}
      </Card>

      {query.isPending && validDate ? (
        <p role="status" className="text-sm text-muted-foreground">
          Загрузка дерева…
        </p>
      ) : domainError !== null ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded border border-red-300 p-3 text-sm"
        >
          <span>{domainError.message}</span>
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => void query.refetch()}
          >
            Повторить
          </button>
        </div>
      ) : visibleForest !== null ? (
        query.data !== undefined && query.data.nodes.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Нет доступных подразделений
          </p>
        ) : visibleForest.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Отстающих подразделений нет.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {visibleForest.map((tree) => (
              <TreeNodeRow
                key={tree.node.division_id}
                tree={tree}
                expanded={expanded}
                onToggle={toggle}
              />
            ))}
          </ul>
        )
      ) : (
        // Не-доменная ошибка без данных: нейтральное состояние — детали
        // канала (тост/401-цепь) экран не дублирует (ARCH-FE-015).
        <p role="status" className="text-sm text-muted-foreground">
          Данные недоступны. Нажмите «Обновить», чтобы повторить.
        </p>
      )}
    </div>
  )
}

/** Строка-карточка узла: маркер + имя + текст-статус + «поздно»; цвет никогда
 * не единственный сигнал (aria-label и текст дублируют состояние, AC-8).
 * Дети рендерятся ТОЛЬКО у раскрытого узла (ленивый DOM, AC-9). */
function TreeNodeRow({
  tree,
  expanded,
  onToggle,
}: {
  tree: TreeVM
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  const { node, children } = tree
  const meta = statusMeta(node.status)
  const isExpanded = expanded.has(node.division_id)
  const stateLabel = `${node.name}: ${meta.label}${node.late ? ', поздно' : ''}`
  return (
    <li className="flex flex-col gap-1">
      <Card
        role="group"
        aria-label={stateLabel}
        data-testid={`tree-node-${node.division_id}`}
        className="flex items-center gap-2 p-2"
      >
        {children.length > 0 ? (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Свернуть' : 'Раскрыть'} ${node.name}`}
            className="w-6 rounded border text-sm leading-5"
            onClick={() => onToggle(node.division_id)}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-6" aria-hidden="true" />
        )}
        <span
          data-testid="tree-marker"
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 rounded-full ${meta.markerClass}`}
        />
        <span className="font-medium">{node.name}</span>
        <span className="text-sm text-muted-foreground">{meta.label}</span>
        {node.late && (
          <span className="rounded border border-amber-400 px-1 text-xs">
            поздно
          </span>
        )}
      </Card>
      {isExpanded && children.length > 0 && (
        <ul className="ml-6 flex flex-col gap-1">
          {children.map((child) => (
            <TreeNodeRow
              key={child.node.division_id}
              tree={child}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
