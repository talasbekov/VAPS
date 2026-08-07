// Story 10.4 — экран `/organization`: дерево подразделений с каскадным
// маркером готовности. Заменил `OrganizationStub`.
//
// Чего здесь осознанно НЕТ:
// - **счёта «48/48»**, который рисует макет (EXPERIENCE.md#L171/#L240):
//   `CascadeTrafficLight` — это РОВНО status + late (`traffic_light.py:190-201`),
//   числителя/знаменателя каскад не несёт. Нарисовать его из ничего — тот же
//   класс фантома, за который ревью 10.1 сняло MARKS_INCOMPLETE. Дублирование
//   цвета несут текст-метки (AC-3); если счёт нужен пилоту — это поле роута;
// - **`responsible` («отв.: кап. Дамир»)**: цепочки recipient→employee→звание
//   не существует вовсе;
// - **drift-деталей** у жёлтого узла: каскад их не несёт by design, а тянуть
//   5.5a на каждый YELLOW-лист — конфликт с NFR-4 (преемник 10.4a-drill-down);
// - **ленивой ЗАГРУЗКИ по узлу**: `traffic_light_tree` считает всё поддерево
//   одним проходом и параметра глубины не имеет — дозагрузка на раскрытии была
//   бы изобретённым N+1, ровно тем, что 5.5b запрещает инвариантом числа
//   запросов. Ленив РЕНДЕР (Решение №5);
// - **своих loading/error-флагов** поверх Query и оптимистичных апдейтов
//   (ARCH-FE-010).
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import { Card, CardContent } from '../../shared/ui/Card'
import { Label } from '../../shared/ui/Label'
import { OverloadPanel } from './OverloadPanel'
import { TrafficLightNodeRow } from './TrafficLightNode'
import {
  buildTree,
  filterLagging,
  laggingAncestors,
  parseTrafficLightTree,
} from './trafficLight'
import type { TrafficLightTreeNode } from './trafficLight'

/**
 * Интервал опроса (AC-7, Решение №6). Экспортируется, чтобы тест не хардкодил
 * число, а правка после подписи была однострочной. Контракт Q4 оставляет
 * интервал на подпись; макет §2 показывает «обновлено 30с назад».
 *
 * `refetchIntervalInBackground` НЕ включаем: фоновая вкладка на целевых 4 ГБ
 * платила бы за картину, которую никто не смотрит.
 */
export const TRAFFIC_LIGHT_POLL_MS = 30_000

/**
 * Тик ЧАСОВ для подписи «N с назад» — не путать с интервалом опроса.
 *
 * Момент загрузки берётся из `dataUpdatedAt` Query (ARCH-FE-010: свой «когда я
 * последний раз грузил» завести было бы нельзя). Но «сколько времени прошло»
 * требует ещё и «сейчас», а `Date.now()` в теле рендера — нечистый вызов
 * (`react-hooks/purity`: error, не ворнинг). Поэтому «сейчас» живёт в стейте и
 * двигается таймером; серверных данных этот стейт не дублирует.
 *
 * 5 с, а не 1 с: подпись обновляется заметно, а лишних коммитов — вчетверо
 * меньше (при дефолтной раскладке смонтировано ~20 узлов, но платить за
 * секундную стрелку на 4 ГБ незачем).
 */
const FRESHNESS_TICK_MS = 5_000

const TREE_PATH = '/api/operations/traffic-light/tree/'

/** Канон-строки — дословно, не сочинять. */
const HEADING = 'Подразделения'
const FILTER_LABEL = 'только отстающие'
const EMPTY_TEXT = 'Структура не загружена'
const EMPTY_LAGGING_TEXT = 'Отстающих подразделений нет'
const LOADING_TEXT = 'Загрузка структуры подразделений…'
const ERROR_TEXT = 'Не удалось загрузить дерево готовности.'

/** Сегодня в ЛОКАЛЬНОЙ зоне: UTC-срез уехал бы на сутки вечером (ловушка №7). */
function todayLocalIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** «обновлено N секунд назад» — из `dataUpdatedAt`, не из своего таймера. */
function freshnessText(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 60) return `обновлено ${seconds} с назад`
  return `обновлено ${Math.floor(seconds / 60)} мин назад`
}

