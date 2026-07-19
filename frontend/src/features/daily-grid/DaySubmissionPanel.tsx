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
// - amendment/пересдачи: отдельное право daily_report.correct → 10.6. Отказ 409
//   НАЗЫВАЕТ путь, но не притворяется, что умеет его пройти;
// - модалки: модальность в jsdom не эмулируется (дефер 9.5/9.9), модальный
//   ассерт был бы вакуумным до e2e 10.10 → инлайн-панель (Решение №5).
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import { useApiMutation } from '../../shared/api/useApiMutation'
import { Button } from '../../shared/ui/Button'
import { Card, CardContent } from '../../shared/ui/Card'
import { parseValidationDetails } from './bulkErrors'
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
  /** Текущая сдача дня. Владелец запроса — ЭКРАН (Решение №7), не панель. */
  submission: DaySubmission | null
  isLoading: boolean
  isError: boolean
}

/** Канон-строка кнопки сдачи — EXPERIENCE.md#L103. */
const SUBMIT_LABEL = 'Сдать день'

/** Дата-время сдачи в локальной зоне читателя (submitted_at приходит с офсетом). */
function formatSubmittedAt(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('ru-RU')
}

export function DaySubmissionPanel({
  divisionId,
  businessDate,
  dateValid,
  rowCount,
  dirtyCount,
  localDrift,
  submission,
  isLoading,
  isError,
}: DaySubmissionPanelProps) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  // Ответ ПОСЛЕДНЕЙ успешной сдачи — «результат действия» для мгновенного
  // показа события (ARCH-FE-010 это разрешает); истина о дне всё равно
  // перечитывается инвалидацией ниже.
  const [submitted, setSubmitted] = useState<DaySubmission | null>(null)
  // Причина отказа ДО отправки (гарды AC-4/AC-5): пишется по клику, чтобы
  // объяснение появлялось в ответ на действие, а не висело фоном.
  const [blockedReason, setBlockedReason] = useState<string | null>(null)

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
    },
  })

  const { error: mutationError, isPending, mutate } = mutation

  const failure = mutationError === null ? null : describeSubmitFailure(mutationError)

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

  const current = submitted ?? submission

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
      </CardContent>
    </Card>
  )
}
