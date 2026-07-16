// Story 10.2 — экран «Расход дня» (экран №1, контракт 09-01): грид E9,
// предзаполненный вчерашней расстановкой с живого GET grid-prefill (10.1b),
// выбор даты, bulk-отправка дельт на живой POST bulk (10.1a). Ядро seam-
// контракта (ретро E9 §5.2): каналы ошибок ARCH-FE-015 отрабатываются ДО
// маркеров (5xx/сеть → тост, 400 → баннер формы, 401 → цепь 8.6); в маркеры
// строк уезжают ТОЛЬКО 409/422-агрегаты (details.rows — raise-сайт
// bulk_status_service.py:225-238) через императивный канал DailyGridHandle.
// Per-cell сетевой seam НЕ подключается (Решение №1: конфликты приходят
// ТОЛЬКО из bulk-ответа ПОСЛЕ отправки — onCellCommit не передаётся вовсе).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import { BusinessRuleError, ConflictError } from '../../shared/api/errors'
import type { paths } from '../../shared/api/schema'
import { useApiMutation } from '../../shared/api/useApiMutation'
import { Card, CardDescription, CardHeader } from '../../shared/ui/Card'
import { ConflictDialog } from '../../shared/ui/ConflictDialog'
import type { ConflictDialogRow } from '../../shared/ui/ConflictDialog'
// Панель сдачи (10.3) — отдельный модуль ЭТОЙ фичи: матрица ARCH-FE-013
// банит кросс-фичевые импорты (features → только shared и та же фича),
// поэтому «отдельная фича day-submission» из спеки размещена соседним
// модулем daily-grid; контракт связи (только пропсы) сохранён.
import { DaySubmissionPanel } from './DaySubmissionPanel'
import type { DailyGridHandle, RowMarker } from './DailyGrid.types'
import { DailyGridContainer } from './DailyGridContainer'
import type { RowChange } from './DailyGrid.types'
import {
  addDaysIso,
  fromGridPrefill,
  ISO_DATE_RE,
  todayLocalIso,
  type BulkStatusRequest,
  type GridPrefillResponse,
  type YesterdayPlacement,
} from './prefill'

type BulkCreateResponse =
  paths['/api/operations/statuses/bulk/']['post']['responses']['201']['content']['application/json']

/** Тело bulk-мутации: запрос 3.8 + поля оверрайд-протокола (8.5, snake_case). */
type BulkVariables = BulkStatusRequest & {
  override?: boolean
  override_reason?: string
}

/** Строка details.rows агрегата — defensive (конверт несёт unknown). */
interface AggregateRow {
  index?: number
  employee_id?: string
  code?: string
  http_status?: number
  message?: string
}

/** details.rows из конверта 409/422-агрегата (raise-сайт 3.8 L225-238). */
function readAggregateRows(details: Record<string, unknown>): AggregateRow[] {
  const rows = details.rows
  if (!Array.isArray(rows)) return []
  return rows.filter(
    (r): r is AggregateRow => typeof r === 'object' && r !== null,
  )
}

/** Агрегат → маркеры строк: 422→hard, 409→soft, иное→hard; ключ = employee_id
 * (Task 7). id вне текущих rows отбрасывает сам грид (applyMarkers). */
export function rowsToMarkers(rows: AggregateRow[]): Record<string, RowMarker> {
  const map: Record<string, RowMarker> = {}
  for (const r of rows) {
    if (typeof r.employee_id !== 'string') continue
    map[r.employee_id] = r.http_status === 409 ? 'soft' : 'hard'
  }
  return map
}