export function TrafficLightTreePage() {
  const [businessDate] = useState(todayLocalIso)
  const [onlyLagging, setOnlyLagging] = useState(false)

  /**
   * Ручная раскладка раскрытия. Ключ — `division_id`, НЕ индекс: после
   * перечитки порядок узлов может измениться, и индексная раскладка схлопнула
   * бы не те ветки (AC-5; тот же класс, что залипавший dirtyCount в 10.2).
   * Дефолт — раскрыт только корень, он проставляется ниже из данных.
   *
   * `expanded` — чистое UI-состояние, в useState легально (ARCH-FE-010
   * запрещает дублировать в useState СЕРВЕРНЫЕ данные).
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  /** Трогал ли пользователь раскладку: до этого действует дефолт «корень». */
  const [touched, setTouched] = useState(false)

  // «Сейчас» для подписи свежести. Стартует нулём и заполняется таймером:
  // setState в ТЕЛЕ эффекта — ошибка линта (react-hooks/set-state-in-effect),
  // а в колбэке таймера — штатный паттерн.
  const [now, setNow] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const treeQuery = useQuery({
    queryKey: ['traffic-light-tree', businessDate],
    queryFn: () =>
      apiClient.get<unknown>(
        `${TREE_PATH}?business_date=${encodeURIComponent(businessDate)}`,
      ),
    refetchInterval: TRAFFIC_LIGHT_POLL_MS,
  })

  // Разбор — у границы, один раз на ответ. Дальше внутри работаем с деревом.
  const tree = useMemo(
    () => buildTree(parseTrafficLightTree(treeQuery.data)),
    [treeQuery.data],
  )

  const visibleTree = useMemo(
    () => (onlyLagging ? filterLagging(tree) : tree),
    [tree, onlyLagging],
  )

  /**
   * Эффективная раскладка. Фильтр `expanded` НЕ МУТИРУЕТ — он добавляет
   * предков отстающих поверх (AC-6). Мутация затёрла бы ручную раскладку
   * безвозвратно: выключив фильтр, пользователь получил бы дерево
   * «развёрнутым как при фильтре», а свою раскладку — уже нет.
   *
   * Дефолт «раскрыт только корень» — тоже здесь, а не в эффекте:
   * `react-hooks/set-state-in-effect` — ошибка линта, а не ворнинг (ловушка
   * №9), и синхронизация стейта с данными эффектом дала бы лишний коммит.
   */
  const effectiveExpanded = useMemo(() => {
    const base = touched
      ? new Set(expanded)
      : new Set(tree.map((root) => root.division_id))
    if (onlyLagging) {
      for (const id of laggingAncestors(visibleTree)) base.add(id)
    }
    return base
  }, [touched, expanded, tree, onlyLagging, visibleTree])

  const handleToggle = (divisionId: string): void => {
    // Намерение читается по тому, что ВИДИТ пользователь (effectiveExpanded),
    // а не по ручному множеству: при включённом фильтре авто-раскрытый предок
    // показывает «Свернуть», и клик по нему в ручном множестве — это
    // удаление-no-op, а не добавление. Иначе попытка свернуть записала бы
    // ветку как «раскрытую вручную», и выключение фильтра показало бы её
    // раскрытой — ручная раскладка испорчена противоположно намерению (AC-6).
    const collapseIntent = effectiveExpanded.has(divisionId)
    setTouched(true)
    setExpanded((prev) => {
      // База — та же, что видит пользователь: без этого первый клик по
      // раскрытому корню «не сработал бы» (в prev его ещё нет).
      const base = touched ? prev : new Set(tree.map((root) => root.division_id))
      const next = new Set(base)
      if (collapseIntent) next.delete(divisionId)
      else next.add(divisionId)
      return next
    })
  }

  // `data` и `isError` живут ОДНОВРЕМЕННО: сбой фонового опроса не имеет права
  // стирать уже показанное дерево (AC-8). Это не «или-или».
  const hasTree = tree.length > 0
  const showError = treeQuery.isError

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold leading-none tracking-tight">
          {HEADING}
        </h1>
        {/* Дата — ТА, ЗА КОТОРУЮ запрошено дерево, а не «сегодня» абстрактно:
            окно суток считает сервер, и вечером на границе они разойдутся. */}
        <span className="text-sm text-muted-foreground">за {businessDate}</span>

        <div className="flex items-center gap-2">
          {/* Нативный <input type="checkbox"> в токен-классах: Switch в
              shared/ui нет и в этой стори не появляется (прецедент нативного
              контрола — <select> в DailyUpdatePage). */}
          <input
            id="only-lagging"
            type="checkbox"
            checked={onlyLagging}
            onChange={(event) => setOnlyLagging(event.target.checked)}
            className="size-4 rounded border-input"
          />
          <Label htmlFor="only-lagging">{FILTER_LABEL}</Label>
        </div>

        {treeQuery.dataUpdatedAt > 0 ? (
          <span className="text-sm text-muted-foreground">
            {freshnessText(treeQuery.dataUpdatedAt, Math.max(now, treeQuery.dataUpdatedAt))}
          </span>
        ) : null}
      </div>

      {showError ? (
        // Баннер НАД деревом, дерево остаётся жить под ним (AC-8).
        <Card>
          <CardContent className="p-4">
            <p role="alert" className="text-sm text-destructive">
              {ERROR_TEXT}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {treeQuery.isPending ? (
        <Card>
          <CardContent className="p-6">
            <p role="status">{LOADING_TEXT}</p>
          </CardContent>
        </Card>
      ) : !hasTree ? (
        <Card>
          <CardContent className="p-6">
            <p role="status">{EMPTY_TEXT}</p>
          </CardContent>
        </Card>
      ) : visibleTree.length === 0 ? (
        // Отстающих нет — текстовое пустое состояние, а не пустой экран (AC-6).
        <Card>
          <CardContent className="p-6">
            <p role="status">{EMPTY_LAGGING_TEXT}</p>
          </CardContent>
        </Card>
      ) : (
        <ul aria-label="Дерево готовности подразделений" className="flex flex-col gap-1">
          {visibleTree.map((root: TrafficLightTreeNode) => (
            <TrafficLightNodeRow
              key={root.division_id}
              node={root}
              level={1}
              expanded={effectiveExpanded}
              onToggle={handleToggle}
            />
          ))}
        </ul>
      )}

      {/* Story 20.3c: самодостаточная секция под деревом — свой
          division/date-range picker, независимый query, дерево выше не
          трогается. */}
      <OverloadPanel />
    </div>
  )
}
