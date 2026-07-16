// Story 10.3 — панель «Сдача дня» (Task 4, Решение №7: отдельная
// ответственность со своими тестами). Размещение — отдельный МОДУЛЬ фичи
// daily-grid, не отдельная фича из плана стори: матрица ARCH-FE-013 банит
// кросс-фичевые импорты (features → только shared и та же фича), а панель
// живёт на странице этой фичи; контракт связи (только пропсы) сохранён.
// Submission-флоу 5.3b поверх read-модели day-state: выбор подразделения
// (автовыбор единственного) → серверный предпросмотр категории (Решение №2:
// НЕ фронт-прогноз по дельтам) → модальное подтверждение → POST create →
// состояние «сдано» с event ИЗ ОТВЕТА + drift-маркер 5.5a (Решение №3).
// Каналы ошибок — ARCH-FE-015: ветвление делает useApiMutation, панель
// рендерит из mutation.error (5xx/сеть — тост хука; 401 — цепь 8.6, панель
// НЕ перехватывает); 409 DAY_ALREADY_SUBMITTED non-overridable → состояние,
// не тупик (Решение №6). Dirty-гейт БЛОКИРУЕТ сдачу (Решение №5): снапшот
// строит бэк из БД — несохранённый ввод грида в него не попадёт.
// ARCH-FE-013: фича НЕ импортирует app; связь со страницей — только пропсы.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import type { ApiFailure } from '../../shared/api/errors'
import {
  ApiError,
  BusinessRuleError,
  ConflictError,
  ValidationError,
} from '../../shared/api/errors'
import { useApiMutation } from '../../shared/api/useApiMutation'
import { usePermissions } from '../../shared/auth/usePermissions'
import { Card } from '../../shared/ui/Card'
import {
  driftRows,
  resolvePanelState,
  selectDayState,
  summaryRows,
} from './dayState'
import type {
  AmendDayRequest,
  AmendDayResponse,
  AmendmentVM,
  DaySubmission,
  DayStateResponse,
  SelectedDayState,
  SubmitDayRequest,
  SubmitDayResponse,
} from './dayState'

export interface DaySubmissionPanelProps {
  /** Дата сдачи (ISO) — та же, что у грида страницы. */
  businessDate: string
  /** Ленивый опрос дерзости грида (DailyGridHandle.isDirty через ref страницы). */
  isDirty: () => boolean
  /** Применённых за сессию отклонений (счётчик страницы) — для предпросмотра. */
  appliedCount: number
  /** Словарь для резолва ФИО в drift-деталях (id вне списка → показать id). */
  employees: ReadonlyArray<{ id: string; fullName: string }>
}

/** Категория предпросмотра несданного дня (серверный preview_event, AC-6). */
function previewLabel(event: string): string {
  if (event === 'CONFIRMED_NO_CHANGES')
    return 'Подтверждение без изменений — срез совпадает со вчерашним.'
  if (event === 'CHANGED') return 'Срез изменился против вчера.'
  return event
}

/** Событие сданного дня (из ответа/строки day-state). */
function eventLabel(event: string): string {
  if (event === 'CONFIRMED_NO_CHANGES') return 'подтверждение без изменений'
  if (event === 'CHANGED') return 'срез изменён'
  // 10.6 AC-9: сырой код AMENDED падал в текст панели — человекочитаемо.
  if (event === 'AMENDED') return 'пересдано (amendment)'
  return event
}

/** Гейт кнопки пересдачи (AC-5): подсказка disabled-состояния — обнаружимость
 * вместо скрытия (зеркало download-гейта 10.5). */
const AMEND_DENIED_HINT =
  'Нет права на пересдачу (daily_report.correct) — обратитесь к администратору.'

/** Тело amend-мутации + адрес цепочки: submissionId уходит в URL, телом POST
 * едут ровно reason/sanction (контракт 5.8b, ни actor, ни
 * triggered_by_status_id). */
type AmendVariables = { submissionId: number } & AmendDayRequest

/** detail.allowed из 422 BUSINESS_DATE_OUT_OF_WINDOW — defensive. */
function readAllowed(details: Record<string, unknown>): string[] {
  const allowed = details.allowed
  if (!Array.isArray(allowed)) return []
  return allowed.filter((d): d is string => typeof d === 'string')
}

