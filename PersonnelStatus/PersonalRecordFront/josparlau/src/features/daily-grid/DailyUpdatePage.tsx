// Story 10.2 — экран массового обновления: первый ЖИВОЙ экран портала.
// Грид E9 (9.2–9.9) подключён к реальному bulk-роуту 10.1a; переписывать грид,
// грамматику и prefill нечего — экран их ПОТРЕБИТЕЛЬ.
//
// Границы (Решение №1 стори): экран живёт ВНУТРИ features/daily-grid — соседняя
// фича не имела бы права импортировать DailyGridContainer (ARCH-FE-013).
//
// Чего здесь осознанно НЕТ:
// - prefill «вчера» с сервера: GET статусов на дату не существует → yesterday
//   пуст, все строки садятся в DEFAULT_STATUS (плашка об этом честно говорит);
//   точка подключения 10.1b — инициализация стейта `yesterday`;
// - ConflictDialog и оверрайд: агрегат bulk НЕ оверрайдаем by design
//   (3.8 AC-9; сериализатор 10.1a не принимает override/override_reason) —
//   кнопка «Подтвердить оверрайд» была бы заведомо мёртвой (Решение №4).
//   Детализация конфликта — инлайн-панель без поля причины;
// - onCellCommit: покомпонентного эндпоинта нет, сетевой вызов на строку
//   недопустим (defer 9.6) — маркеры остаются только от zod-валидации;
// - оптимистичных апдейтов и своих loading-флагов (канон #L472/#L487).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { paths } from '../../shared/api/schema'
import { useApiMutation } from '../../shared/api/useApiMutation'
import { Card, CardContent, CardDescription, CardHeader } from '../../shared/ui/Card'
import { Input } from '../../shared/ui/Input'
import { Label } from '../../shared/ui/Label'
import {
  describeBulkFailure,
  parseBulkRowErrors,
  parseValidationDetails,
} from './bulkErrors'
import { DailyGridContainer } from './DailyGridContainer'
import { currentSubmission, parseSubmissionList } from './daySubmission'
import { DaySubmissionPanel } from './DaySubmissionPanel'
import type { DriftEntry } from './DaySubmissionPanel'
import type { BulkStatusRequest, EmployeeSeed, YesterdayPlacement } from './prefill'
import { STATUS_TYPE_OPTIONS } from './statusTypes'

// Типы тела и ответа — ИЗ СХЕМЫ (ARCH-FE-011: рукописные типы при наличии схемы
// = MUST NOT). Рукописный BulkStatusRequest (9.7) присваивается BulkRequestBody
// БЕЗ каста ниже — структурное расхождение обязано валить tsc (контракт-тест).
type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']
type EmployeesResponse =
  paths['/api/core/employees/']['get']['responses']['200']['content']['application/json']
type BulkRequestBody =
  paths['/api/operations/statuses/bulk/']['post']['requestBody']['content']['application/json']
type BulkResponse =
  paths['/api/operations/statuses/bulk/']['post']['responses'][201]['content']['application/json']

/** Cap сериализатора 10.1a — верхняя отсечка дочитки состава (AC-4). */
const MAX_BULK_ROWS = 1000
const PAGE_SIZE = 50
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Надпись кнопки ГРИДА (стори 10.3). Кнопка грида шлёт дельты статусов в
 * bulk-роут и день НЕ сдаёт — канон-строку «Сдать день» забрала панель сдачи,
 * которая действительно создаёт ряд в ops_daily_submissions. Две одинаковые
 * надписи означали бы, что одна из них лжёт.
 *
 * ⚠️ ОДНА константа на два употребления: она же ищет кнопку для Ctrl+Enter
 * (handleKeyDownCapture). Разъедься они — Ctrl+Enter МОЛЧА перестал бы
 * находить кнопку, и клавиатурный путь отвалился бы без единой ошибки.
 */
const GRID_SUBMIT_LABEL = 'Сохранить правки'
/** Канон-строка пустого состава — EXPERIENCE.md#L110. */
const EMPTY_LABEL = 'Личный состав не загружен'

/** Ссылка-константа: пустой литерал на каждый рендер дал бы RESYNC грида. */
const NO_EMPLOYEES: EmployeeSeed[] = []

