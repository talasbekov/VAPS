// Story 10.3 — панель сдачи дня: честное состояние дня, предпросмотр с
// подтверждением и ЖИВАЯ сдача через POST /api/operations/daily-submissions/.
//
// Зачем панель вообще появилась (главное открытие стори): кнопка «Сдать день»
// внутри грида день НЕ сдаёт — она шлёт дельты статусов в bulk-роут 10.1a. Ряд
// в ops_daily_submissions не появлялся, submit_day не вызывался, лист в
// светофоре оставался RED. Интерфейс утверждал выполненным действие, которого
// в системе не происходило. Канон-кнопка «Сдать день» живёт ЗДЕСЬ, кнопка
// грида переименована в «Сохранить правки» (аддитивный проп submitLabel).
//
// Границы (Решение №1): панель лежит ВНУТРИ features/daily-grid — соседняя
// фича не имела бы права импортировать грид (ARCH-FE-013).
//
// Чего здесь осознанно НЕТ:
// - серверного drift-маркера (истина 5.5a): division_traffic_light — сервис БЕЗ
//   HTTP-роута, тянуть неоткуда → 10.3a (роут) + 10.3b (UI). Здесь только
//   ЛОКАЛЬНЫЙ drift, и текст прямо называет его границу;
// - полного diff против снапшота: требует клиентского resolve_status —
//   реинвент серверной логики (→ 10.1b);
// - модалки: модальность в jsdom не эмулируется (дефер 9.5/9.9), модальный
//   ассерт был бы вакуумным до e2e 10.10 → инлайн-панель (Решение №5).
//
// Story 10.6 добавила сюда amendment-флоу (право daily_report.correct): вход,
// форма причины+санкции и список версий дня. Чего в 10.6 осознанно НЕТ:
// - метки ПРОТУХШЕЙ СВОДКИ (третья треть epic-AC): `summary_freshness` (5.11)
//   существует сервисом БЕЗ HTTP-поверхности — не в `__all__`, не в роутах, в
//   схеме нет ни `summary`, ни `freshness`. Тянуть неоткуда → 10.6a (роут) +
//   10.6b (UI). Выводить свежесть из светофора НЕЛЬЗЯ: это отдельная ось
//   (`5-11:97`) — сводка, которая есть, не RED, а пины при этом могут быть
//   протухшими;
// - причины/санкции ИСТОРИЧЕСКИХ версий: список даёт 9 полей без них, нужен
//   GET /{id}/ на каждую версию (N+1) → 10.6c.
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { components } from '../../shared/api/schema'
import { useApiMutation } from '../../shared/api/useApiMutation'
import { usePermissions } from '../../shared/auth/usePermissions'
import { Button } from '../../shared/ui/Button'
import { Card, CardContent } from '../../shared/ui/Card'
import { describeAmendFailure } from './amendment'
import type { DayAmendBody } from './amendment'
import { parseValidationDetails } from './bulkErrors'
import { DayAmendmentForm } from './DayAmendmentForm'
import { describeStaleness, parseSummaryFreshness } from './freshness'
import {
  describeSubmitFailure,
  EVENT_LABELS,
  isWithinSubmitWindow,
  parseSubmissionList,
  previousSubmission,
  todayLocalIso,
} from './daySubmission'
import type { DaySubmission, DaySubmissionCreateBody } from './daySubmission'

/** Одна строка локального расхождения: кого правили после сдачи и на что. */
export interface DriftEntry {
  employeeId: string
  fullName: string
  statusLabel: string
}

/**
 * Story 10.3b — ответ `GET /api/operations/traffic-light/division/` (5.5a,
 * роут 10.3c). Тип — ИЗ СХЕМЫ (ARCH-FE-011), не рукописное зеркало.
 */
type DivisionTrafficLight = components['schemas']['TrafficLightDivisionResponse']

