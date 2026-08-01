// Сводный экран «Итоговые оценки участников» (§19.15-19.16).
//
// СОСТОЯНИЕ ЖИВЁТ В URL. §19.15 требует хранить фильтры в search params и
// восстанавливать их после возврата из detail — здесь URL и есть единственный
// источник: локальной копии фильтров нет, поэтому «восстановить» нечего терять.
// Ссылка на карточку несёт текущий запрос целиком, а возврат из карточки ведёт
// на него же.
//
// ЗАКРЫТЫХ ВЕЛИЧИН НА ЭКРАНЕ НЕТ, потому что их нет в ответе (§19.16/§19.21):
// колонка «Детали оценки» печатает подпись, а не спрятанное значение.
import { Link, useSearchParams } from 'react-router'
import { useEvaluationRegistry } from '../api/queries'
import { CLOSED_DETAILS_LABEL, EMPTY_FILTERS, safeEvaluatorContext } from '../lib/registry'
import type { RegistryFilters } from '../lib/registry'
import { DATA_STATE_LABEL } from '../lib/rating'
import { ROUTES } from '../../../shared/routes'

const DIRECTION_OPTIONS = [
  { value: 'SENIOR_TO_EMPLOYEE', label: 'Старший → сотрудник' },
  { value: 'EMPLOYEE_TO_SENIOR', label: 'Сотрудник → старший' },
]

const METHOD_OPTIONS = [
  { value: 'MANUAL', label: 'Оценка человека' },
  { value: 'SYSTEM_DEFAULT', label: 'Системная оценка по умолчанию' },
]

