// Стори 10.5 — экран `/reports`: чтение выпущенного расхода за дату, выпуск
// одним действием и скачивание официального .docx. Заменил `ReportsStub`.
//
// Чего здесь осознанно НЕТ (семь фантомов макета `key-rashod.html` и
// EXPERIENCE.md — каждый с именем преемника, это отказы, а не недоделки):
//  1. переключателя формата `.docx/.xlsx/.pdf` — `issue_expense_document` зовёт
//     `generate_expense_docx` БЕЗУСЛОВНО (`document_release_service.py:250`),
//     `format`-параметра нет нигде в схеме                       → 10.5d (бэк);
//  2. журнала выпусков и цепочки «взамен исх.№ N» — `IssuedDocument.supersedes`
//     живёт в модели, но отсутствует во ВСЕХ сериализаторах, а
//     `GET /expense-reports/` — point-lookup (один объект или 404), не список
//                                              → 10.5b (бэк) → 10.5c (UI);
//  3. поля «Исх. №» и тумблера «черновик/ФИНАЛ» — тело выпуска РОВНО
//     `{division_id, business_date}`, номер выдаёт `DocumentSequence` под
//     row-локом на бэке: клиент его не подаёт и не может      → закрыто по факту;
//  4. «Скачать черновик» — draft-эндпоинта не существует        → контракт Q5;
//  5. «отв.: кап. Дамир», кнопки «Напомнить» и per-лист светофора — `laggards`
//     это плоский org-wide список UUID БЕЗ имён by design
//     (`tomorrow_gate.py:31-32`), цепочки «дивизион→ответственный» не
//     существует вовсе (контракт §5.2)                        → контракт Q4/Q7;
//  6. прогресс-бара, polling'а и «Повторить» асинхронной джобы — спайк 6.6
//     замерил полный путь в 38.5 мс и решил СИНХРОННО; Celery в проекте нет
//                                             → `ARCH-DEFERRED-048` (числовой);
//  7. текста `MARKS_INCOMPLETE` — 0 raise-сайтов в бэке, живёт донор-константой
//     в `error-codes.yaml`; живой per-division отказ — 409
//     `REPORT_NOT_READY_FOR_DATE`                     → закрыто контрактом §5.1.
//
// Обход блокировки «на завтра» — стори **10.5a**: другой эндпоинт
// (`override-tomorrow-block/`), другое право (`daily_report.override_block`),
// другой механизм (не `override:true`-ретрай — `TOMORROW_BLOCKED` это 422, а
// `useApiMutation.conflict` поднимается только на 409 overridable) и
// необратимость (day-level, org-wide, без отзыва). Экран здесь только
// ОБЪЯСНЯЕТ блокировку.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '../../shared/api/client'
import { useApiMutation } from '../../shared/api/useApiMutation'
import type { ApiFailure } from '../../shared/api/errors'
import type { paths } from '../../shared/api/schema'
import { Button } from '../../shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader } from '../../shared/ui/Card'
import { Input } from '../../shared/ui/Input'
import { Label } from '../../shared/ui/Label'
import {
  describeDownloadFailure,
  describeIssueFailure,
  expenseFileName,
  issueSuccessMessage,
  parseIssuedReport,
  todayLocalIso,
} from './expense'
import type { ExpenseIssueBody, IssuedExpenseReport } from './expense'

type DivisionsResponse =
  paths['/api/core/divisions/']['get']['responses']['200']['content']['application/json']

const EXPENSE_PATH = '/api/operations/expense-reports/'
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Канон-строки — дословно, не сочинять. */
const HEADING = 'Отчёты'
const CARD_DESCRIPTION = 'Формирование официального расхода ЛС'
const ISSUE_LABEL = 'Сформировать'
const DOWNLOAD_LABEL = 'Скачать'
const NOT_ISSUED_TEXT = 'Расход за эту дату не выпускался'
const CHOOSE_DIVISION_TEXT = 'Выберите подразделение'
const READ_ERROR_TEXT = 'Не удалось загрузить сведения о расходе.'
const LOADING_TEXT = 'Загрузка сведений о расходе…'
const BLOCKED_HEADING = 'Не готово'