/** «2026-07-16T08:30:00+05:00» → «2026-07-16 08:30» (без локали — детерминизм). */
function formatSubmittedAt(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

export function DaySubmissionPanel(props: DaySubmissionPanelProps) {
  // Смена даты = НОВЫЙ жизненный цикл сдачи: remount по key сбрасывает выбор,
  // модал и «сдано» из ответа без setState-в-эффекте (react-hooks-канон).
  return <DaySubmissionPanelBody key={props.businessDate} {...props} />
}

function DaySubmissionPanelBody({
  businessDate,
  isDirty,
  appliedCount,
  employees,
}: DaySubmissionPanelProps) {
  const [selectedManual, setSelectedManual] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [dirtyHint, setDirtyHint] = useState(false)
  const [formError, setFormError] = useState(false)
  // «Сдано» ИЗ 201-ОТВЕТА (AC-8) — не прогноз и не рефетч (тот догоняет drift).
  const [submittedNow, setSubmittedNow] = useState<DaySubmission | null>(null)
  // Amendment-флоу 10.6: диалог, канал 400 внутри диалога и локальные
  // причина/санкция только что отправленной формы (201 их не несёт — 9-полевая
  // проекция; до рефетча detail.amendment строки рендерятся отсюда, AC-7).
  const [amendOpen, setAmendOpen] = useState(false)
  const [amendFormError, setAmendFormError] = useState(false)
  const [amendedMeta, setAmendedMeta] = useState<
    (AmendmentVM & { version: number }) | null
  >(null)

  const queryClient = useQueryClient()
  // Автовыбор единственного видимого подразделения (AC-5) — ДЕРИВАЦИЯ, не
  // эффект: пока оператор не выбирал руками, единственный вариант и есть выбор.
  const listData = queryClient.getQueryData<DayStateResponse>([
    'day-state',
    businessDate,
    null,
  ])
  const selected =
    selectedManual ??
    (listData !== undefined && listData.divisions.length === 1
      ? listData.divisions[0].division_id
      : null)
  // Текущий выбор для колбэков мутаций (AC-11б): 201, прилетевший ПОСЛЕ смены
  // селекта, сверяется с актуальным выбором, а не с замкнутым в колбэке.
  // Синхронизация — эффектом (react-hooks/refs банит запись в рендере);
  // колбэки мутаций асинхронны — эффект коммита успевает раньше ответа сети.
  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  // Гейт пересдачи (AC-5): правом, не ролью (Q-персона — seed не трогаем).
  const { hasPermission } = usePermissions()
  const canAmend = hasPermission('daily_report.correct')

  const query = useQuery<DayStateResponse, ApiFailure>({
    queryKey: ['day-state', businessDate, selected],
    queryFn: () =>
      apiClient.get<DayStateResponse>(
        `/api/operations/daily-submissions/day-state/?business_date=${businessDate}` +
          (selected !== null ? `&division_id=${selected}` : ''),
      ),
    // Канон L472: без авто-ретраев — ошибка сразу отдаёт явное состояние (AC-5).
    retry: false,
    // Смена division_id меняет queryKey — селект не должен пропадать в
    // loading-мигание (данные прежнего ключа держатся до прихода новых).
    placeholderData: keepPreviousData,
    // Ревью 10.3: list-ключ после автовыбора остаётся без наблюдателей —
    // дефолтный gcTime (5 мин) выбрасывал его из кэша, деривация selected
    // схлопывалась в null и queryKey скакал обратно (флаппинг + лишний
    // сетевой цикл). Кэш панели копеечный — держим всю сессию.
    gcTime: Infinity,
  })

  // Ревью 10.3: селект обязан переживать ошибку detail-запроса — иначе при
  // стабильном 5xx выбранной дивизии оператор заперт (сменить выбор нечем,
  // «Повторить» бьёт в тот же падающий ключ). Список берём из текущих данных
  // либо из list-кэша (gcTime: Infinity держит его всю сессию).
  const availableDivisions =
    query.data?.divisions ?? listData?.divisions ?? null

  const submit = useApiMutation<SubmitDayResponse, SubmitDayRequest>({
    // Обёртка вокруг POST: побочные реакции на исходы — в колбэках мутации
    // (легально), НЕ в эффектах. 409 DAY_ALREADY_SUBMITTED = СОСТОЯНИЕ дня
    // (гонка операторов, Решение №6), не тупик: рефетч day-state; сообщение
    // рендерится из mutation.error. ConflictDialog/override-протокол НЕ
    // задействуются (код non-overridable — хук кладёт его в mutation.error).
    mutationFn: async (variables) => {
      try {
        return await apiClient.post<SubmitDayResponse>(
          '/api/operations/daily-submissions/',
          variables,
        )
      } catch (err) {
        setPreviewOpen(false) // предпросмотр закрывается на любой исход-ошибку
        if (
          err instanceof ConflictError &&
          err.errorCode === 'DAY_ALREADY_SUBMITTED'
        )
          void queryClient.invalidateQueries({ queryKey: ['day-state'] })
        throw err
      }
    },
    onSuccess: (data) => {
      // Инвалидация day-state (AC-8): рефетч подтянет светофор/строку списка.
      void queryClient.invalidateQueries({ queryKey: ['day-state'] })
      // Division-гард (10.6 AC-11б, закрытие defer 10.3 L668): ответ,
      // прилетевший после смены селекта, НЕ красит панель другой дивизии.
      if (data.division_id !== selectedRef.current) return
      setSubmittedNow(data)
      setPreviewOpen(false)
    },
    onFormError: () => setFormError(true),
  })
  const { error, isPending, mutate, reset } = submit

  const amend = useApiMutation<AmendDayResponse, AmendVariables>({
    // Вторая мутация панели (10.6). Все amend-коды non-overridable →
    // mutation.error (ConflictDialog не участвует); 400 НЕ закрывает диалог
    // (ввод не терять), остальные исходы-ошибки закрывают; 409
    // DAY_ALREADY_SUBMITTED (гонка конкурентных amendments) и 422
    // NO_SUBMISSION_TO_AMEND — состояние, не тупик: рефетч day-state.
    mutationFn: async ({ submissionId, reason, sanction }) => {
      try {
        return await apiClient.post<AmendDayResponse>(
          // {id} = текущая submission; протухший pk легален — amend_day сам
          // ре-резолвит head цепочки через latest_for (view L350-351).
          `/api/operations/daily-submissions/${submissionId}/amend/`,
          { reason, sanction } satisfies AmendDayRequest,
        )
      } catch (err) {
        if (!(err instanceof ValidationError)) setAmendOpen(false)
        if (
          (err instanceof ConflictError &&
            err.errorCode === 'DAY_ALREADY_SUBMITTED') ||
          (err instanceof BusinessRuleError &&
            err.errorCode === 'NO_SUBMISSION_TO_AMEND')
        )
          void queryClient.invalidateQueries({ queryKey: ['day-state'] })
        throw err
      }
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['day-state'] })
      // Тот же division-гард, что у submit (AC-11б) — у обеих мутаций.
      if (data.division_id !== selectedRef.current) return
      // Причина/санкция — локально из только что отправленной формы (201 их
      // не несёт); версия привязывает мету к строке — рефетч с amendment
      // detail её вытеснит, сменившаяся версия её гасит.
      setAmendedMeta({
        version: data.version,
        reason: variables.reason,
        sanction: variables.sanction,
      })
      setSubmittedNow(data)
      setAmendOpen(false)
    },
    onFormError: () => setAmendFormError(true),
  })

  // Сообщение «уже сдан» — деривация из mutation.error (AC-9), не стейт.
  const alreadySubmitted =
    error instanceof ConflictError &&
    error.errorCode === 'DAY_ALREADY_SUBMITTED'

  // Ревью 10.3: в keepPreviousData-окне query.data — ответ ПРЕЖНЕГО ключа
  // (другой дивизии/list-режима): его detail (preview_event/traffic_light)
  // нельзя приписывать текущему selected — иначе модал предпросмотра покажет
  // категорию чужой дивизии (нарушение Решения №2). Гвард isPlaceholderData.
  const serverState: SelectedDayState | null =
    query.data !== undefined && selected !== null && !query.isPlaceholderData
      ? selectDayState(query.data, selected)
      : null
  // 10.6 AC-11(а): серверная строка побеждает локальный 201 при
  // server.version >= local.version (чужой amendment виден после рефетча).
  const state = resolvePanelState(serverState, submittedNow)
  // Причина/санкция: серверный detail.amendment; до его прихода — локальная
  // мета только что отправленной формы, привязанная к версии (AC-7/AC-9).
  const displayedAmendment: AmendmentVM | null =
    state?.kind === 'submitted'
      ? (state.amendment ??
        (amendedMeta !== null && state.submission.version === amendedMeta.version
          ? { reason: amendedMeta.reason, sanction: amendedMeta.sanction }
          : null))
      : null

  const handleSubmitClick = useCallback(() => {
    // Dirty-гейт (AC-7): снапшот сдачи строит БЭК из БД — несохранённые
    // дельты грида в него не попадут; блок с подсказкой, НЕ авто-сохранение.
    if (isDirty()) {
      setDirtyHint(true)
      return
    }
    setDirtyHint(false)
    setFormError(false)
    setPreviewOpen(true)
  }, [isDirty])

  // Смена подразделения руками = новый цикл: артефакты прежнего — в мусор
  // (setState в обработчике события — легально, в отличие от эффекта).
  // Ревью 10.3: reset() обязателен — иначе баннер 422/«уже сдан» (деривация
  // из mutation.error) переезжает в контекст ДРУГОЙ дивизии.
  const { reset: amendReset } = amend
  const handleSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedManual(
        event.target.value === '' ? null : event.target.value,
      )
      setSubmittedNow(null)
      setPreviewOpen(false)
      setDirtyHint(false)
      setFormError(false)
      reset()
      // Артефакты amend-цикла (10.6) — тоже в мусор: свой reset при смене
      // селекта (баннер 409/422 не переезжает в контекст другой дивизии).
      setAmendOpen(false)
      setAmendFormError(false)
      setAmendedMeta(null)
      amendReset()
    },
    [reset, amendReset],
  )

  const handleConfirm = useCallback(() => {
    if (selected === null) return
    setFormError(false)
    // Тело — ровно два поля контракта 5.8a (actor — из auth, ARCH-SEC-030).
    mutate({ division_id: selected, business_date: businessDate })
  }, [selected, businessDate, mutate])

  const nameById: Record<string, string> = {}
  for (const e of employees) nameById[e.id] = e.fullName

  // Имена детей для осей сводки (AC-10) — словарь divisions ответа day-state;
  // id вне словаря → показать id (fallback-канон 10.3).
  const divisionNameById: Record<string, string> = {}
  for (const d of availableDivisions ?? [])
    divisionNameById[d.division_id] = d.name

  // Каналы ошибок amend (AC-8) — деривации из mutation.error, не стейт.
  const amendError = amend.error
  const amendRaced =
    amendError instanceof ConflictError &&
    amendError.errorCode === 'DAY_ALREADY_SUBMITTED'

  return (
    <Card
      className="flex flex-col gap-2 p-3"
      data-testid="day-submission-panel"
    >
      <h2 className="text-lg font-semibold">Сдача дня</h2>

      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Загрузка состояния сдачи…
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {availableDivisions !== null && (
            <label className="flex items-center gap-2">
              Подразделение
              <select
                aria-label="Подразделение"
                className="rounded border px-2 py-1"
                value={selected ?? ''}
                onChange={handleSelectChange}
              >
                <option value="">— выберите —</option>
                {availableDivisions.map((d) => (
                  <option key={d.division_id} value={d.division_id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {query.isError ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 text-sm"
            >
              <span>Не удалось загрузить состояние сдачи.</span>
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={() => void query.refetch()}
              >
                Повторить
              </button>
            </div>
          ) : query.data !== undefined ? (
            <>
          {alreadySubmitted && (
            <p role="status" className="text-amber-700">
              День уже сдан (другим оператором или ранее) — состояние
              обновлено.
            </p>
          )}
          {formError && (
            <div
              role="alert"
              className="rounded border border-red-300 p-2"
            >
              Запрос отклонён: проверьте данные формы.
            </div>
          )}
          {error instanceof BusinessRuleError &&
            (error.errorCode === 'BUSINESS_DATE_OUT_OF_WINDOW' ? (
              <div role="alert" className="rounded border border-red-300 p-2">
                Дата вне окна сдачи. Допустимые даты:{' '}
                {readAllowed(error.details).join(', ')}
              </div>
            ) : (
              <div role="alert" className="rounded border border-red-300 p-2">
                {error.message}
              </div>
            ))}
          {error instanceof ConflictError &&
            error.errorCode !== 'DAY_ALREADY_SUBMITTED' && (
              <div role="alert" className="rounded border border-amber-300 p-2">
                {error.message}
              </div>
            )}
          {/* Базовый ApiError (403/404 и прочие конвертные не-спецклассы).
              401 НЕ рендерится — его обслуживает цепь 8.6 (AC-11); 5xx/сеть
              сюда не попадают (ServerError/NetworkError — тост хука). */}
          {error instanceof ApiError &&
            error.kind === 'api' &&
            error.status !== 401 && (
              <div role="alert" className="rounded border border-red-300 p-2">
                {error.message}
              </div>
            )}

          {/* Каналы amend-мутации (10.6 AC-8): 409-гонка = состояние (не
              тупик), 422/403/404 — баннеры; 400 рендерится ВНУТРИ диалога;
              5xx/сеть — тост хука; 401 — цепь 8.6, панель молчит. */}
          {amendRaced && (
            <p role="status" className="text-amber-700">
              Пересдача уже выполнена (конкурентная пересдача) — состояние
              обновлено.
            </p>
          )}
          {amendError instanceof BusinessRuleError && (
            <div role="alert" className="rounded border border-red-300 p-2">
              {amendError.message}
            </div>
          )}
          {amendError instanceof ConflictError && !amendRaced && (
            <div role="alert" className="rounded border border-amber-300 p-2">
              {amendError.message}
            </div>
          )}
          {amendError instanceof ApiError &&
            amendError.kind === 'api' &&
            amendError.status !== 401 && (
              <div role="alert" className="rounded border border-red-300 p-2">
                {amendError.message}
              </div>
            )}

          {state === null ? (
            <p role="status" className="text-muted-foreground">
              {selected === null
                ? 'Выберите подразделение, чтобы увидеть состояние сдачи.'
                : // keepPreviousData-окно: данные текущего ключа ещё в полёте
                  'Загрузка состояния сдачи…'}
            </p>
          ) : state.kind === 'unsubmitted' ? (
            <div className="flex flex-col items-start gap-2">
              <p>
                День не сдан.{' '}
                {state.previewEvent !== '' && previewLabel(state.previewEvent)}
              </p>
              {dirtyHint && (
                <p role="alert" className="text-amber-700">
                  Сначала сохраните изменения — несохранённые отклонения не
                  попадут в снапшот сдачи.
                </p>
              )}
              <button
                type="button"
                className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                // Ревью 10.3 (Решение №2): без серверной категории сдача
                // вслепую запрещена — пустой previewEvent = detail ещё не
                // приехал (или сервер его не дал) → кнопка заблокирована.
                disabled={state.previewEvent === ''}
                onClick={handleSubmitClick}
              >
                Сдать день
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p role="status">
                <span>День сдан: {eventLabel(state.submission.event)}</span>{' '}
                <span>версия {state.submission.version}</span>{' '}
                {/* Различимость v1/v2+ (AC-9): v1 — без бейджа. */}
                {(state.submission.version >= 2 ||
                  state.submission.event === 'AMENDED') && (
                  <span className="rounded border border-sky-400 px-1">
                    Пересдача
                  </span>
                )}{' '}
                <span>{formatSubmittedAt(state.submission.submitted_at)}</span>{' '}
                {state.submission.late && (
                  <span className="rounded border border-amber-400 px-1">
                    с опозданием
                  </span>
                )}
              </p>
              {displayedAmendment !== null && (
                <div data-testid="amendment-details">
                  <p>Причина: {displayedAmendment.reason}</p>
                  <p>Санкция: {displayedAmendment.sanction}</p>
                </div>
              )}
              {/* Маркер свежести сводки (AC-10): STALE — alert с осями,
                  FRESH — тихая пометка, null — строка не сводка, молчим. */}
              {state.summary !== null &&
                (state.summary.status === 'STALE' ? (
                  <div role="alert" className="flex flex-col gap-1">
                    <span>
                      Сводка протухла — состояние детей разошлось с пинами:
                    </span>
                    <ul data-testid="summary-details" className="list-disc pl-5">
                      {summaryRows(state.summary, divisionNameById).map(
                        (row) => (
                          <li key={row.key}>{row.label}</li>
                        ),
                      )}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground">Сводка актуальна</p>
                ))}
              {state.trafficLight !== null &&
                (state.trafficLight.status === 'YELLOW' ? (
                  <div role="alert" className="flex flex-col gap-1">
                    <span>
                      Расход разошёлся со сданным снапшотом — детали:
                    </span>
                    <ul data-testid="drift-details" className="list-disc pl-5">
                      {driftRows(
                        state.trafficLight.drift ?? {
                          added: [],
                          removed: [],
                          changed: [],
                        },
                        nameById,
                      ).map((row) => (
                        <li key={row.key}>{row.label}</li>
                      ))}
                    </ul>
                  </div>
                ) : state.trafficLight.status === 'GREEN' ? (
                  <p className="text-muted-foreground">Расхождений нет.</p>
                ) : null)}
              <div className="flex gap-2">
                {/* Ручное обновление (AC-12): polling — 10.4, здесь refetch. */}
                <button
                  type="button"
                  className="rounded border px-3 py-1"
                  onClick={() => void query.refetch()}
                >
                  Обновить
                </button>
                {/* Запрос пересдачи (AC-5): гейт правом; без права —
                    disabled с подсказкой, НЕ скрыта (зеркало 10.5). */}
                <button
                  type="button"
                  className="rounded border px-3 py-1 disabled:opacity-50"
                  disabled={!canAmend}
                  title={canAmend ? undefined : AMEND_DENIED_HINT}
                  onClick={() => {
                    setAmendFormError(false)
                    setAmendOpen(true)
                  }}
                >
                  Запросить пересдачу
                </button>
              </div>
            </div>
          )}
            </>
          ) : null}
        </div>
      )}

      {previewOpen && state?.kind === 'unsubmitted' && (
        <SubmitPreviewDialog
          category={state.previewEvent}
          appliedCount={appliedCount}
          pending={isPending}
          onConfirm={handleConfirm}
          onCancel={() => setPreviewOpen(false)}
        />
      )}

      {amendOpen && state?.kind === 'submitted' && (
        <AmendRequestDialog
          pending={amend.isPending}
          formError={amendFormError}
          onConfirm={(reason, sanction) => {
            setAmendFormError(false)
            amend.mutate({
              // Протухший pk легален: amend ре-резолвит head цепочки.
              submissionId: state.submission.id,
              reason,
              sanction,
            })
          }}
          onCancel={() => {
            setAmendOpen(false)
            setAmendFormError(false)
          }}
        />
      )}
    </Card>
  )
}

/** Модальный запрос пересдачи (10.6 AC-6): нативный <dialog> + showModal —
 * зеркало SubmitPreviewDialog (guard по .open, Esc/onCancel). «Подтвердить»
 * заперт, пока причина/санкция пусты после trim, и на isPending. */
function AmendRequestDialog({
  pending,
  formError,
  onConfirm,
  onCancel,
}: {
  pending: boolean
  formError: boolean
  onConfirm: (reason: string, sanction: string) => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const [reason, setReason] = useState('')
  const [sanction, setSanction] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const filled = reason.trim() !== '' && sanction.trim() !== ''

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h3 id={titleId}>Запрос пересдачи дня</h3>
      <p>
        Пересдача создаст версию N+1; снапшот пересобирается из текущей БД;
        действующий расход потребует нового выпуска «взамен».
      </p>
      {formError && (
        <div role="alert" className="rounded border border-red-300 p-2">
          Запрос отклонён: проверьте данные формы.
        </div>
      )}
      <label className="flex flex-col gap-1">
        Причина
        <textarea
          aria-label="Причина"
          className="rounded border px-2 py-1"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        Санкция
        <input
          aria-label="Санкция"
          className="rounded border px-2 py-1"
          maxLength={255}
          value={sanction}
          onChange={(event) => setSanction(event.target.value)}
        />
      </label>
      <button type="button" onClick={onCancel}>
        Отмена
      </button>
      <button
        type="button"
        disabled={pending || !filled}
        onClick={() => onConfirm(reason.trim(), sanction.trim())}
      >
        Подтвердить
      </button>
    </dialog>
  )
}

/** Модальный предпросмотр сдачи (AC-6): нативный <dialog> + showModal —
 * фокус-трап/Escape/возврат фокуса нативно (ARIA-паттерн ConflictDialog). */
function SubmitPreviewDialog({
  category,
  appliedCount,
  pending,
  onConfirm,
  onCancel,
}: {
  category: string
  appliedCount: number
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()

  // showModal — только в эффекте (в рендере узла ещё нет); guard по .open —
  // StrictMode-идемпотентность (Ловушка 7, зеркало ConflictDialog).
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h3 id={titleId}>Сдача дня — подтверждение</h3>
      <p>{previewLabel(category)}</p>
      <p>Применено отклонений за сессию: {appliedCount}</p>
      <p>
        После сдачи изменения фиксируются снапшотом; пересдача — только через
        amendment.
      </p>
      <button type="button" onClick={onCancel}>
        Отмена
      </button>
      <button type="button" disabled={pending} onClick={onConfirm}>
        Подтвердить
      </button>
    </dialog>
  )
}