export interface DaySubmissionPanelProps {
  divisionId: string | null
  businessDate: string
  /** Дата прошла ISO-проверку экрана; при false панель не рендерит НИЧЕГО. */
  dateValid: boolean
  /** Число строк грида — знаменатель канон-строки «Изменено N из M». */
  rowCount: number
  dirtyCount: number
  /** Правки, отправленные на ЭТОМ экране уже после сдачи (AC-10). */
  localDrift: DriftEntry[]
  /**
   * Story 10.3b: ФИО живого состава подразделения (тот же маппинг, что кормит
   * `localDrift` на экране) — переиспользуется для резолюции серверного
   * drift БЕЗ второго сетевого запроса (Dev Notes: N+1 за именем не заводим).
   */
  nameById: Record<string, string>
  /** Текущая сдача дня. Владелец запроса — ЭКРАН (Решение №7), не панель. */
  submission: DaySubmission | null
  /**
   * ВСЕ версии из того же запроса дня (10.6 AC-5). Отдельного запроса истории
   * здесь нет и быть не должно: `?division_id&business_date` уже возвращает
   * все версии (селектор по `is_current` НЕ фильтрует), а второй `useQuery` с
   * тем же ключом — известная ловушка react-query (запись кэша определяет
   * тот, кто смонтировался первым).
   */
  submissions: DaySubmission[]
  isLoading: boolean
  isError: boolean
}

/** Канон-строка кнопки сдачи — EXPERIENCE.md#L103. */
const SUBMIT_LABEL = 'Сдать день'

/** Канон-строка входа в amendment-флоу (10.6, открытый вопрос №1). */
const AMEND_LABEL = 'Исправить сдачу'

/** Дата-время сдачи в локальной зоне читателя (submitted_at приходит с офсетом). */
function formatSubmittedAt(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('ru-RU')
}

/**
 * Story 10.3b (AC-4) — ФИО из живого состава подразделения, а не второй
 * сетевой запрос. `removed`-id по определению отсутствует в живом составе
 * (это и значит «removed») — печатаем id с честной пометкой, а не скрываем
 * строку и не молчим.
 */
function resolveName(id: string, nameById: Record<string, string>): string {
  const name = nameById[id]
  return name !== undefined ? name : `${id} (нет в текущем составе)`
}

