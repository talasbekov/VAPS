// Story 10.5 — экран №3 «Расход» (/reports, контракт 10-02): выбор даты /
// пресет «на завтра», текущий выпуск за дату (point-lookup 6.10a; 404 =
// доменное состояние «не выпущен», НЕ ошибка), выпуск нумерованного .docx
// (POST 6.10a; карточка ИЗ 201-ответа), блок-панель «кто не сдал» из 422
// TOMORROW_BLOCKED (laggards UUID-only by-design, контракт §5.2/Q7), журнал
// выпусков (GET history 10.5) с цепочкой «взамен исх.№», скачивание через
// download-канал 6.7 за правом document.view (disabled с подсказкой — не
// скрывать, обнаружимость; Q-OMD).
// Каналы ошибок — ARCH-FE-015: ветвление делает useApiMutation (все коды
// выпуска non-overridable → mutation.error; ConflictDialog НЕ участвует;
// 5xx/сеть — тост хука; 401 — цепь 8.6, экран не перехватывает).
// ARCH-FE-013: своя фича-директория; из daily-grid/readiness-tree НИЧЕГО не
// импортируется (date-хелперы — осознанный дубль в expenseReport.ts).
import { useCallback, useState } from 'react'
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import { downloadAttachment } from '../../shared/api/download'
import type { ApiFailure } from '../../shared/api/errors'
import {
  ApiError,
  BusinessRuleError,
  ConflictError,
} from '../../shared/api/errors'
import { useApiMutation } from '../../shared/api/useApiMutation'
import { usePermissions } from '../../shared/auth/usePermissions'
import { Card } from '../../shared/ui/Card'
import {
  addDaysIso,
  buildFileName,
  issueErrorText,
  issueLabel,
  readConvergenceFindings,
  readLaggards,
  statusLabel,
  supersedesLabel,
  todayLocalIso,
} from './expenseReport'
import type {
  ExpenseHistoryResponse,
  HistoryIssue,
  IssueExpenseRequest,
  IssuedExpenseReport,
} from './expenseReport'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const DOWNLOAD_DENIED_HINT = 'Нет права на скачивание'