/** Сегодня в ЛОКАЛЬНОЙ зоне (AC-2): UTC-срез уехал бы на сутки вечером. */
function todayLocalIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// UTC-математика дат (тот же приём, что в prefill.ts): локальный парсер сдвинул
// бы дату на границе суток.
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * DRF отдаёт АБСОЛЮТНЫЙ `next`; уводим его к относительному пути того же
 * origin — подменённый Host увёл бы дочитку состава на чужой хост.
 */
function toSameOriginPath(next: string): string {
  const url = new URL(next, window.location.origin)
  return `${url.pathname}${url.search}`
}

interface EmployeesResult {
  employees: EmployeeSeed[]
  /** Состав длиннее cap: показываем видимое сообщение, не молчаливую усечку. */
  truncated: boolean
}

/**
 * Состав подразделения с ДОЧИТКОЙ по `next` до конца (утреннее управление —
 * 40–300 строк, дефолтная страница их не вмещает). snake_case → EmployeeSeed
 * руками: «умного» camelCase-конвертера в apiClient нет и не должно быть
 * (ARCH#L429).
 */
async function fetchDivisionEmployees(
  divisionId: string,
): Promise<EmployeesResult> {
  // Фильтр division_id бэк читает из query_params вручную и в схему не эмитит
  // (Ловушка 3) — строку запроса собираем руками, ТИП ответа берём из схемы.
  // page_size — намерение для 10.1b: DefaultPagination бэка параметр СЕЙЧАС
  // игнорирует (page_size_query_param не настроен), работает его дефолт = 50.
  let path = `/api/core/employees/?division_id=${encodeURIComponent(divisionId)}&page_size=${PAGE_SIZE}`
  const employees: EmployeeSeed[] = []
  let truncated = false
  for (;;) {
    const page = await apiClient.get<EmployeesResponse>(path)
    for (const employee of page.results) {
      if (employees.length >= MAX_BULK_ROWS) {
        truncated = true
        break
      }
      employees.push({
        id: employee.id,
        fullName: employee.full_name,
        rank: employee.rank_code,
      })
    }
    // Гард прогресса (ревью 10.2): пустая страница с непустым next — битый
    // прокси/донор; без гарда цикл крутится до OOM (cap не растёт на пустых
    // страницах). Обрываем дочитку с тем, что успели собрать.
    if (truncated || !page.next || page.results.length === 0) break
    path = toSameOriginPath(page.next)
  }
  return { employees, truncated }
}

/** Отложенная смена контрола, ждущая подтверждения (AC-3). */
type PendingChange =
  | { kind: 'date'; value: string }
  | { kind: 'division'; value: string | null }