export function DailyExpensePage() {
  // Дефолт — сегодня (локально); prefill грузится за «дата − 1» (Решение №6).
  const [businessDate, setBusinessDate] = useState(todayLocalIso)
  // businessDate-гард (дефер 9.7): пустая/не-ISO дата — грид и отправка
  // недоступны, запрос не уходит.
  const validDate = ISO_DATE_RE.test(businessDate)
  const prefillDate = validDate ? addDaysIso(businessDate, -1) : null

  const prefillQuery = useQuery<GridPrefillResponse, ApiFailure>({
    queryKey: ['grid-prefill', prefillDate],
    queryFn: () =>
      apiClient.get<GridPrefillResponse>(
        `/api/operations/statuses/grid-prefill/?business_date=${prefillDate}`,
      ),
    enabled: prefillDate !== null,
    // Канон L472 «авто-ретраев нет»: ошибка префилла сразу отдаёт экрану
    // состояние с ЯВНОЙ кнопкой повтора (AC-4), не тихие 3 ретрая.
    retry: false,
  })

  const mapped = useMemo(
    () =>
      prefillQuery.data === undefined
        ? null
        : fromGridPrefill(prefillQuery.data),
    [prefillQuery.data],
  )

  // Rebase initials (Решение №7): применённые дельты мержатся во «вчера» —
  // buildPrefilledRows отдаст их новым initial, RESYNC грида обнулит дельты
  // (remount откатил бы применённое визуально). UI-стейт введённого
  // оператором, не копия серверных данных (ARCH-FE-010).
  const [appliedChanges, setAppliedChanges] = useState<
    Record<string, { statusCode: string; period: string }>
  >({})
  const yesterday = useMemo<YesterdayPlacement>(() => {
    const base: YesterdayPlacement = { ...(mapped?.yesterday ?? {}) }
    for (const [id, v] of Object.entries(appliedChanges)) {
      base[id] = {
        statusCode: v.statusCode,
        period: v.period === '' ? undefined : v.period,
      }
    }
    return base
  }, [mapped, appliedChanges])

  const gridRef = useRef<DailyGridHandle>(null)
  const lastChangesRef = useRef<RowChange[]>([])
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [formError, setFormError] = useState(false)
  // Ограниченный цикл (дефер 9.6): 409 ПОСЛЕ оверрайд-попытки этой же
  // отправки НЕ открывает диалог по кругу — жёсткий баннер. Сбрасывается
  // новой отправкой (новый mutate = новый цикл).
  const [overrideAttempted, setOverrideAttempted] = useState(false)

  const bulk = useApiMutation<BulkCreateResponse, BulkVariables>({
    mutationFn: (variables) =>
      apiClient.post<BulkCreateResponse>(
        '/api/operations/statuses/bulk/',
        variables,
      ),
    onSuccess: (data) => {
      // Счётчик — из ОТВЕТА (created), не из длины запроса (AC-6).
      setAppliedCount(data.created)
      setAppliedChanges((prev) => {
        const next = { ...prev }
        for (const c of lastChangesRef.current)
          next[c.id] = { statusCode: c.statusCode, period: c.period }
        return next
      })
    },
    onFormError: () => setFormError(true),
  })
  const { conflict, confirmOverride, dismissConflict, error, isPending } = bulk
  const { mutate } = bulk

  const handleBulkSubmit = useCallback(
    (request: BulkStatusRequest, changes: RowChange[]) => {
      lastChangesRef.current = changes
      setAppliedCount(null)
      setFormError(false)
      setOverrideAttempted(false) // новая отправка = новый цикл конфликта
      mutate(request)
    },
    [mutate],
  )

  const handleConfirmOverride = useCallback(
    (reason: string) => {
      setOverrideAttempted(true)
      confirmOverride(reason)
    },
    [confirmOverride],
  )

  // Обратный канал №1: 409-агрегат (conflict-канал хука) → soft/hard-маркеры.
  useEffect(() => {
    if (conflict === null) return
    const rows = readAggregateRows(conflict.details)
    if (rows.length > 0) gridRef.current?.applyMarkers(rowsToMarkers(rows))
  }, [conflict])

  // Обратный канал №2: 422-агрегат (mutation.error) → hard-маркеры без
  // диалога. ТОЛЬКО BusinessRuleError: 5xx/сеть/400 уже разведены хуком
  // (ARCH-FE-015), 401 обслуживает цепь 8.6 — экран их НЕ перехватывает.
  useEffect(() => {
    if (!(error instanceof BusinessRuleError)) return
    const rows = readAggregateRows(error.details)
    if (rows.length > 0) gridRef.current?.applyMarkers(rowsToMarkers(rows))
  }, [error])

  // Ленивый опрос дерзости для панели сдачи (10.3 AC-7): та же семантика,
  // что beforeunload ниже — без реактивной прокидки дельт наружу.
  const isGridDirty = useCallback(
    () => gridRef.current?.isDirty() ?? false,
    [],
  )

  // beforeunload (AC-11): листенер нейтрален без дельт — дерзость грида
  // спрашивается ЛЕНИВО через императивный ref (без реактивной прокидки
  // дельт наружу и лишних коммитов).
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!gridRef.current?.isDirty()) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const onDateChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      // Смена даты ремоунтит грид (key={businessDate} контейнера) — dirty-
      // дельты погибнут: спросить. native confirm; полноценный Dialog — E10.
      if (
        gridRef.current?.isDirty() &&
        !window.confirm(
          'Есть несохранённые отклонения — сменить дату и потерять их?',
        )
      )
        return
      setBusinessDate(next)
      setAppliedChanges({})
      setAppliedCount(null)
      setFormError(false)
      setOverrideAttempted(false)
    },
    [],
  )

  // Пустой/упавший справочник (AC-4, дефер 9.4): молчаливого select-без-опций
  // нет — редактируемый грид не рендерится вовсе.
  const emptyCatalog =
    mapped !== null && mapped.statusOptions.length === 0

  const nameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const e of mapped?.employees ?? []) map[e.id] = e.fullName
    return map
  }, [mapped])

  const conflictRows = useMemo<ConflictDialogRow[]>(() => {
    if (conflict === null) return []
    return readAggregateRows(conflict.details).map((r, i) => ({
      key: `${r.index ?? i}-${r.employee_id ?? ''}`,
      label: `${nameById[r.employee_id ?? ''] ?? (r.employee_id ?? '—')}: ${
        r.message ?? r.code ?? ''
      }`,
    }))
  }, [conflict, nameById])

  const rejectedCount =
    error instanceof BusinessRuleError
      ? readAggregateRows(error.details).length
      : 0

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            Расход дня
          </h1>
          <CardDescription>
            Утреннее обновление: правятся только отклонения, «Сохранить
            изменения» отправляет их одним запросом (FR-12); сдача дня —
            отдельное действие в панели ниже (контракт 09-01 §7).
          </CardDescription>
          <label className="flex items-center gap-2 text-sm">
            Дата
            <input
              type="date"
              aria-label="Дата"
              value={businessDate}
              onChange={onDateChange}
              className="rounded border px-2 py-1"
            />
          </label>
        </CardHeader>
      </Card>

      {appliedCount !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          Применено отклонений: {appliedCount}
        </p>
      )}
      {formError && (
        <div role="alert" className="rounded border border-red-300 p-2 text-sm">
          Запрос отклонён: проверьте данные формы.
        </div>
      )}
      {rejectedCount > 0 && (
        <div role="alert" className="rounded border border-red-300 p-2 text-sm">
          Отклонено: {rejectedCount} строк — исправьте помеченные строки.
        </div>
      )}
      {/* Баннер конфликта: после исчерпанного цикла (overrideAttempted) хук
          ВСЁ РАВНО сетит conflict на повторный 409 — диалог подавлен, виден
          жёсткий баннер; без цикла — баннер только после «Отмены» диалога. */}
      {error instanceof ConflictError &&
        (overrideAttempted || conflict === null) && (
        <div role="alert" className="rounded border border-amber-300 p-2 text-sm">
          {overrideAttempted
            ? 'Конфликт не разрешён: бэк отклонил повтор с причиной. Строки помечены — исправьте их или обратитесь к администратору.'
            : `Конфликт: ${error.message} Строки помечены в гриде.`}
        </div>
      )}

      {!validDate ? (
        <p role="status" className="text-sm text-muted-foreground">
          Укажите дату — грид недоступен без корректной даты.
        </p>
      ) : prefillQuery.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Загрузка расстановки за {prefillDate}…
        </p>
      ) : prefillQuery.isError || emptyCatalog ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <span>
            {emptyCatalog
              ? 'Справочник статусов пуст — грид недоступен.'
              : 'Не удалось загрузить расстановку.'}
          </span>
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => void prefillQuery.refetch()}
          >
            Повторить
          </button>
        </div>
      ) : mapped !== null ? (
        <DailyGridContainer
          employees={mapped.employees}
          yesterday={yesterday}
          businessDate={businessDate}
          statusOptions={mapped.statusOptions}
          onBulkSubmit={handleBulkSubmit}
          gridRef={gridRef}
          submitPending={isPending}
          // 10.3 (Решение №4): bulk-кнопка честно называется сохранением;
          // «Сдать день» переехал в панель сдачи (submission-флоу 5.3b).
          submitLabel="Сохранить изменения"
          emptyLabel="На выбранную дату личный состав пуст"
        />
      ) : null}

      {/* Панель сдачи дня (10.3): связь со страницей — только пропсы
          (ARCH-FE-013); дерзость грида спрашивается лениво через ref. */}
      {validDate && (
        <DaySubmissionPanel
          businessDate={businessDate}
          isDirty={isGridDirty}
          appliedCount={appliedCount ?? 0}
          employees={mapped?.employees ?? []}
        />
      )}

      {/* bulk-ConflictDialog: только пока цикл не исчерпан (AC-8). */}
      {!overrideAttempted && (
        <ConflictDialog
          conflict={conflict}
          rows={conflictRows}
          onOverride={handleConfirmOverride}
          onCancel={dismissConflict}
        />
      )}
    </div>
  )
}