/** URL → фильтры. Разбор здесь единственный: экран не держит второй копии. */
function readFilters(params: URLSearchParams): RegistryFilters {
  const page = Number(params.get('page') ?? '1')
  return {
    ...EMPTY_FILTERS,
    from: params.get('from'),
    to: params.get('to'),
    event: params.get('event'),
    unit: params.get('unit'),
    employee: params.get('employee'),
    direction: (params.get('direction') as RegistryFilters['direction']) ?? null,
    method: (params.get('method') as RegistryFilters['method']) ?? null,
    correctedOnly: params.get('corrected') === 'true',
    search: params.get('search') ?? '',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

function aggregateLabel(value: number | null): string {
  return value === null ? '—' : String(value).replace('.', ',')
}

export function EvaluationRegistryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = readFilters(searchParams)
  const query = useEvaluationRegistry(filters)
  const data = query.data

  /** Любая правка фильтра сбрасывает страницу: третья страница прежнего отбора
   * к новому отношения не имеет и показала бы пустоту как «ничего не найдено». */
  function update(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams)
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
    if (key !== 'page') next.delete('page')
    setSearchParams(next)
  }

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Охранные мероприятия
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Итоговые оценки участников</h1>
        <span className="text-sm text-muted-foreground">
          Реестр записей оценивания в безопасном представлении: значения оценок, комментарии и
          оценщики закрыты и с сервера не приходят.
        </span>
      </header>

      {query.isLoading && <p className="text-sm text-muted-foreground">Загрузка реестра…</p>}
      {query.error !== null && <p className="text-sm text-destructive">{query.error.message}</p>}

      {data !== undefined && (
        <>
          {!data.capabilities.operationalRatings && (
            <p className="mb-4 rounded-xl border bg-card p-4 text-sm">
              Оперативный рейтинг выключен сервером (ENABLE_OPERATIONAL_RATINGS): записей нет не
              потому, что никого не оценивали.
            </p>
          )}

          <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Фильтры">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-semibold">
                Период с
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={filters.from ?? ''}
                  onChange={(event) => update('from', event.target.value)}
                  aria-label="Период с"
                />
              </label>
              <label className="text-xs font-semibold">
                Период по
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={filters.to ?? ''}
                  onChange={(event) => update('to', event.target.value)}
                  aria-label="Период по"
                />
              </label>
              <label className="text-xs font-semibold">
                Мероприятие
                <select
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={filters.event ?? ''}
                  onChange={(event) => update('event', event.target.value)}
                  aria-label="Мероприятие"
                >
                  <option value="">Все</option>
                  {data.options.events.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold">
                Подразделение
                <select
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={filters.unit ?? ''}
                  onChange={(event) => update('unit', event.target.value)}
                  aria-label="Подразделение"
                >
                  <option value="">Все</option>
                  {data.options.units.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold">
                Сотрудник
                <select
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={filters.employee ?? ''}
                  onChange={(event) => update('employee', event.target.value)}
                  aria-label="Сотрудник"
                >
                  <option value="">Все</option>
                  {/* Перечень приходит с сервера: собрать его из полученных строк
                      значило бы показать только тех, кто попал на страницу, а
                      §19.15 запрещает раскрывать и тех, кто вне scope. */}
                  {data.options.employees.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold">
                Направление
                <select
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={filters.direction ?? ''}
                  onChange={(event) => update('direction', event.target.value)}
                  aria-label="Направление"
                >
                  <option value="">Все</option>
                  {DIRECTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold">
                Метод
                <select
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={filters.method ?? ''}
                  onChange={(event) => update('method', event.target.value)}
                  aria-label="Метод"
                >
                  <option value="">Все</option>
                  {METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold">
                Поиск
                <input
                  className="mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal"
                  value={filters.search}
                  onChange={(event) => update('search', event.target.value)}
                  aria-label="Поиск"
                  placeholder="Участник, мероприятие, объект"
                />
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={filters.correctedOnly}
                onChange={(event) => update('corrected', event.target.checked ? 'true' : null)}
              />
              Только исправленные записи
            </label>
          </section>

          <section className="mb-4 overflow-hidden rounded-xl border bg-card">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Итоговые оценки участников мероприятий</caption>
              <thead>
                <tr>
                  {[
                    'Участник',
                    'Подразделение',
                    'Мероприятие',
                    'Объект',
                    'Пост или роль',
                    'Участие',
                    'Дата',
                    'Контекст',
                    'Детали оценки',
                    'Агрегат',
                    'Действие',
                  ].map((title) => (
                    <th
                      key={title}
                      scope="col"
                      className="p-3 text-[11px] font-semibold text-muted-foreground"
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.rowId} className="border-t align-top">
                    <td className="p-3 text-sm font-medium">{row.employeeSafeLabel}</td>
                    <td className="p-3 text-xs">{row.unitSafeLabel}</td>
                    <td className="p-3 text-xs">
                      {row.eventNumber} — {row.eventTitle}
                    </td>
                    <td className="p-3 text-xs">{row.objectLabel}</td>
                    <td className="p-3 text-xs">{row.postLabel ?? '—'}</td>
                    <td className="p-3 text-xs">
                      {row.participated === null
                        ? 'нет сведений'
                        : row.participated
                          ? 'участвовал'
                          : 'не участвовал'}
                    </td>
                    <td className="p-3 text-xs tabular-nums">{row.evaluatedAt}</td>
                    <td className="p-3 text-xs">
                      {safeEvaluatorContext(row.method, row.evaluationDirection, row.corrected)}
                    </td>
                    {/* На месте score, основания и комментария — подпись §19.16.
                        Это не скрытая колонка: сервер этих полей не присылает. */}
                    <td className="p-3 text-xs text-muted-foreground">{CLOSED_DETAILS_LABEL}</td>
                    <td className="p-3 text-sm tabular-nums">
                      {aggregateLabel(row.aggregateRating)}
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {row.aggregateState === 'READY' ? '' : DATA_STATE_LABEL[row.aggregateState]}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      {/* Ссылка несёт ТЕКУЩИЙ запрос: возврат из карточки должен
                          вернуть тот же отбор и ту же страницу (§19.15). */}
                      <Link
                        className="underline"
                        to={`${ROUTES.ratingEmployeeDetail.replace(':employeeId', row.employeeId)}?back=${encodeURIComponent(searchParams.toString())}`}
                      >
                        Открыть агрегат
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* §19.31: каноническая формулировка дословно; второе предложение
                отделяет результат отбора от отсутствия оценивания вовсе. */}
            {data.results.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                По выбранным условиям оценки не найдены. Это результат отбора, а не отсутствие
                оценивания.
              </p>
            )}
          </section>

          <div className="mb-4 flex items-center gap-3 text-sm">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 disabled:opacity-50"
              disabled={data.page <= 1}
              onClick={() => update('page', String(data.page - 1))}
            >
              Назад
            </button>
            <span className="text-xs text-muted-foreground">
              Страница {data.page} из {data.pageCount} · записей {data.total}
            </span>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 disabled:opacity-50"
              disabled={data.page >= data.pageCount}
              onClick={() => update('page', String(data.page + 1))}
            >
              Вперёд
            </button>
          </div>

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Что не показывается</h2>
            <ul className="flex flex-col gap-2">
              {data.unavailableViews.map((view) => (
                <li key={view.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{view.label}. </span>
                  {view.reason}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
