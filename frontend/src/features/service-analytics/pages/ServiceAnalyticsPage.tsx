// Аналитика службы (§22.3-22.7, §22.12).
//
// ⚠️ Экран НЕ СЧИТАЕТ НИЧЕГО. Предыдущая редакция жила в `app/` и складывала
// распределения в браузере из постраничных списков трёх фич, честно подписывая
// их «по видимым записям». Подпись была правдой, но §22.3 запрещает сам приём:
// «итог по видимой части таблицы» стоит там в одном списке с численностью и
// просрочкой. Теперь считает repository, а экран печатает `displayValue` и
// `state` из ответа — цвет по числу здесь не назначается нигде.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { usePermissions } from '../../../shared/auth/usePermissions'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import {
  useAnalyticsDrilldown,
  useAnalyticsPresets,
  useAttentionItems,
  useServiceAnalytics,
} from '../api/queries'
import type { AnalyticsPeriodRequest } from '../api/queries'
import type {
  AttentionItem,
  AttentionSeverity,
  MetricState,
  MetricValue,
} from '../model/types'

/** §22.3 «Frontend отображает state … а не назначает цвет по числовому
 * значению»: карта идёт от СОСТОЯНИЯ, и ни одна ветка здесь не смотрит на
 * `value`. */
const STATE_CLASS: Record<MetricState, string> = {
  NORMAL: 'border-slate-200 bg-card',
  WARNING: 'border-amber-300 bg-amber-50',
  CRITICAL: 'border-red-300 bg-red-50',
  UNKNOWN: 'border-dashed border-slate-300 bg-muted/30',
}

const STATE_LABEL: Record<MetricState, string> = {
  NORMAL: 'В норме',
  WARNING: 'Требуется проверка',
  CRITICAL: 'Обнаружено превышение серверного порога',
  UNKNOWN: 'Данные не подтверждены',
}

/** §22.11: цвет — от severity ОТВЕТА. Ни одна ветка не смотрит на `count`:
 * «внимание» решает серверный детектор, а не величина числа на экране. */
const SEVERITY_CLASS: Record<AttentionSeverity, string> = {
  CRITICAL: 'border-red-300 bg-red-50',
  WARNING: 'border-amber-300 bg-amber-50',
  INFO: 'border-slate-200 bg-card',
}

const FRESHNESS_LABEL: Record<string, string> = {
  CURRENT: 'Данные актуальны',
  STALE: 'Снимок устарел',
  PARTIAL: 'Часть источников не обновлена. Показатели могут быть неполными.',
  UNKNOWN: 'Актуальность источников неизвестна',
}

const COMPLETENESS_LABEL: Record<string, string> = {
  COMPLETE: 'Данные полные',
  INCOMPLETE: 'Данные неполные',
  UNKNOWN: 'Полнота данных неизвестна',
}