/** Подписи `IssuedExpenseReportStatusEnum` — дословно из схемы. */
const STATUS_LABELS: Record<IssuedExpenseReport['status'], string> = {
  ISSUED: 'Выпущен',
  SUPERSEDED: 'Заменён',
}

/**
 * Сохранение блоба файлом. Синтетический `<a download>` — единственный путь:
 * голый `<a href>` на `/api/documents/attachments/…/download/` НЕ несёт
 * `X-User-Id`/`Authorization` из `credential.ts:18` и получил бы 403.
 *
 * `revokeObjectURL` обязателен — без него блоб живёт до перезагрузки вкладки.
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

interface IssuedCardProps {
  report: IssuedExpenseReport
  onDownload: () => void
  downloading: boolean
}

/** Карточка выпущенного: ВСЁ дословно из ответа, ничего не пересобирается. */
function IssuedReportCard({ report, onDownload, downloading }: IssuedCardProps) {
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Исх. №</dt>
        <dd>
          {report.number} / {report.year}
        </dd>
        <dt className="text-muted-foreground">Дата</dt>
        <dd>{report.business_date}</dd>
        <dt className="text-muted-foreground">Статус</dt>
        <dd>{STATUS_LABELS[report.status]}</dd>
        <dt className="text-muted-foreground">Версия сдачи</dt>
        <dd>{report.submission_version}</dd>
      </dl>
      <div>
        <Button type="button" onClick={onDownload} disabled={downloading}>
          {DOWNLOAD_LABEL}
        </Button>
      </div>
    </div>
  )
}

interface PanelProps {
  divisionId: string
  businessDate: string
  divisionNameById: Record<string, string>
}

/**
 * Панель выпуска/чтения за КОНКРЕТНЫЙ (подразделение, дата).
 *
 * Монтируется с `key={divisionId}-{businessDate}` — смена контекста РЕМАУНТИТ
 * её, снимая разом ответ прошлого выпуска, сообщение отказа и ошибку
 * скачивания. Это не стилистика: `react-hooks/set-state-in-effect` — ОШИБКА
 * линта, поэтому «сбросить флаги эффектом» здесь незаконно, а находка ревью
 * 10.4 была ровно класса «флаг переживает смену контекста».
 */