export function DaySubmissionPanel({
  divisionId,
  businessDate,
  dateValid,
  rowCount,
  dirtyCount,
  localDrift,
  nameById,
  submission,
  submissions,
  isLoading,
  isError,
}: DaySubmissionPanelProps) {
  const queryClient = useQueryClient()
  const { hasPermission } = usePermissions()
  const [confirming, setConfirming] = useState(false)
  // Ответ ПОСЛЕДНЕЙ успешной сдачи — «результат действия» для мгновенного
  // показа события (ARCH-FE-010 это разрешает); истина о дне всё равно
  // перечитывается инвалидацией ниже.
  const [submitted, setSubmitted] = useState<DaySubmission | null>(null)
  // Причина отказа ДО отправки (гарды AC-4/AC-5): пишется по клику, чтобы
  // объяснение появлялось в ответ на действие, а не висело фоном.
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  // 10.6: форма исправления открыта; ответ ПОСЛЕДНЕГО исправления — то же
  // разрешённое ARCH-FE-010 исключение, что и `submitted` выше.
  const [amending, setAmending] = useState(false)
  const [amended, setAmended] = useState<DaySubmission | null>(null)

  /**
   * История сдач ПОДРАЗДЕЛЕНИЯ (без фильтра по дате) — нужна предпросмотру:
   * серверный `_compute_event` при `previous is None` отдаёт CHANGED, поэтому
   * без знания «была ли предыдущая сдача» предсказание AC-3(в) было бы
   * заведомо неверным на первой сдаче. Это ОТДЕЛЬНЫЙ запрос, а не расширение
   * запроса состояния дня: тот обязан фильтровать по дате точным равенством
   * (AC-2), иначе на давней дате нужная строка уехала бы за первую страницу.
   * `limit=200` — max_limit пагинации; сериализатор фильтров лишние ключи
   * игнорирует. Строку собираем вручную: схема параметров не эмитит.
   */
  const historyQuery = useQuery({
    queryKey: ['division-submissions', divisionId],
    queryFn: () =>
      apiClient.get<unknown>(
        `/api/operations/daily-submissions/?division_id=${encodeURIComponent(
          divisionId as string,
        )}&limit=200`,
      ),
    enabled: divisionId !== null && dateValid,
  })

  const previous = useMemo(
    () => previousSubmission(parseSubmissionList(historyQuery.data), businessDate),
    [historyQuery.data, businessDate],
  )

  const mutation = useApiMutation<DaySubmission, DaySubmissionCreateBody>({
    mutationFn: (variables) =>
      apiClient.post<DaySubmission>(
        '/api/operations/daily-submissions/',
        variables,
      ),
    onSuccess: (data) => {
      setSubmitted(data)
      setConfirming(false)
      queryClient.invalidateQueries({
        queryKey: ['day-submission', divisionId, businessDate],
      })
      queryClient.invalidateQueries({ queryKey: ['division-submissions', divisionId] })
      // Story 10.3b (ревью): защитная инвалидация — на момент сдачи запрос
      // серверного drift ещё был `enabled: false` (current === null), так что
      // первый фетч после включения гейта и так свежий. Инвалидация здесь —
      // страховка от гонки (запрос успел стартовать ДО завершения мутации),
      // а не обязательный фикс для этого пути (см. amend ниже — там баг реальный).
      queryClient.invalidateQueries({
        queryKey: ['division-traffic-light', divisionId, businessDate],
      })
      // Story 10.6b — та же защитная инвалидация, что drift выше: на момент
      // сдачи freshness ещё был `enabled: false` (current === null).
      queryClient.invalidateQueries({
        queryKey: ['summary-freshness', divisionId, businessDate],
      })
    },
  })

  const { error: mutationError, isPending, mutate } = mutation

  const failure = mutationError === null ? null : describeSubmitFailure(mutationError)

  // ⚠️ Действующая версия дня считается ДО мутации исправления: её `id`
  // адресует ЦЕПОЧКУ (Д1 5.8b) — `amend_day` сам переразрешает голову цепочки
  // через `latest_for`, поэтому даже устаревший pk амендит ТОТ ЖЕ день.
  const current = amended ?? submitted ?? submission

  /**
   * Story 10.3b — серверное расхождение подразделения (5.5a, роут 10.3c).
   * `enabled` держит ТОТ ЖЕ гейт, что уже открывает локальный drift и
   * «Исправить сдачу» (`current !== null`): смысла запрашивать расхождение
   * на несданном дне нет — `division_traffic_light` на несданный день
   * отдаёт RED, `drift: null`.
   *
   * Гейт `status.view` уже стоит на роуте (10.3c AC-8) — своей permission-
   * проверки здесь нет (Dev Notes): 403 гасится ниже как обычная ошибка
   * обогащения (AC-3, AC-8), не первичный сигнал экрана.
   */
  const serverDriftQuery = useQuery({
    queryKey: ['division-traffic-light', divisionId, businessDate],
    queryFn: () =>
      apiClient.get<DivisionTrafficLight>(
        `/api/operations/traffic-light/division/?division_id=${encodeURIComponent(
          divisionId as string,
        )}&business_date=${encodeURIComponent(businessDate)}`,
      ),
    enabled: divisionId !== null && dateValid && current !== null,
  })

  /**
   * Story 10.3b (ревью): НЕ доверяем инварианту бэка «YELLOW ⇒ хотя бы одна
   * из трёх групп непуста» вслепую (Dev Notes уже предупреждали об этом для
   * под-списков — тот же принцип распространён на видимость ВСЕЙ панели).
   * Без явной проверки суммы длин all-empty drift рисовал бы «alert» без
   * единой строки содержимого — пустую оболочку, которую сама панель и
   * запрещает (AC-3: «никакого пустого блока»).
   */
  const rawServerDrift =
    serverDriftQuery.data?.status === 'YELLOW' ? (serverDriftQuery.data.drift ?? null) : null
  const serverDrift =
    rawServerDrift !== null &&
    rawServerDrift.added.length + rawServerDrift.removed.length + rawServerDrift.changed.length >
      0
      ? rawServerDrift
      : null

  /**
   * Story 10.6b — свежесть сводки (5.11, роут 10.6a). ТОТ ЖЕ гейт, что
   * `serverDriftQuery`: на несданный день сводки нет смысла спрашивать.
   *
   * ⚠️ Свежесть — ОТДЕЛЬНАЯ ось от цвета светофора (5-11:97) — этот запрос НЕ
   * читает `TrafficLightStatus`/`DivisionTrafficLight` ни в каком виде,
   * источник исключительно ответ `/freshness/`.
   */
  const freshnessQuery = useQuery({
    queryKey: ['summary-freshness', divisionId, businessDate],
    queryFn: () =>
      apiClient.get<unknown>(
        `/api/operations/daily-submissions/freshness/?division_id=${encodeURIComponent(
          divisionId as string,
        )}&business_date=${encodeURIComponent(businessDate)}`,
      ),
    enabled: divisionId !== null && dateValid && current !== null,
  })
  const freshness = parseSummaryFreshness(freshnessQuery.data)
  // Не доверяем инварианту бэка «STALE ⇒ хотя бы одна ось непуста» вслепую
  // (тот же принцип, что `serverDrift`'s all-empty guard выше): без явной
  // проверки суммы длин STALE-с-пустыми-осями нарисовал бы alert без единой
  // строки содержимого.
  const staleness =
    freshness !== null &&
    freshness.status === 'STALE' &&
    freshness.superseded.length + freshness.missing.length + freshness.unpinned.length > 0
      ? freshness
      : null

  const amendMutation = useApiMutation<DaySubmission, DayAmendBody>({
    mutationFn: (variables) =>
      apiClient.post<DaySubmission>(
        `/api/operations/daily-submissions/${String(current?.id)}/amend/`,
        variables,
      ),
    onSuccess: (data) => {
      setAmended(data)
      setAmending(false)
      queryClient.invalidateQueries({
        queryKey: ['day-submission', divisionId, businessDate],
      })
      queryClient.invalidateQueries({ queryKey: ['division-submissions', divisionId] })
      // Story 10.3b (ревью, реальный баг — Blind Hunter): в отличие от
      // изначальной сдачи, серверный drift-запрос УЖЕ был enabled и УЖЕ
      // отфетчен ДО исправления (день был сдан). Без явной инвалидации панель
      // показывала бы кэш ДО амендмента — расхождение, которое исправление
      // могло уже закрыть (или, наоборот, новое, внесённое амендментом).
      queryClient.invalidateQueries({
        queryKey: ['division-traffic-light', divisionId, businessDate],
      })
      // Story 10.6b (AC-4, урок 10.3b — не повторять пропущенную инвалидацию
      // на amend): freshness-запрос УЖЕ был enabled и УЖЕ отфетчен до
      // исправления (день был сдан), тот же риск устаревшего кэша.
      queryClient.invalidateQueries({
        queryKey: ['summary-freshness', divisionId, businessDate],
      })
    },
  })

  const amendFailure =
    amendMutation.error === null ? null : describeAmendFailure(amendMutation.error)

  // 409 (гонка двух amendment) и 404 (сдача исчезла) — оба означают, что
  // состояние дня под формой устарело: перечитываем. Без этого форма зависла
  // бы над устаревшим состоянием — ровно тот HIGH, что ревью поймало на 10.5.
  const amendStale = amendFailure?.kind === 'conflict' || amendFailure?.kind === 'not-found'
  useEffect(() => {
    if (!amendStale) return
    queryClient.invalidateQueries({
      queryKey: ['day-submission', divisionId, businessDate],
    })
  }, [amendStale, queryClient, divisionId, businessDate])

  /**
   * Форма открыта — ЧИСТАЯ ПРОИЗВОДНАЯ в рендере, не стейт.
   *
   * ⚠️ Гард `current === null` из панели сдачи здесь НЕприменим: после гонки
   * версий день остаётся сданным (`current !== null`), и форма не закрылась бы
   * никогда. А `setState` для закрытия нельзя ни в эффекте, ни в рендере —
   * `react-hooks/set-state-in-effect` и его рендер-близнец оба eslint **error**.
   * 400 сюда НЕ входит намеренно: это правимый отказ, форму надо оставить
   * открытой, чтобы было что исправлять.
   */
  const amendFormOpen = amending && !amendStale

  /**
   * Версии ЭТОГО дня (AC-5). Фильтр по дате явный, хотя запрос уже точечный, —
   * это защита от смены пропа, а не пересказ контракта API.
   * Порядок — КАК ОТДАЁТ БЭК (`-business_date, -version, id`): своей
   * сортировки не заводим, иначе экран и сервер разошлись бы в понимании
   * «какая версия последняя».
   */
  const dayVersions = useMemo(
    () => submissions.filter((row) => row.business_date === businessDate),
    [submissions, businessDate],
  )

  // ⚠️ Сброс стейта при смене дня/подразделения делает НЕ эффект, а ремаунт по
  // `key={divisionId}-{businessDate}` на экране. Эффект с setState здесь и
  // писался, и падал линтом (react-hooks/set-state-in-effect) — и правильно:
  // ремаунт снимает разом и ответ прошлой сдачи, и открытое подтверждение, и
  // причину отказа, и ошибку мутации, без каскадного ре-рендера. Без сброса
  // «День сдан» от прежнего контекста приехал бы на чужой день — тот же класс,
  // что фантомный dirtyCount, найденный ревью 10.2.

  // AC-8: после 409 состояние дня перечитывается — иначе кнопка «Сдать день»
  // осталась бы активной обманкой на уже сданном дне.
  const alreadySubmitted = failure?.kind === 'already-submitted'
  useEffect(() => {
    if (!alreadySubmitted) return
    queryClient.invalidateQueries({
      queryKey: ['day-submission', divisionId, businessDate],
    })
  }, [alreadySubmitted, queryClient, divisionId, businessDate])

  // Дата не выбрана — сдавать нечего, панель молчит целиком. Это не косметика:
  // DailyUpdatePage.test.tsx:556 инвертированным ассертом проверяет, что при
  // негодной дате «Сдать день» на экране нет.
  if (!dateValid) return null

  /**
   * Причина, по которой отправка невозможна, — считается ДО открытия
   * подтверждения (урок 10.2: гард обязан стоять там, где путь реально
   * проходит, а не там, где о нём удобно думать).
   */
  function blockingReason(): string | null {
    if (divisionId === null) return 'Выберите подразделение.'
    // AC-4: инвариантная блокировка, не предупреждение. submit_day снимает
    // снапшот с СЕРВЕРНОГО состояния — несохранённые дельты в него не попадут,
    // и оператор сдал бы не то, что видит на экране.
    if (dirtyCount > 0) return `Сначала сохраните правки: изменено ${dirtyCount}`
    // AC-5: клиентский гард — удобство. Истина при расхождении зон — allowed
    // из 422-ответа (ниже), а не пересказ собственного окна.
    if (!isWithinSubmitWindow(businessDate, todayLocalIso())) {
      return 'Сдать можно только за сегодня или завтра.'
    }
    return null
  }

  function handleOpenConfirm() {
    const reason = blockingReason()
    setBlockedReason(reason)
    // Подтверждение, которое нельзя подтвердить, — тупик: не открываем.
    if (reason !== null) return
    setConfirming(true)
  }

  function handleConfirm() {
    // Гард isPending (AC-6): двойной клик/двойное подтверждение = один POST.
    if (isPending) return
    const reason = blockingReason()
    if (reason !== null) {
      setBlockedReason(reason)
      setConfirming(false)
      return
    }
    if (divisionId === null) return
    // Тело — СТРОГО два поля: submitted_by бэк игнорирует (ARCH-SEC-030),
    // отправлять его значило бы обещать влияние, которого нет.
    mutate({ division_id: divisionId, business_date: businessDate })
  }

  // AC-3(в): предсказание — ПРЕДВАРИТЕЛЬНОЕ. Серверный `_compute_event`
  // сравнивает ростер+интервалы-факты снапшота с предыдущей сдачей, а не
  // дельты экрана; при `previous is None` он всегда даёт CHANGED. Панель
  // обязана не обещать совпадения — оговорка идёт рядом со строкой.
  const predictedEvent =
    dirtyCount === 0 && previous !== null
      ? EVENT_LABELS.CONFIRMED_NO_CHANGES
      : EVENT_LABELS.CHANGED

  const validationDetails =
    failure?.kind === 'validation' && mutationError !== null
      ? parseValidationDetails(mutationError)
      : []

  const amendValidationDetails =
    amendFailure?.kind === 'validation' && amendMutation.error !== null
      ? parseValidationDetails(amendMutation.error)
      : []

  function handleAmendSubmit(body: DayAmendBody) {
    // ⚠️ Гарда `isPending` здесь СОЗНАТЕЛЬНО НЕТ, хотя прецедент
    // `handleConfirm` (сдача) его держит. Причина — красная проба AC-8: пока
    // гард стоял и тут, и в форме (`canSubmit = complete && !isPending`), они
    // взаимно перекрывались, и удаление ЛЮБОГО из двух оставляло тест
    // двойного клика ЗЕЛЁНЫМ. Гард, который не краснеет ни от одной мутации,
    // не защищён ни одним тестом. Единственный владелец — форма: она владеет
    // и кнопкой, и implicit submission, а сюда тело приходит уже только от
    // неё.
    // Амендить нечего, если день не сдан: без действующей версии нет и pk.
    if (current === null) return
    amendMutation.mutate(body)
  }

  // AC-1: вход в флоу есть РОВНО там, где он законен — на сданном дне и при
  // праве. Скрытие кнопки НЕ заменяет обработку 403 (AC-6): гейт живёт и на
  // сервере, а `hasPermission` до загрузки `['me']` честно отдаёт false.
  const canAmend = current !== null && hasPermission('daily_report.correct')

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-6">
        <h2 className="text-lg font-semibold leading-none tracking-tight">
          Сдача дня
        </h2>

        {isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка состояния дня…
          </p>
        ) : null}

        {isError ? (
          // Ошибка чтения — НЕ «пустой день»: 403 по ПРАВУ на списке бывает
          // (гейт миксина, views.py:120), и молчаливая трактовка «день не
          // сдан» показала бы кнопку сдачи там, где читать нельзя вовсе.
          <p role="alert" className="text-sm text-red-800">
            Не удалось прочитать состояние дня.
          </p>
        ) : null}

        {!isLoading && !isError && current !== null ? (
          <div
            data-testid="day-submission-state"
            className="flex flex-col gap-1 rounded-md bg-emerald-100 p-3 text-sm text-emerald-900"
          >
            {/* Цвет НИКОГДА не единственный сигнал (EXPERIENCE.md#L238):
                состояние названо словами. */}
            <span className="font-medium">
              День сдан: v{current.version} · {EVENT_LABELS[current.event]}
            </span>
            <span>
              {formatSubmittedAt(current.submitted_at)} · {current.submitted_by}
            </span>
            {current.late ? (
              <span>сдано с опозданием (после контрольного часа)</span>
            ) : null}
          </div>
        ) : null}

        {/* AC-1: вход в amendment. Кнопка прячется, пока форма открыта, —
            иначе рядом висели бы открывашка и уже открытая форма. */}
        {!isLoading && !isError && canAmend && !amendFormOpen ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              // ⚠️ reset() обязателен (ревью 10.6): после 409/404 форму держит
              // закрытой производная от error (`amendStale`), а error сам
              // очищается только следующим mutate — который возможен только из
              // этой же формы. Без сброса `setAmending(true)` бэйлаутится на
              // уже-true и кнопка МЁРТВАЯ до смены дня/подразделения, хотя её
              // же текст 409 зовёт «откройте исправление заново».
              onClick={() => {
                amendMutation.reset()
                setAmending(true)
              }}
            >
              {AMEND_LABEL}
            </Button>
          </div>
        ) : null}

        {amendFormOpen ? (
          <DayAmendmentForm
            businessDate={businessDate}
            isPending={amendMutation.isPending}
            onSubmit={handleAmendSubmit}
            onCancel={() => setAmending(false)}
          />
        ) : null}

        {/* 5xx, обрыв сети и 401 сюда НЕ доходят (kind === 'silent'). */}
        {amendFailure !== null && amendFailure.kind !== 'silent' ? (
          <div
            data-testid="day-amend-failure"
            role="alert"
            className="flex flex-col gap-1 rounded-md bg-red-100 p-3 text-sm text-red-800"
          >
            <span className="font-medium">{amendFailure.message}</span>
            {amendValidationDetails.length > 0 ? (
              <ul className="list-disc pl-5">
                {amendValidationDetails.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* AC-5: версии дня различимы. Причины/санкции здесь НЕТ — список даёт
            9 полей без них, а GET /{id}/ на каждую версию был бы N+1 (→10.6c);
            обещать основание, которого не читали, экран не станет. */}
        {!isLoading && !isError && dayVersions.length > 0 ? (
          <div data-testid="day-versions" className="flex flex-col gap-1 text-sm">
            <h3 className="font-medium">Версии за {businessDate}</h3>
            <ul className="flex flex-col gap-1">
              {dayVersions.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2"
                >
                  <span>
                    v{version.version} · {EVENT_LABELS[version.event]} ·{' '}
                    {formatSubmittedAt(version.submitted_at)} · {version.submitted_by}
                  </span>
                  {/* Цвет НИКОГДА не единственный сигнал (DESIGN.md:366,371):
                      действующая версия помечена СЛОВОМ. */}
                  {version.is_current ? (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
                      действующая
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Story 10.6b (AC-1, AC-3, AC-5): метка ТОЛЬКО на STALE — FRESH/
            NOT_SUMMARY/загрузка/ошибка → блока нет вовсе (enrichment, не
            первичный сигнал, зеркало `serverDrift` выше). Свежесть — ОТДЕЛЬНАЯ
            ось от цвета светофора (5-11:97): источник исключительно ответ
            `/freshness/`, не `serverDrift`/`TrafficLightStatus`. */}
        {staleness !== null ? (
          <div
            data-testid="day-summary-stale"
            role="alert"
            className="flex flex-col gap-1 rounded-md bg-amber-100 p-3 text-sm text-amber-800"
          >
            <span className="font-medium">Сводка устарела</span>
            <ul className="list-disc pl-5">
              {describeStaleness(staleness).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <span>
              Список подразделений и причин остаётся в API — экран показывает
              только факт расхождения.
            </span>
          </div>
        ) : null}

        {!isLoading && !isError && current === null && !confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">День не сдан</span>
            <Button type="button" size="sm" onClick={handleOpenConfirm}>
              {SUBMIT_LABEL}
            </Button>
          </div>
        ) : null}

        {blockedReason !== null && !confirming ? (
          <p role="alert" className="rounded-md bg-amber-100 p-3 text-sm text-amber-800">
            {blockedReason}
          </p>
        ) : null}

        {/* `current === null` — вторая половина AC-8 (ревью 10.3): после 409
            перечитка приносит «День сдан», но `confirming` остаётся true —
            без гарда открытое подтверждение с активной «Подтвердить сдачу»
            висело бы ПОД сданным днём: та же «активная обманка», которую AC-8
            запрещает для кнопки-открывашки. setConfirming(false) в эффекте
            перечитки не вариант — react-hooks/set-state-in-effect. */}
        {confirming && current === null ? (
          <div className="flex flex-col gap-2 rounded-md border border-input p-3 text-sm">
            {/* Канон-строка подтверждения — EXPERIENCE.md#L116, дословно. */}
            <p className="font-medium">
              Сдать день? Изменено {dirtyCount} из {rowCount}. После сдачи лист
              станет зелёным.
            </p>
            <p className="text-muted-foreground">
              {previous === null
                ? 'Сдач по подразделению ещё не было.'
                : `Последняя сдача подразделения: ${previous.business_date} · v${previous.version} · ${EVENT_LABELS[previous.event]}.`}
            </p>
            <p className="text-muted-foreground">
              Категория — ожидается: {predictedEvent}. Это предварительная
              оценка: окончательную категорию определяет сервер по срезу
              состава, а не по правкам экрана.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={handleConfirm}
              >
                Подтвердить сдачу
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Отмена
              </Button>
            </div>
          </div>
        ) : null}

        {isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Отправка…
          </p>
        ) : null}

        {/* 5xx, обрыв сети и 401 сюда НЕ доходят (kind === 'silent'): их уже
            обслужили общий тост useApiMutation и цепь logout providers.tsx —
            второе сообщение было бы дублем, а не помощью. */}
        {failure !== null && failure.kind !== 'silent' ? (
          <div
            data-testid="day-submission-failure"
            role="alert"
            className="flex flex-col gap-1 rounded-md bg-red-100 p-3 text-sm text-red-800"
          >
            <span className="font-medium">{failure.message}</span>
            {failure.allowed !== undefined ? (
              // Даты — ДОСЛОВНО из ответа (AC-5): зоны браузера и сервера
              // расходятся на границе суток, и пересказ своего окна солгал бы.
              <span>Допустимые даты: {failure.allowed.join(', ')}</span>
            ) : null}
            {validationDetails.length > 0 ? (
              <ul className="list-disc pl-5">
                {validationDetails.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {localDrift.length > 0 && current !== null ? (
          <div
            data-testid="day-submission-drift"
            role="alert"
            className="flex flex-col gap-1 rounded-md bg-amber-100 p-3 text-sm text-amber-800"
          >
            <span className="font-medium">
              Расход разошёлся с тем, что сдано
            </span>
            <ul className="list-disc pl-5">
              {localDrift.map((entry) => (
                <li key={entry.employeeId}>
                  {entry.fullName} · {entry.statusLabel}
                </li>
              ))}
            </ul>
            {/* Граница названа честно и намеренно: это ПОДМНОЖЕСТВО серверного
                YELLOW. Две диффалки разные — _compute_event (ростер+факты) и
                _diff_winners (derive-winners); докстринг traffic_light.py прямо
                предупреждает не путать их. Полная истина — 10.3a/10.3b. */}
            <span>
              Экран видит только правки, сделанные здесь; расхождения из других
              каналов покажет светофор подразделения.
            </span>
          </div>
        ) : null}

        {/* Story 10.3b (AC-2, AC-3): серверная правда — ОТДЕЛЬНО от локальной
            выше, не вместо. Рендерится ТОЛЬКО на YELLOW с непустым drift;
            GREEN/RED/загрузка/ошибка — панели нет вовсе (AC-3, drift —
            необязательное обогащение, не первичный сигнал). */}
        {serverDrift !== null ? (
          <div
            data-testid="day-submission-server-drift"
            role="alert"
            className="flex flex-col gap-1 rounded-md bg-amber-100 p-3 text-sm text-amber-800"
          >
            <span className="font-medium">
              Расхождение по данным сервера
            </span>
            {serverDrift.added.length > 0 ? (
              <div>
                <span>Добавлены в состав:</span>
                <ul className="list-disc pl-5">
                  {serverDrift.added.map((id) => (
                    <li key={id}>{resolveName(id, nameById)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {serverDrift.removed.length > 0 ? (
              <div>
                <span>Выбыли из состава:</span>
                <ul className="list-disc pl-5">
                  {serverDrift.removed.map((id) => (
                    <li key={id}>{resolveName(id, nameById)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {serverDrift.changed.length > 0 ? (
              <div>
                <span>Сменили статус:</span>
                <ul className="list-disc pl-5">
                  {serverDrift.changed.map((change) => (
                    <li key={change.employee_id}>
                      {resolveName(change.employee_id, nameById)} ·{' '}
                      {change.from} → {change.to}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {/* Граница названа честно (AC-6): полное серверное расхождение —
                НЕ то же самое, что локальный маркер выше (он видит только
                правки, отправленные с этого экрана). Полное множество
                включает локальное как подмножество — обе панели МОГУТ
                показаться одновременно, это не баг. */}
            <span>
              Полное расхождение по данным сервера — включает правки из
              ЛЮБОГО источника, не только с этого экрана.
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