export function ExpenseReportPage() {
  const [businessDate, setBusinessDate] = useState(todayLocalIso)
  const [selectedManual, setSelectedManual] = useState<string | null>(null)
  // Карточка ИЗ 201-ОТВЕТА (AC-7) — не прогноз и не рефетч (point-lookup
  // после инвалидации лишь подтверждает; источник карточки — ответ выпуска).
  const [issuedNow, setIssuedNow] = useState<IssuedExpenseReport | null>(null)
  const [formError, setFormError] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const queryClient = useQueryClient()
  // Гейт скачивания — право document.view (download-канал 6.7); у держателя
  // только generate (OMD, Q-OMD) кнопки disabled с подсказкой, НЕ скрыты.
  const { hasPermission } = usePermissions()
  const canDownload = hasPermission('document.view')

  // Автовыбор единственного видимого подразделения (зеркало 10.3) —
  // ДЕРИВАЦИЯ из list-ключа, не эффект; >1 видимых → явный выбор (Q-дефолт).
  const listData = queryClient.getQueryData<ExpenseHistoryResponse>([
    'expense-history',
    null,
  ])
  const selected =
    selectedManual ??
    (listData !== undefined && listData.divisions.length === 1
      ? listData.divisions[0].division_id
      : null)

  const validDate = ISO_DATE_RE.test(businessDate)

  const historyQuery = useQuery<ExpenseHistoryResponse, ApiFailure>({
    queryKey: ['expense-history', selected],
    queryFn: () =>
      apiClient.get<ExpenseHistoryResponse>(
        '/api/operations/expense-reports/history/' +
          (selected !== null ? `?division_id=${selected}` : ''),
      ),
    // Канон L472: без авто-ретраев — ошибка сразу отдаёт явное состояние.
    retry: false,
    // Смена подразделения меняет queryKey — журнал прежнего ключа держится
    // до прихода нового ответа (без loading-мигания).
    placeholderData: keepPreviousData,
    // list-ключ после автовыбора остаётся без наблюдателей — дефолтный gcTime
    // выбрасывал бы его и деривация selected схлопывалась (урок ревью 10.3).
    gcTime: Infinity,
  })

  const currentQuery = useQuery<IssuedExpenseReport, ApiFailure>({
    queryKey: ['expense-current', selected, businessDate],
    queryFn: () =>
      apiClient.get<IssuedExpenseReport>(
        `/api/operations/expense-reports/?division_id=${selected}` +
          `&business_date=${businessDate}`,
      ),
    enabled: selected !== null && validDate,
    // 404 «не выпущен» — доменное состояние, ретраи только размазали бы его.
    retry: false,
  })

  const issue = useApiMutation<IssuedExpenseReport, IssueExpenseRequest>({
    mutationFn: async (variables) => {
      try {
        return await apiClient.post<IssuedExpenseReport>(
          '/api/operations/expense-reports/',
          variables,
        )
      } catch (err) {
        // 409 DOCUMENT_ALREADY_ISSUED = СОСТОЯНИЕ дня (гонка/повтор), не
        // тупик (зеркало решения №6 стори 10.3): рефетч point-lookup строит
        // карточку «выпущен»; сообщение рендерится из mutation.error.
        if (
          err instanceof ConflictError &&
          err.errorCode === 'DOCUMENT_ALREADY_ISSUED'
        ) {
          void queryClient.invalidateQueries({ queryKey: ['expense-current'] })
          void queryClient.invalidateQueries({ queryKey: ['expense-history'] })
        }
        throw err
      }
    },
    onSuccess: (data) => {
      setIssuedNow(data)
      // Инвалидация обеих queries (AC-7): журнал показывает новую строку,
      // point-lookup подтверждает состояние «выпущен».
      void queryClient.invalidateQueries({ queryKey: ['expense-current'] })
      void queryClient.invalidateQueries({ queryKey: ['expense-history'] })
    },
    onFormError: () => setFormError(true),
  })
  const { error, isPending, mutate, reset } = issue

  // Смена контекста (дата/подразделение) = новый цикл выпуска: артефакты
  // прежнего — в мусор; reset() обязателен, иначе баннер переезжает в чужой
  // контекст (урок ревью 10.3).
  const resetCycle = useCallback(() => {
    setIssuedNow(null)
    setFormError(false)
    setDownloadError(null)
    reset()
  }, [reset])

  const handleDateChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setBusinessDate(event.target.value)
      resetCycle()
    },
    [resetCycle],
  )

  const handleTomorrow = useCallback(() => {
    setBusinessDate(addDaysIso(todayLocalIso(), 1))
    resetCycle()
  }, [resetCycle])

  const handleSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedManual(event.target.value === '' ? null : event.target.value)
      resetCycle()
    },
    [resetCycle],
  )

  const handleIssue = useCallback(() => {
    if (selected === null) return
    setFormError(false)
    // Тело — ровно два поля контракта 6.10a (actor — из auth, ARCH-SEC-030).
    mutate({ division_id: selected, business_date: businessDate })
  }, [selected, businessDate, mutate])

  const handleDownload = useCallback(
    async (attachmentId: string, fallbackName: string) => {
      setDownloadError(null)
      try {
        await downloadAttachment(attachmentId, fallbackName)
      } catch (err) {
        // Не-2xx/сеть download-канала — сообщение экрана (AC-11, не молчание);
        // тостов у прямого fetch нет — канал мутаций не задействован.
        setDownloadError(err instanceof Error ? err.message : String(err))
      }
    },
    [],
  )

  const divisions = historyQuery.data?.divisions ?? listData?.divisions ?? []

  // 404 ENTITY_NOT_FOUND point-lookup — состояние «не выпущен» (AC-6).
  const notIssued =
    currentQuery.error instanceof ApiError &&
    currentQuery.error.status === 404 &&
    currentQuery.error.errorCode === 'ENTITY_NOT_FOUND'
  // Прочие доменные ошибки point-lookup → баннер; 5xx/сеть/401 — каналы
  // хука/клиента (ARCH-FE-015), экран их не дублирует.
  const currentDomainError =
    currentQuery.error instanceof ApiError &&
    !notIssued &&
    currentQuery.error.kind !== 'server' &&
    currentQuery.error.status !== 401
      ? currentQuery.error
      : null
  const historyDomainError =
    historyQuery.error instanceof ApiError &&
    historyQuery.error.kind !== 'server' &&
    historyQuery.error.status !== 401
      ? historyQuery.error
      : null

  // Гард гонки (ревью 10.5, blind+edge): reset() не отменяет POST в полёте —
  // onSuccess может поставить issuedNow УЖЕ ПОСЛЕ смены даты/подразделения.
  // Стейл-карточка чужого контекста отфильтровывается на рендере.
  const issuedNowForContext =
    issuedNow !== null &&
    issuedNow.business_date === businessDate &&
    issuedNow.division_id === selected
      ? issuedNow
      : null
  const issuedCard: IssuedExpenseReport | null =
    issuedNowForContext ?? currentQuery.data ?? null

  const laggards =
    error instanceof BusinessRuleError && error.errorCode === 'TOMORROW_BLOCKED'
      ? readLaggards(error.details)
      : null

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <h1 className="text-2xl font-semibold leading-none tracking-tight">
          Расход
        </h1>
        <label className="flex items-center gap-2 text-sm">
          Дата
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={businessDate}
            onChange={handleDateChange}
          />
        </label>
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={handleTomorrow}
        >
          На завтра
        </button>
        <label className="flex items-center gap-2 text-sm">
          Подразделение
          <select
            aria-label="Подразделение"
            className="rounded border px-2 py-1"
            value={selected ?? ''}
            onChange={handleSelectChange}
          >
            <option value="">— выберите —</option>
            {divisions.map((d) => (
              <option key={d.division_id} value={d.division_id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {/* Формат выпуска: только .docx — канал .xlsx на бэке не подключён
            (контракт Q1 не подписан; Out of Scope). */}
        <span className="text-sm text-muted-foreground">
          Формат: .docx (официальный)
        </span>
      </Card>

      <Card className="flex flex-col gap-2 p-3" data-testid="current-issue">
        <h2 className="text-lg font-semibold">Расход за дату</h2>

        {downloadError !== null && (
          <div role="alert" className="rounded border border-red-300 p-2 text-sm">
            Не удалось скачать файл: {downloadError}
          </div>
        )}
        {formError && (
          <div role="alert" className="rounded border border-red-300 p-2 text-sm">
            Запрос отклонён: проверьте данные формы.
          </div>
        )}
        {laggards !== null && (
          <section
            data-testid="laggards-panel"
            aria-label="Не готово: кто не сдал"
            className="flex flex-col gap-1 rounded border border-amber-400 p-2 text-sm"
          >
            <h3 className="font-semibold">Не готово: кто не сдал</h3>
            <p>{error !== null && error.message}</p>
            <p>Не сдали: {laggards.length}</p>
            {/* Имён у бэка НЕТ by-design (laggards UUID-only, контракт §5.2/Q7). */}
            <ul className="list-disc pl-5">
              {laggards.map((uuid) => (
                <li key={uuid}>подразделение {uuid}</li>
              ))}
            </ul>
          </section>
        )}
        {error instanceof BusinessRuleError &&
          error.errorCode === 'REPORT_NOT_CONVERGENT' && (
            <div
              role="alert"
              className="flex flex-col gap-1 rounded border border-red-300 p-2 text-sm"
            >
              <span>{error.message}</span>
              <ul className="list-disc pl-5">
                {readConvergenceFindings(error.details).map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            </div>
          )}
        {error instanceof BusinessRuleError &&
          error.errorCode !== 'TOMORROW_BLOCKED' &&
          error.errorCode !== 'REPORT_NOT_CONVERGENT' && (
            <div role="alert" className="rounded border border-red-300 p-2 text-sm">
              {error.message}
            </div>
          )}
        {/* 409 выпуска (not-ready / already-issued) — non-overridable
            состояния, не тосты и не ConflictDialog (ARCH-FE-015). */}
        {error instanceof ConflictError && (
          <p role="status" className="text-sm text-amber-700">
            {issueErrorText(error.errorCode, error.message)}
          </p>
        )}
        {error instanceof ApiError &&
          error.kind === 'api' &&
          error.status !== 401 && (
            <div role="alert" className="rounded border border-red-300 p-2 text-sm">
              {error.message}
            </div>
          )}

        {selected === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Выберите подразделение, чтобы увидеть выпуск за дату.
          </p>
        ) : !validDate ? (
          // Очищенный date-input — валидное действие пользователя (ревью
          // 10.5, edge): подсказка вместо ложной «Загрузки…» (query disabled).
          <p role="status" className="text-sm text-muted-foreground">
            Укажите дату, чтобы увидеть выпуск.
          </p>
        ) : issuedCard !== null ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p role="status" className="font-medium">
              {`Выпущен: ${issueLabel(issuedCard)}`}
            </p>
            <p className="text-muted-foreground">
              {`Дата расхода: ${issuedCard.business_date}, статус: ${statusLabel(issuedCard.status)}`}
            </p>
            <button
              type="button"
              className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
              disabled={!canDownload}
              title={canDownload ? undefined : DOWNLOAD_DENIED_HINT}
              onClick={() =>
                void handleDownload(
                  issuedCard.attachment_id,
                  buildFileName(issuedCard),
                )
              }
            >
              Скачать .docx
            </button>
          </div>
        ) : currentDomainError !== null ? (
          <div role="alert" className="rounded border border-red-300 p-2 text-sm">
            {currentDomainError.message}
          </div>
        ) : notIssued ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p role="status">Расход за дату не выпущен.</p>
            <button
              type="button"
              className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
              disabled={isPending}
              onClick={handleIssue}
            >
              Сформировать
            </button>
          </div>
        ) : currentQuery.isError ? (
          // 5xx/сеть point-lookup — явное состояние с повтором (ревью 10.5,
          // blind+edge): тостов у queries нет (канал хука — только мутации),
          // вечная «Загрузка…» была бы ложью. Зеркало fallback-канона 10.4.
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded border border-red-300 p-2 text-sm"
          >
            <span>Не удалось загрузить выпуск за дату.</span>
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => void currentQuery.refetch()}
            >
              Повторить запрос
            </button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка выпуска…
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-3" data-testid="issues-journal">
        <h2 className="text-lg font-semibold">Журнал выпусков</h2>
        {historyQuery.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Загрузка журнала…
          </p>
        ) : historyQuery.isError ? (
          // Единая ошибочная ветка журнала (ревью 10.5, blind+edge): доменная
          // ошибка несёт message бэка, 5xx/сеть — generic-текст; в обоих
          // случаях есть «Повторить» (раньше 5xx падал в тупик без retry).
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded border border-red-300 p-2 text-sm"
          >
            <span>
              {historyDomainError !== null
                ? historyDomainError.message
                : 'Не удалось загрузить журнал.'}
            </span>
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => void historyQuery.refetch()}
            >
              Повторить
            </button>
          </div>
        ) : historyQuery.data !== undefined ? (
          historyQuery.data.issues.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              Расходы ещё не формировались
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-2 py-1">Исх.№</th>
                    <th className="px-2 py-1">Дата расхода</th>
                    <th className="px-2 py-1">Статус</th>
                    <th className="px-2 py-1">Примечание</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {historyQuery.data.issues.map((issue_) => (
                    <JournalRow
                      key={issue_.id}
                      issue={issue_}
                      canDownload={canDownload}
                      onDownload={handleDownload}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Данные недоступны.
          </p>
        )}
      </Card>
    </div>
  )
}

/** Строка журнала: Исх.№, дата, бейдж статуса, «взамен исх.№ N» + reason,
 * «Скачать» (гейт document.view — disabled с подсказкой, не скрыт). */
function JournalRow({
  issue,
  canDownload,
  onDownload,
}: {
  issue: HistoryIssue
  canDownload: boolean
  onDownload: (attachmentId: string, fallbackName: string) => Promise<void>
}) {
  return (
    <tr data-testid={`issue-row-${issue.id}`} className="border-t">
      <td className="px-2 py-1 font-medium">{issueLabel(issue)}</td>
      <td className="px-2 py-1">{issue.business_date}</td>
      <td className="px-2 py-1">
        <span
          className={
            issue.status === 'ISSUED'
              ? 'rounded border border-green-500 px-1 text-xs'
              : 'rounded border border-gray-400 px-1 text-xs text-muted-foreground'
          }
        >
          {statusLabel(issue.status)}
        </span>
      </td>
      <td className="px-2 py-1">
        <span className="flex flex-col">
          {issue.supersedes !== null && (
            <span>{supersedesLabel(issue.supersedes)}</span>
          )}
          {issue.reason !== '' && (
            <span className="text-muted-foreground">{issue.reason}</span>
          )}
        </span>
      </td>
      <td className="px-2 py-1">
        <button
          type="button"
          aria-label={`Скачать ${issueLabel(issue)}`}
          className="rounded border px-2 py-0.5 disabled:opacity-50"
          disabled={!canDownload}
          title={canDownload ? undefined : DOWNLOAD_DENIED_HINT}
          onClick={() =>
            void onDownload(issue.attachment_id, buildFileName(issue))
          }
        >
          Скачать
        </button>
      </td>
    </tr>
  )
}