function formatMoment(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function ServiceAnalyticsPage() {
  // §22.6 «Фильтры синхронизируй с URL». Период — единственный фильтр этого
  // среза: scope выбирать не из чего (плоский RBAC), и §22.26 требует, чтобы
  // недоступный scope не появлялся даже в списке.
  const [searchParams, setSearchParams] = useSearchParams()
  const presetsQuery = useAnalyticsPresets()

  const urlPreset = searchParams.get('period')
  const urlFrom = searchParams.get('from') ?? ''
  const urlTo = searchParams.get('to') ?? ''
  const custom = urlPreset === 'CUSTOM' && urlFrom !== '' && urlTo !== ''

  const defaultPreset = presetsQuery.data?.defaultPresetCode ?? null
  const period: AnalyticsPeriodRequest | null = custom
    ? { presetCode: null, from: urlFrom, to: urlTo }
    : urlPreset !== null && urlPreset !== 'CUSTOM'
      ? { presetCode: urlPreset, from: '', to: '' }
      : defaultPreset === null
        ? null
        : { presetCode: defaultPreset, from: '', to: '' }

  const snapshotQuery = useServiceAnalytics(period)
  const snapshot = snapshotQuery.data
  const attentionQuery = useAttentionItems(period)

  // ⚠️ Раскрытие хранится ВМЕСТЕ со снимком, которому принадлежит, а не рядом
  // с ним. Смена периода даёт другой `snapshotId`, и выборка старого снимка к
  // новому уже не относится (§22.12) — при таком хранении она перестаёт быть
  // раскрытой САМА, без эффекта, который «не забыл» бы её сбросить. Это же
  // снимает запрет линтера на setState в теле эффекта.
  const [opened, setOpened] = useState<{
    snapshotId: string
    metricCode: string
    cursor: string | null
  } | null>(null)
  const active = opened !== null && opened.snapshotId === snapshot?.snapshotId ? opened : null
  const openMetric = active?.metricCode ?? null
  const cursor = active?.cursor ?? null
  const [customFrom, setCustomFrom] = useState(urlFrom)
  const [customTo, setCustomTo] = useState(urlTo)

  const drilldownQuery = useAnalyticsDrilldown(
    active === null || snapshot === undefined || period === null
      ? null
      : {
          snapshotId: active.snapshotId,
          metricCode: active.metricCode,
          presetCode: period.presetCode,
          from: period.from,
          to: period.to,
          cursor: active.cursor,
        },
  )

  function selectPreset(presetCode: string): void {
    const next = new URLSearchParams(searchParams)
    next.set('period', presetCode)
    next.delete('from')
    next.delete('to')
    setSearchParams(next, { replace: true })
  }

  function applyCustom(): void {
    const next = new URLSearchParams(searchParams)
    next.set('period', 'CUSTOM')
    next.set('from', customFrom)
    next.set('to', customTo)
    setSearchParams(next, { replace: true })
  }

  function resetFilters(): void {
    // §22.6 «Кнопка Сбросить возвращает разрешённые сервером значения по
    // умолчанию» — экран просто убирает свой выбор из URL.
    setSearchParams(new URLSearchParams(), { replace: true })
    setCustomFrom('')
    setCustomTo('')
  }

  const filtersActive = urlPreset !== null

  return (
    <div>
      <header className="mb-4">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Контроль
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Аналитика службы</h1>
        <span className="text-sm text-muted-foreground">
          Показатели считает сервер: экран печатает пришедшие значения и их состояние
        </span>
      </header>

      {/* §22.6 общая шапка аналитики. */}
      <section
        role="group"
        aria-label="Шапка аналитики"
        className="mb-4 rounded-xl border bg-card p-4"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(presetsQuery.data?.results ?? []).map((preset) => (
            <Button
              key={preset.presetCode}
              size="sm"
              variant={period?.presetCode === preset.presetCode ? 'default' : 'outline'}
              onClick={() => selectPreset(preset.presetCode)}
            >
              {preset.safeLabel}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => void snapshotQuery.refetch()}>
            Обновить
          </Button>
          {filtersActive && (
            <>
              <span className="text-xs font-semibold text-primary">Фильтры активны</span>
              <Button size="sm" variant="outline" onClick={resetFilters}>
                Сбросить
              </Button>
            </>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Начало периода
            <Input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Конец периода
            <Input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={customFrom === '' || customTo === ''}
            onClick={applyCustom}
          >
            Произвольный период
          </Button>
          {presetsQuery.data !== undefined && (
            <span className="text-xs text-slate-600">
              Предел произвольного периода — {presetsQuery.data.maxCustomPeriodDays} дней, его
              проверяет сервер
            </span>
          )}
        </div>

        {snapshot !== undefined && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-[auto_1fr_auto_1fr]">
            <dt className="font-semibold">Период</dt>
            <dd>
              {snapshot.period.from} — {snapshot.period.to}
            </dd>
            <dt className="font-semibold">Business date</dt>
            <dd>
              {snapshot.businessDate} ({snapshot.timezone})
            </dd>
            <dt className="font-semibold">Scope</dt>
            <dd>{snapshot.scope.safeLabel}</dd>
            <dt className="font-semibold">Снимок сформирован</dt>
            <dd>{formatMoment(snapshot.generatedAt)}</dd>
            <dt className="font-semibold">Источники обновлены</dt>
            <dd>
              {snapshot.sourceUpdatedAt === null
                ? 'источник не читался'
                : formatMoment(snapshot.sourceUpdatedAt)}
            </dd>
            <dt className="font-semibold">Версия расчёта</dt>
            <dd>{snapshot.calculationVersion}</dd>
            <dt className="font-semibold">Актуальность</dt>
            <dd>{FRESHNESS_LABEL[snapshot.freshnessState] ?? snapshot.freshnessState}</dd>
            <dt className="font-semibold">Полнота</dt>
            <dd>{COMPLETENESS_LABEL[snapshot.completenessState] ?? snapshot.completenessState}</dd>
          </dl>
        )}
      </section>

      {/* §22.11. Блок приезжает СВОИМ ответом и печатается дословно: ни
          заголовок, ни описание, ни порядок здесь не собираются. */}
      <section
        role="group"
        aria-label="Требует внимания"
        className="mb-4 rounded-xl border bg-card p-4"
      >
        <h2 className="mb-2 text-sm font-semibold">Требует внимания</h2>
        {attentionQuery.error !== null ? (
          <p className="text-sm text-destructive">{attentionQuery.error.message}</p>
        ) : attentionQuery.data === undefined ? (
          <p className="text-sm text-muted-foreground">Загрузка наблюдений…</p>
        ) : attentionQuery.data.data.detectionState === 'UNAVAILABLE' ? (
          // Пустой список и неработающий детектор различаются ВСЛУХ: молчание
          // здесь прочиталось бы как «замечаний нет».
          <p className="text-sm text-slate-600">
            {attentionQuery.data.data.detectionUnavailableReason}
          </p>
        ) : attentionQuery.data.data.items.length === 0 ? (
          <p className="text-sm text-slate-600">
            Ни один серверный детектор не сработал в этом периоде.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attentionQuery.data.data.items.map((item) => (
              <AttentionCard key={item.attentionId} item={item} />
            ))}
          </ul>
        )}
        {attentionQuery.data !== undefined && (
          <p className="mt-2 text-[11px] text-slate-600">
            Версия политики наблюдений: {attentionQuery.data.policyVersion}
          </p>
        )}
      </section>

      {snapshotQuery.error !== null && (
        <p className="mb-4 text-sm text-destructive">{snapshotQuery.error.message}</p>
      )}
      {snapshotQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка аналитики…</p>
      )}
      {snapshotQuery.isFetching && !snapshotQuery.isLoading && (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          Обновление снимка…
        </p>
      )}

      {snapshot !== undefined && (
        <>
          <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.data.metrics.map((metric) => (
              <MetricCard
                key={metric.metricCode}
                metric={metric}
                open={openMetric === metric.metricCode}
                drilldownAllowed={snapshot.drilldownAllowed}
                deniedReason={snapshot.drilldownDeniedReason}
                onToggle={() => {
                  setOpened(
                    openMetric === metric.metricCode
                      ? null
                      : {
                          snapshotId: snapshot.snapshotId,
                          metricCode: metric.metricCode,
                          cursor: null,
                        },
                  )
                }}
              />
            ))}
          </section>

          {active !== null && (
            <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Выборка показателя">
              <h2 className="mb-2 text-sm font-semibold">Строки показателя</h2>
              {drilldownQuery.error !== null ? (
                <p className="text-sm text-destructive">{drilldownQuery.error.message}</p>
              ) : drilldownQuery.data === undefined ? (
                <p className="text-sm text-muted-foreground">Загрузка выборки…</p>
              ) : (
                <>
                  {drilldownQuery.data.data.personalDetailSuppressed && (
                    <p className="mb-2 text-xs text-slate-600">
                      {drilldownQuery.data.data.personalDetailReason}
                    </p>
                  )}
                  <div
                    className="overflow-x-auto"
                    role="region"
                    tabIndex={0}
                    aria-label="Строки показателя"
                  >
                    <table className="w-full min-w-[36rem] text-left text-sm">
                      <thead>
                        <tr className="border-b text-xs uppercase tracking-wide text-slate-600">
                          <th className="py-2 pr-3 font-semibold">Дата</th>
                          <th className="py-2 pr-3 font-semibold">Объект</th>
                          <th className="py-2 pr-3 font-semibold">Состояние</th>
                          <th className="py-2 font-semibold">Сотрудник</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drilldownQuery.data.data.rows.map((row) => (
                          <tr key={row.rowId} className="border-b last:border-0">
                            <td className="py-2 pr-3">{row.businessDate}</td>
                            <td className="py-2 pr-3">{row.objectLabel}</td>
                            <td className="py-2 pr-3">{row.stateLabel}</td>
                            <td className="py-2">{row.employeeLabel ?? 'скрыт'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-xs text-slate-600">
                      Всего строк: {drilldownQuery.data.data.totalCount}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={drilldownQuery.data.data.nextCursor === null}
                      onClick={() =>
                        setOpened({ ...active, cursor: drilldownQuery.data.data.nextCursor })
                      }
                    >
                      Следующая страница
                    </Button>
                    {cursor !== null && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOpened({ ...active, cursor: null })}
                      >
                        В начало
                      </Button>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          <section className="rounded-xl border border-dashed bg-muted/30 p-4">
            <h2 className="mb-2 text-sm font-semibold">Чего в этом снимке нет</h2>
            <ul className="flex flex-col gap-2">
              {[
                ...snapshot.data.unavailableMetrics,
                ...snapshot.unavailableHeaderBlocks,
                ...(attentionQuery.data?.data.unavailableDetectors ?? []),
              ].map(
                (item) => (
                  <li key={item.code} className="text-xs text-slate-600">
                    <span className="font-semibold">{item.label}</span> — {item.reason}
                  </li>
                ),
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

/**
 * §22.11 элемент наблюдения. Экран НЕ формулирует ничего: заголовок, описание,
 * количество и область приходят готовыми, класс идёт от `severity` ответа.
 *
 * §22.27 «каждый маршрут повторно проверяет permission»: право у перехода
 * СВОЁ (`targetPermission`), и здесь оно проверяется лишь чтобы не рисовать
 * заведомо закрытую ссылку — настоящая проверка стоит на маршруте назначения.
 */
function AttentionCard({ item }: { item: AttentionItem }) {
  const { hasPermission } = usePermissions()
  const canFollow =
    item.targetRoute !== null &&
    (item.targetPermission === null || hasPermission(item.targetPermission))

  return (
    <li className={`rounded-lg border p-3 ${SEVERITY_CLASS[item.severity]}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{item.safeTitle}</span>
        {item.count !== null && (
          <span className="text-sm font-bold tabular-nums">{item.count}</span>
        )}
        {item.scopeLabel !== null && (
          <span className="text-[11px] text-slate-600">{item.scopeLabel}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-600">{item.safeDescription}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        <span>Наблюдение зафиксировано: {formatMoment(item.detectedAt)}</span>
        {item.targetRoute !== null &&
          (canFollow ? (
            <Link className="font-semibold text-blue-800 underline" to={item.targetRoute}>
              Перейти к записям
            </Link>
          ) : (
            <span>Переход к записям закрыт: раздел требует отдельного доступа.</span>
          ))}
      </div>
    </li>
  )
}

function MetricCard({
  metric,
  open,
  drilldownAllowed,
  deniedReason,
  onToggle,
}: {
  metric: MetricValue
  open: boolean
  drilldownAllowed: boolean
  deniedReason: string | null
  onToggle: () => void
}) {
  const canOpen = metric.drilldownAvailable && drilldownAllowed
  return (
    // `role="group"` + имя показателя: значение иначе отличимо от соседних
    // чисел только по позиции — и для скринридера, и для локатора теста (тот же
    // приём, что KPI-карточки месячного плана и реестра объектов).
    <div
      role="group"
      aria-label={metric.safeLabel}
      className={`rounded-xl border p-4 ${STATE_CLASS[metric.state]}`}
    >
      <div className="text-xs font-semibold text-slate-600">{metric.safeLabel}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{metric.displayValue}</div>
      <div className="mt-1 text-[11px] font-semibold text-slate-600">
        {STATE_LABEL[metric.state]}
      </div>
      <Button
        className="mt-2"
        size="sm"
        variant="outline"
        disabled={!canOpen}
        title={
          canOpen
            ? undefined
            : !drilldownAllowed
              ? (deniedReason ?? undefined)
              : 'Показатель не рассчитан — раскрывать нечего.'
        }
        onClick={onToggle}
      >
        {open ? 'Свернуть строки' : 'Показать строки'}
      </Button>
    </div>
  )
}