export function DailyUpdatePage() {
  const [divisionId, setDivisionId] = useState<string | null>(null)
  const [businessDate, setBusinessDate] = useState<string>(todayLocalIso)
  // Базовая линия дня. НЕ копия серверных данных (сервера для неё нет) —
  // локальный стейт легален (ARCH-FE-010); 10.1b инициализирует её из query.
  const [yesterday, setYesterday] = useState<YesterdayPlacement>({})
  const [dirtyCount, setDirtyCount] = useState(0)
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingChange | null>(null)
  /**
   * Локальное расхождение (10.3 AC-10): правки, отправленные с ЭТОГО экрана уже
   * ПОСЛЕ сдачи дня — живое состояние разошлось со снапшотом. Это подмножество
   * серверного YELLOW, а не он сам (полная истина — 10.3a/10.3b).
   */
  const [localDrift, setLocalDrift] = useState<DriftEntry[]>([])

  const rootRef = useRef<HTMLDivElement>(null)

  const divisionsQuery = useQuery({
    queryKey: ['divisions'],
    queryFn: () => apiClient.get<DivisionsResponse>('/api/core/divisions/'),
  })

  const employeesQuery = useQuery({
    queryKey: ['employees', divisionId],
    // enabled-гард держит divisionId не-null на момент вызова
    queryFn: () => fetchDivisionEmployees(divisionId as string),
    enabled: divisionId !== null,
  })

  // Ссылка обязана быть стабильной между рендерами: новый литерал массива даёт
  // RESYNC грида и пробитый memo всех строк (перф-инвариант 9.4).
  const employees = useMemo(
    () => employeesQuery.data?.employees ?? NO_EMPLOYEES,
    [employeesQuery.data],
  )

  // Объявлено ДО мутации: её onSuccess читает ФИО для маркера drift (10.3).
  const nameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const employee of employees) map[employee.id] = employee.fullName
    return map
  }, [employees])

  const dateInvalid = !ISO_DATE_RE.test(businessDate)

  /**
   * Состояние дня (10.3 AC-2). Владелец запроса — ЭКРАН, а не панель
   * (Решение №7): состояние нужно обеим сторонам — панели, чтобы рендерить, и
   * экрану, чтобы решать, писать ли localDrift. Два useQuery с ОДНИМ ключом,
   * но разными enabled — известная ловушка react-query (поведение записи кэша
   * определяет тот, кто смонтировался первым). Один владелец, вниз — данные.
   *
   * Оба фильтра — точное равенство (DailySubmissionFilterSerializer); строку
   * собираем вручную: схема параметров этих путей не эмитит вовсе.
   * Конверт — LimitOffset (limit/offset), НЕ page: у /api/core/employees/
   * пагинация другая, и скопированный оттуда код дочитки здесь не подошёл бы
   * (дочитка тут и не нужна — фильтр точечный).
   */
  const daySubmissionQuery = useQuery({
    queryKey: ['day-submission', divisionId, businessDate],
    queryFn: () =>
      apiClient.get<unknown>(
        `/api/operations/daily-submissions/?division_id=${encodeURIComponent(
          divisionId as string,
        )}&business_date=${encodeURIComponent(businessDate)}`,
      ),
    enabled: divisionId !== null && !dateInvalid,
  })

  /**
   * Разбор — ОДИН на оба потребителя (10.6): панели нужен и весь список
   * версий дня (AC-5), и действующая версия. Два отдельных мемо давали бы два
   * разбора и две идентичности массива на каждый ответ — лишние ре-рендеры
   * панели без единого выигрыша.
   */
  const daySubmissions = useMemo(
    () => parseSubmissionList(daySubmissionQuery.data),
    [daySubmissionQuery.data],
  )

  // Селектор бэка по is_current НЕ фильтрует — решение «день сдан» принимает
  // ФЛАГ, а не results.length (AC-2: три состояния, не два).
  const daySubmission = useMemo(
    () => currentSubmission(daySubmissions),
    [daySubmissions],
  )

  const mutation = useApiMutation<BulkResponse, BulkRequestBody>({
    mutationFn: (variables) =>
      apiClient.post<BulkResponse>(
        '/api/operations/statuses/bulk/',
        variables,
      ),
    onSuccess: (data, variables) => {
      // Счётчик — ИЗ ТЕЛА ОТВЕТА, не из локальной длины дельт (AC-8).
      setAppliedCount(data.created)
      // 10.3 AC-10: маркер расхождения пишем ТОЛЬКО если день уже сдан —
      // до сдачи расходиться не с чем. Накапливаем, а не перетираем: две
      // отправки подряд после сдачи разошлись с ней обеими.
      if (daySubmission !== null) {
        setLocalDrift((prev) => {
          const byEmployee = new Map(prev.map((entry) => [entry.employeeId, entry]))
          for (const row of variables.rows) {
            byEmployee.set(row.employee_id, {
              employeeId: row.employee_id,
              fullName: nameById[row.employee_id] ?? row.employee_id,
              statusLabel:
                STATUS_TYPE_OPTIONS.find(
                  (option) => option.code === row.status_type_code,
                )?.label ?? row.status_type_code,
            })
          }
          return Array.from(byEmployee.values())
        })
      }
      // База сдвигается по ФАКТУ 201 (оптимистичных апдейтов нет): применённые
      // строки вливаются в yesterday ⇒ buildPrefilledRows пересобирает базовую
      // линию, введённые значения остаются, счётчик грида уходит в 0.
      setYesterday((prev) => {
        const next: YesterdayPlacement = { ...prev }
        for (const row of variables.rows) {
          next[row.employee_id] = {
            statusCode: row.status_type_code,
            // Обратный маппинг полуинтервала [start, end) → UI-«по …
            // включительно» (ARCH-DATA-023). date_end == businessDate+1 —
            // статус на один день, в гриде это ПУСТОЙ период.
            period:
              row.date_end === addDaysIso(variables.business_date, 1)
                ? undefined
                : addDaysIso(row.date_end, -1),
          }
        }
        return next
      })
    },
  })

  const {
    conflict,
    dismissConflict,
    error: mutationError,
    isPending,
    mutate,
  } = mutation

  // Агрегат bulk не оверрайдаем (Решение №4), но его error_code при чисто-soft
  // отказе — STATUS_OVERLAP_WARNING, и useApiMutation выводит overridable ПО
  // КОДУ из OVERRIDABLE_CODES ⇒ поднимает conflict-стейт. Гасим его сразу:
  // ConflictDialog экран не рендерит, а повисший стейт не должен всплыть
  // диалогом на следующем рендере.
  useEffect(() => {
    if (conflict !== null) dismissConflict()
  }, [conflict, dismissConflict])

  const handleDirtyChange = useCallback((changedCount: number) => {
    setDirtyCount(changedCount)
  }, [])

  // Защита ввода при закрытии вкладки (AC-11). Автосейв — DEFERRED
  // (ARCH-DEFERRED-046), триггер — первая жалоба на потерю ввода.
  useEffect(() => {
    if (dirtyCount === 0) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtyCount])

  const catalogEmpty = STATUS_TYPE_OPTIONS.length === 0

  const handleBulkSubmit = useCallback(
    (request: BulkStatusRequest) => {
      // Одна отправка за раз (AC-7): кнопку «Сдать день» дизейблить нельзя —
      // она внутри грида, поэтому гард здесь. Двойной клик = ровно один POST.
      if (isPending) return
      // Второй рубеж гарда даты (AC-2, defer 9.7): основной — немонтирование
      // грида при dateInvalid (см. рендер). Здесь — defense-in-depth на случай,
      // если грид когда-нибудь окажется смонтирован с негодной датой.
      if (!ISO_DATE_RE.test(request.business_date)) return
      if (catalogEmpty) return
      setAppliedCount(null)
      // Присваивание БЕЗ каста: рукописный BulkStatusRequest (9.7) обязан
      // структурно совпасть со схемным телом, иначе красный tsc (ARCH-FE-011).
      const body: BulkRequestBody = request
      mutate(body)
    },
    [catalogEmpty, isPending, mutate],
  )

  const applyChange = useCallback((change: PendingChange) => {
    if (change.kind === 'date') setBusinessDate(change.value)
    else setDivisionId(change.value)
    setAppliedCount(null)
    setPending(null)
    // Сброс dirty ЗДЕСЬ, а не только из эффекта нового грида (ревью 10.2):
    // подтверждённая смена уничтожает дельты по определению, а если новый
    // состав не загрузится (500/пустой выбор) — грид не ремаунтится и
    // onDirtyChange(0) сообщить некому: beforeunload остался бы взведён на
    // экране без грида, а следующая смена допрашивала бы про «Изменено N из 0».
    setDirtyCount(0)
    // Маркер drift принадлежит КОНКРЕТНОМУ дню и подразделению: без сброса он
    // приехал бы на чужой день — ровно тот класс, что фантомный dirtyCount,
    // найденный ревью 10.2.
    setLocalDrift([])
  }, [])

  // Смена даты ремаунтит грид (key={businessDate}), смена подразделения меняет
  // состав — и то и другое УНИЧТОЖАЕТ несохранённые дельты. Поэтому явное
  // подтверждение В ПРИЛОЖЕНИИ (beforeunload — про закрытие вкладки, не про
  // это). Отказ: контролы управляемые ⇒ значение само возвращается к прежнему.
  const requestChange = useCallback(
    (change: PendingChange) => {
      if (dirtyCount > 0) {
        setPending(change)
        return
      }
      applyChange(change)
    },
    [applyChange, dirtyCount],
  )

  /**
   * Q4 бумажного контракта — клавиатурный выход из грида (AC-12).
   *
   * CAPTURE-фаза со stopPropagation, а НЕ всплытие: `toKey` грида
   * (DailyGrid.tsx:99-121) отсекает модификаторы только в default-ветке для
   * печатных символов, а `Enter` ловит БЕЗУСЛОВНО — без перехвата на входе
   * Ctrl+Enter сначала отработал бы грамматикой (открыл правку ячейки) и лишь
   * потом дошёл до экрана. grammar.ts и её таблица переходов НЕ трогаются.
   */
  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' || !event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()
      // Дельты живут в гриде — отправку инициирует его же кнопка («Сохранить
      // правки»); disabled-кнопка (hard/invalid-строки) клик проигнорирует,
      // ноль дельт контейнер отсечёт сам. Ctrl+Enter СОХРАНЯЕТ правки и день
      // НЕ сдаёт: сдача клавиатурного шортката не получает намеренно —
      // «сдача — осознанное действие» (epic-AC 10.3).
      const button = Array.from(
        rootRef.current?.querySelectorAll('button') ?? [],
      ).find((candidate) => candidate.textContent?.trim() === GRID_SUBMIT_LABEL)
      button?.click()
    },
    [],
  )

  const failure = mutationError === null ? null : describeBulkFailure(mutationError)
  const rowErrors = mutationError === null ? [] : parseBulkRowErrors(mutationError)
  const validationDetails =
    failure?.kind === 'validation' ? parseValidationDetails(mutationError) : []
  // 422 — hard (красный), 409 и прочее — soft (жёлтый). Цвет НИКОГДА не
  // единственный сигнал: текстовая метка обязательна (EXPERIENCE.md#L238).
  const hardFailure =
    mutationError !== null &&
    mutationError.kind !== 'network' &&
    mutationError.status === 422

  const divisions = divisionsQuery.data?.results ?? []

  return (
    <div
      ref={rootRef}
      onKeyDownCapture={handleKeyDownCapture}
      className="flex flex-col gap-4"
    >
      <Card>
        <CardHeader>
          <h1 className="col-start-1 text-2xl font-semibold leading-none tracking-tight">
            Расход дня
          </h1>
          <CardDescription>
            {/* Ритуал ДВУХФАЗНЫЙ (10.3): сначала правки уходят в статусы,
                потом день сдаётся отдельным осознанным действием. Прежний
                текст обещал сдачу по Ctrl+Enter — она туда никогда не
                уходила. */}
            Правьте отклонения и сохраняйте их одной отправкой, затем сдайте
            день. Ctrl+Enter — сохранить правки с клавиатуры.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="division-select">Подразделение</Label>
              <select
                id="division-select"
                value={divisionId ?? ''}
                disabled={divisionsQuery.isPending || divisionsQuery.isError}
                onChange={(event) =>
                  requestChange({
                    kind: 'division',
                    value: event.target.value === '' ? null : event.target.value,
                  })
                }
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {/* Автовыбор первого элемента НЕ делаем: список не отфильтрован
                    по scope оператора, молчаливый выбор чужого подразделения
                    дал бы 403 на отправке без объяснения. */}
                <option value="">— выберите —</option>
                {divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="business-date">Дата</Label>
              <Input
                id="business-date"
                type="date"
                value={businessDate}
                onChange={(event) =>
                  requestChange({ kind: 'date', value: event.target.value })
                }
                className="w-44"
              />
            </div>
          </div>

          {divisionsQuery.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Загрузка подразделений…
            </p>
          ) : null}
          {divisionsQuery.isError ? (
            <p role="alert" className="text-sm text-red-800">
              Не удалось загрузить список подразделений.
            </p>
          ) : null}

          {pending !== null ? (
            // Регистр «счёт + глагол»; формулировка «У вас есть несохранённые
            // изменения» ЗАПРЕЩЕНА (EXPERIENCE.md#L94).
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-md bg-amber-100 p-3 text-sm text-amber-800"
            >
              <span>
                Изменено {dirtyCount} из {employees.length}.{' '}
                {pending.kind === 'date'
                  ? 'Сменить дату?'
                  : 'Сменить подразделение?'}{' '}
                Правки будут потеряны.
              </span>
              <button
                type="button"
                onClick={() => applyChange(pending)}
                className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
              >
                {pending.kind === 'date'
                  ? 'Сменить дату'
                  : 'Сменить подразделение'}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded border border-input px-3 py-1 text-sm"
              >
                Отмена
              </button>
            </div>
          ) : null}

          {dateInvalid ? (
            <p role="alert" className="text-sm text-red-800">
              Укажите дату в формате ГГГГ-ММ-ДД — без неё день сдать нельзя.
            </p>
          ) : null}

          {catalogEmpty ? (
            <p role="alert" className="text-sm text-red-800">
              Справочник статусов не загружен.
            </p>
          ) : null}

          {divisionId !== null ? (
            // Честная плашка вместо молчания и вместо dev-жаргона: реального
            // преднабора «вчера» нет, пока не приедет 10.1b.
            <p className="text-sm text-muted-foreground">
              Преднабор со вчера недоступен: строки заполнены значением «В
              строю».
            </p>
          ) : null}

          {employeesQuery.data?.truncated ? (
            <p role="alert" className="text-sm text-amber-800">
              Показаны первые {MAX_BULK_ROWS} сотрудников: состав подразделения
              длиннее, часть строк не загружена.
            </p>
          ) : null}

          {isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Отправка…
            </p>
          ) : null}

          {appliedCount !== null ? (
            <p role="status" className="text-sm text-foreground">
              Применено {appliedCount} отклонений
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Панель сдачи — НАД гридом, под шапкой. Живёт ВНЕ DailyGrid и его
          ре-рендеров не вызывает: перф-инвариант «ровно 1 React-commit на
          нажатие» (§9 контракта) не задет. */}
      <DaySubmissionPanel
        // Ремаунт на смене контекста: снимает ответ прошлой сдачи, открытое
        // подтверждение и ошибку мутации разом. Тот же приём, что key на гриде
        // (правки принадлежат дню) — и он же заменяет запрещённый линтом
        // setState-в-эффекте внутри панели.
        key={`${divisionId ?? 'none'}-${businessDate}`}
        divisionId={divisionId}
        businessDate={businessDate}
        dateValid={!dateInvalid}
        rowCount={employees.length}
        dirtyCount={dirtyCount}
        localDrift={localDrift}
        submission={daySubmission}
        submissions={daySubmissions}
        isLoading={daySubmissionQuery.isPending && divisionId !== null && !dateInvalid}
        isError={daySubmissionQuery.isError}
      />

      {failure !== null && failure.kind === 'permission' ? (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800">
          {failure.message}
        </p>
      ) : null}

      {failure !== null && failure.kind === 'validation' ? (
        <div
          role="alert"
          className="rounded-md bg-red-100 p-3 text-sm text-red-800"
        >
          <p className="font-medium">Нельзя: {failure.message}</p>
          <ul className="mt-1 list-disc pl-5">
            {validationDetails.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {failure !== null && failure.kind === 'rows' ? (
        <div
          role="alert"
          className={
            hardFailure
              ? 'rounded-md bg-red-100 p-3 text-sm text-red-800'
              : 'rounded-md bg-amber-100 p-3 text-sm text-amber-800'
          }
        >
          {/* Сервис атомарен: при любой отклонённой строке в БД 0 записей —
              поэтому «ничего не сохранено», а НЕ «часть применилась». */}
          <p className="font-medium">
            {hardFailure ? 'Нельзя' : 'Конфликт'}: {failure.message} Ничего не
            сохранено, значения на экране можно поправить и отправить снова.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {rowErrors.map((rowError) => (
              <li key={`${rowError.index}-${rowError.employeeId}`}>
                Строка {rowError.index + 1} ·{' '}
                {nameById[rowError.employeeId] ?? rowError.employeeId} ·{' '}
                {rowError.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {divisionId === null ? (
        <Card>
          <CardContent className="p-6">
            <p role="status">Выберите подразделение</p>
          </CardContent>
        </Card>
      ) : employeesQuery.isPending ? (
        <Card>
          <CardContent className="p-6">
            <p role="status">Загрузка личного состава…</p>
          </CardContent>
        </Card>
      ) : employeesQuery.isError ? (
        <Card>
          <CardContent className="p-6">
            <p role="alert">Не удалось загрузить личный состав.</p>
          </CardContent>
        </Card>
      ) : dateInvalid ? (
        // Грид НЕ монтируется при негодной дате — и это единственное место, где
        // гард работает. Гард внутри handleBulkSubmit опоздал бы: контейнер
        // зовёт toBulkRequest(changes, businessDate) ДО onBulkSubmit, а тот на
        // пустой дате падает RangeError (prefill.ts:96 → addDaysIso('') →
        // Invalid Date.toISOString()). Клик по «Сдать день» ронял бы обработчик
        // вместо отказа. Дельты при этом не теряются сверх обычного: смена даты
        // и так ремаунтит грид по key={businessDate}.
        <Card>
          <CardContent className="p-6">
            <p role="status">
              Грид появится, когда будет указана дата дня.
            </p>
          </CardContent>
        </Card>
      ) : (
        <DailyGridContainer
          employees={employees}
          yesterday={yesterday}
          businessDate={businessDate}
          statusOptions={STATUS_TYPE_OPTIONS}
          emptyLabel={EMPTY_LABEL}
          onBulkSubmit={handleBulkSubmit}
          onDirtyChange={handleDirtyChange}
          submitLabel={GRID_SUBMIT_LABEL}
        />
      )}
    </div>
  )
}