function ExpenseReportPanel({
  divisionId,
  businessDate,
  divisionNameById,
}: PanelProps) {
  const queryClient = useQueryClient()
  /** Канон-строка успеха. UI-состояние, серверных данных не дублирует. */
  const [issuedMessage, setIssuedMessage] = useState<string | null>(null)

  /**
   * Чтение выпущенного за дату (point-lookup: один объект или 404).
   *
   * `retry: false` осознанно: 404 здесь — ШТАТНЫЙ ответ «не выпускался»
   * (`views.py:293-301`), и три ретрая ждали бы впустую на самом частом
   * сценарии экрана. Канон L472 ретраев и так не предполагает.
   */
  const reportQuery = useQuery<unknown, ApiFailure>({
    queryKey: ['expense-report', divisionId, businessDate],
    queryFn: () =>
      apiClient.get<unknown>(
        `${EXPENSE_PATH}?division_id=${encodeURIComponent(divisionId)}&business_date=${encodeURIComponent(businessDate)}`,
      ),
    retry: false,
  })

  // Разбор — у границы, один раз на ответ (гарантия схемы компиляционная, не
  // рантайм). Без валидного attachment_id карточка не строится вовсе.
  const report = parseIssuedReport(reportQuery.data)

  /**
   * ⚠️ 404 — НЕ ошибка экрана. `useQuery` кладёт его в `isError`, и наивная
   * лестница `isError → role="alert"` превратила бы нормальный сценарий «за эту
   * дату не выпускалось» в баннер отказа. Гард обязан стоять ЗДЕСЬ, до общей
   * ветки ошибки (урок 10.4: гард работает только там, где путь реально идёт).
   */
  const readError = reportQuery.error
  const notIssued =
    readError !== null &&
    readError.kind !== 'network' &&
    readError.status === 404
  const readFailed = reportQuery.isError && !notIssued

  const issue = useApiMutation<unknown, ExpenseIssueBody>({
    mutationFn: async (body) => {
      try {
        return await apiClient.post<unknown>(EXPENSE_PATH, body)
      } catch (error) {
        // 409 «уже выпущен» означает, что 404 point-lookup'а устарел: документ
        // существует (гонка выпуска). Кнопку «Скачать» несёт только
        // перечитанная карточка — в details этого 409 нет `attachment_id`, из
        // отказа её не построить, и без перечитки AC-5 («+ кнопка „Скачать“»)
        // оставался бы недостижим. Здесь, а не в эффекте: синхронно с отказом,
        // без двойного срабатывания StrictMode.
        if (describeIssueFailure(error as ApiFailure).kind === 'already-issued') {
          void queryClient.invalidateQueries({
            queryKey: ['expense-report', divisionId, businessDate],
          })
        }
        throw error
      }
    },
    onSuccess: (data) => {
      const issued = parseIssuedReport(data)
      setIssuedMessage(
        issued === null ? 'Расход готов.' : issueSuccessMessage(issued.number),
      )
      // Карточка AC-3 перечитывается: номер, статус и версия берутся из
      // свежего ответа чтения, а не из тела POST'а.
      void queryClient.invalidateQueries({
        queryKey: ['expense-report', divisionId, businessDate],
      })
    },
  })

  /**
   * Скачивание — через `useApiMutation` (сырой `useMutation` в `features/**`
   * забанен линтом). 5xx/сеть он уже отправляет в глобальный тост, поэтому
   * `describeDownloadFailure` для них молчит: дубль хуже молчания.
   */
  const download = useApiMutation<void, Record<string, never>>({
    mutationFn: async () => {
      if (report === null) return
      const { blob, filename } = await apiClient.getBlob(
        `/api/documents/attachments/${encodeURIComponent(report.attachment_id)}/download/`,
      )
      // Имя от СЕРВЕРА приоритетно (кириллица приезжает
      // `filename*=UTF-8''<pct>`); клиентское — только фолбэк-зеркало.
      saveBlob(blob, filename ?? expenseFileName(report))
    },
  })

  const failure = issue.error === null ? null : describeIssueFailure(issue.error)
  const downloadMessage =
    download.error === null ? '' : describeDownloadFailure(download.error)

  const handleDownload = (): void => {
    download.mutate({})
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        {/* Лестница чтения. Порядок ветвей load-bearing: «не выпускался»
            решается ДО общей ветки ошибки. */}
        {reportQuery.isPending ? (
          <p role="status">{LOADING_TEXT}</p>
        ) : readFailed ? (
          <p role="alert" className="text-sm text-destructive">
            {READ_ERROR_TEXT}
          </p>
        ) : report !== null ? (
          <IssuedReportCard
            report={report}
            onDownload={handleDownload}
            downloading={download.isPending}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {/* Пустое состояние, а не отказ: role="status", не role="alert". */}
            <p role="status">{NOT_ISSUED_TEXT}</p>
            <div>
              <Button
                type="button"
                onClick={() => issue.mutate({ division_id: divisionId, business_date: businessDate })}
                disabled={issue.isPending}
              >
                {ISSUE_LABEL}
              </Button>
            </div>
          </div>
        )}

        {issuedMessage !== null ? (
          <p role="status" className="text-sm font-medium">
            {issuedMessage}
          </p>
        ) : null}

        {downloadMessage !== '' ? (
          <p role="alert" className="text-sm text-destructive">
            {downloadMessage}
          </p>
        ) : null}

        {/* Экран «кто не сдал» (AC-6): блокирующий блок вместо строки отказа. */}
        {failure !== null && failure.kind === 'tomorrow-blocked' ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-input p-4">
            <p className="font-medium">{BLOCKED_HEADING}</p>
            <p className="text-sm">{failure.message}</p>
            {failure.laggards !== undefined && failure.laggards.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">Не сдали:</p>
                <ul className="list-disc pl-5 text-sm">
                  {failure.laggards.map((id) => (
                    // ⚠️ Фолбэк на сам UUID обязателен и load-bearing: список
                    // org-wide (`tomorrow_gate.py:40`), в нём легально есть
                    // дивизионы вне скоупа актора и вне страницы 1 справочника
                    // (`/api/core/divisions/` читается без дочитки `next`).
                    // Отрисованный UUID — КОРРЕКТНОЕ поведение, а не баг:
                    // цепочки «дивизион→ответственный» не существует (§5.2).
                    <li key={id}>{divisionNameById[id] ?? id}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : failure !== null && failure.kind !== 'silent' ? (
          <div role="alert" className="flex flex-col gap-2">
            <p className="text-sm text-destructive">{failure.message}</p>
            {failure.violationCount !== undefined ? (
              <p className="text-sm text-muted-foreground">
                Нарушений формул: {failure.violationCount}
              </p>
            ) : null}
            {failure.offerDownload === true && report !== null ? (
              // Повторная выдача файла — операция СКАЧИВАНИЯ, не ошибка (§4).
              <div>
                <Button type="button" onClick={handleDownload} disabled={download.isPending}>
                  {DOWNLOAD_LABEL}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ExpenseReportPage() {
  // Выбор подразделения и даты — чистое UI-состояние, в useState легально
  // (ARCH-FE-010 запрещает дублировать в useState СЕРВЕРНЫЕ данные).
  const [divisionId, setDivisionId] = useState<string | null>(null)
  const [businessDate, setBusinessDate] = useState(todayLocalIso)

  const divisionsQuery = useQuery({
    queryKey: ['divisions'],
    queryFn: () => apiClient.get<DivisionsResponse>('/api/core/divisions/'),
  })

  const divisions = divisionsQuery.data?.results ?? []
  const divisionNameById: Record<string, string> = {}
  for (const division of divisions) divisionNameById[division.id] = division.name

  const dateValid = ISO_DATE_RE.test(businessDate)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          {/* H1 рендерится БЕЗУСЛОВНО, вне лестницы состояний (AC-8): дефолтный
              MSW-хендлер справочника подразделений — HttpResponse.error(), т.е.
              СЕТЕВОЙ СБОЙ, и `app-layout.qa.test.tsx` ассертит этот заголовок
              именно при упавшем справочнике. Спрятать H1 за загрузкой или за
              успехом справочника = покрасить чужой тест. */}
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            {HEADING}
          </h1>
          <CardDescription>{CARD_DESCRIPTION}</CardDescription>
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
                  setDivisionId(event.target.value === '' ? null : event.target.value)
                }
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {/* Автовыбор первого НЕ делаем: список не отфильтрован по
                    скоупу актора, и молчаливый выбор чужого подразделения дал
                    бы необъяснимый 403 на выпуске. */}
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
                onChange={(event) => setBusinessDate(event.target.value)}
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
            <p role="alert" className="text-sm text-destructive">
              Не удалось загрузить список подразделений.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {divisionId === null ? (
        <Card>
          <CardContent className="p-6">
            <p role="status">{CHOOSE_DIVISION_TEXT}</p>
          </CardContent>
        </Card>
      ) : !dateValid ? (
        <Card>
          <CardContent className="p-6">
            <p role="status">Укажите дату расхода.</p>
          </CardContent>
        </Card>
      ) : (
        <ExpenseReportPanel
          // Ремаунт на смене контекста — вместо запрещённого линтом
          // setState-в-эффекте (см. шапку панели).
          key={`${divisionId}-${businessDate}`}
          divisionId={divisionId}
          businessDate={businessDate}
          divisionNameById={divisionNameById}
        />
      )}
    </div>
  )
}
