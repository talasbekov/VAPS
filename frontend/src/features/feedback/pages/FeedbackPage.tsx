// Обратная связь (§28): реестр обращений со сводкой, поиском, фильтрами и
// страницами + форма нового обращения.
//
// ⚠️ Экран ничего не решает про видимость. Кто какие обращения и какие их
// поля видит, считает сервер: закрытое содержание приходит `null` вместе с
// причиной, а поиск по нему на сервере же и не выполняется. Фильтрация уже
// полученного массива здесь была бы вёрсткой поверх привезённых в браузер
// данных — ровно тем, что §22.24 и §20.27 запрещают.
import { useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { useCreateFeedback, useFeedbackRequests, useSubmitFeedback } from '../api/queries'
import type { FeedbackAttachmentMeta, FeedbackPriorityCode, FeedbackTypeCode } from '../model/types'

function formatMoment(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  return `${(bytes / 1024).toFixed(1)} КБ`
}

const ALL = 'ALL'

export function FeedbackPage() {
  const [search, setSearch] = useState('')
  const [typeCode, setTypeCode] = useState<string>(ALL)
  const [statusCode, setStatusCode] = useState<string>(ALL)
  const [moduleCode, setModuleCode] = useState<string>(ALL)
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)

  const listQuery = useFeedbackRequests({
    search,
    typeCode: typeCode === ALL ? undefined : (typeCode as FeedbackTypeCode),
    statusCode: statusCode === ALL ? undefined : (statusCode as never),
    moduleCode: moduleCode === ALL ? undefined : moduleCode,
    page,
    mine,
  })
  const data = listQuery.data
  const registry = data?.registry

  const [formKey, setFormKey] = useState(1)
  const createFeedback = useCreateFeedback(() => {
    // Сброс формы — сменой `key` поддерева, а не setState в эффекте
    // (react-hooks/set-state-in-effect): эффект сработал бы повторно на любом
    // ререндере с тем же ответом.
    setFormKey((value) => value + 1)
    setPage(1)
  })
  const submitDraft = useSubmitFeedback()

  function labelOf(kind: 'type' | 'priority' | 'status', code: string): string {
    if (registry === undefined) return code
    const source =
      kind === 'type' ? registry.types : kind === 'priority' ? registry.priorities : registry.statuses
    return source.find((entry) => entry.code === code)?.label ?? code
  }

  function moduleLabel(code: string): string {
    return registry?.modules.find((entry) => entry.moduleCode === code)?.label ?? code
  }

  /** Любая смена условий отбора возвращает на первую страницу: остаться на
   * третьей странице набора из двух строк значило бы показать пустоту вместо
   * результата. */
  function changeFilter(apply: () => void): void {
    apply()
    setPage(1)
  }

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Поддержка
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Обратная связь</h1>
        <span className="text-sm text-muted-foreground">
          Обращения пользователей: ошибки, неверные данные, UX, идеи, доступ и помощь
        </span>
      </header>

      {listQuery.isError && (
        <p className="mb-4 text-sm text-destructive">Не удалось загрузить обращения.</p>
      )}

      {data !== undefined && registry !== undefined && (
        <section
          role="group"
          aria-label="Сводка по статусам"
          className="mb-4 rounded-xl border bg-card p-4"
        >
          <h2 className="mb-2 text-sm font-semibold">Сводка по статусам</h2>
          {/* Сводку считает сервер по всему видимому набору. Экран не
              складывает отрисованные строки — это был бы итог по видимой части
              таблицы (§22.3). */}
          <ul className="flex flex-wrap gap-2">
            {data.stats.byStatus.map((entry) => (
              <li
                key={entry.statusCode}
                className="rounded-lg border px-2.5 py-1 text-xs text-slate-600"
              >
                <span className="font-semibold">{labelOf('status', entry.statusCode)}</span>{' '}
                <span data-testid={`stat-${entry.statusCode}`}>{entry.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-600">
            Всего доступно обращений: {data.stats.total}. Справочник {registry.registryVersion}.
          </p>
        </section>
      )}

      {registry !== undefined && (
        <FeedbackForm
          key={formKey}
          modules={registry.modules}
          types={registry.types}
          priorities={registry.priorities}
          serverTime={data?.serverTime ?? null}
          pending={createFeedback.isPending}
          errorMessage={createFeedback.error?.message ?? null}
          onSubmit={(body) => createFeedback.mutate(body)}
        />
      )}

      <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Реестр обращений</h2>

        <div role="group" aria-label="Фильтры реестра" className="mb-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Поиск
            <Input
              aria-label="Поиск по обращениям"
              value={search}
              placeholder="Тема или описание"
              onChange={(event) => changeFilter(() => setSearch(event.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Тип
            <select
              aria-label="Фильтр по типу"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={typeCode}
              onChange={(event) => changeFilter(() => setTypeCode(event.target.value))}
            >
              <option value={ALL}>Все типы</option>
              {registry?.types.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Статус
            <select
              aria-label="Фильтр по статусу"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={statusCode}
              onChange={(event) => changeFilter(() => setStatusCode(event.target.value))}
            >
              <option value={ALL}>Все статусы</option>
              {registry?.statuses.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Модуль
            <select
              aria-label="Фильтр по модулю"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={moduleCode}
              onChange={(event) => changeFilter(() => setModuleCode(event.target.value))}
            >
              <option value={ALL}>Все модули</option>
              {registry?.modules.map((entry) => (
                <option key={entry.moduleCode} value={entry.moduleCode}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={mine}
              onChange={(event) => changeFilter(() => setMine(event.target.checked))}
            />
            Только мои
          </label>
        </div>

        {data === undefined ? (
          <p className="text-sm text-muted-foreground">Загрузка реестра…</p>
        ) : data.totalVisible === 0 ? (
          // «Ничего не нашлось» и «обращений ещё нет» — разные сообщения:
          // первое предлагает изменить условия, второе сообщает о пустом
          // реестре, и путать их значит подсказывать несуществующий выход.
          <p className="text-sm text-muted-foreground">Обращений пока нет.</p>
        ) : data.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            По заданным условиям ничего не нашлось. Доступно обращений: {data.totalVisible}.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.results.map((request) => (
              <li key={request.feedbackId} className="rounded-lg border p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-slate-600">
                    {labelOf('status', request.statusCode)}
                  </span>
                  <span className="text-sm font-semibold">{request.subject}</span>
                  {request.confidential && (
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                      Конфиденциально
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600">
                  {labelOf('type', request.typeCode)} · приоритет{' '}
                  {labelOf('priority', request.priorityCode)} · {moduleLabel(request.moduleCode)} ·{' '}
                  {request.authorLabel} · {formatMoment(request.createdAt)}
                </p>

                {request.restrictedReason === null ? (
                  <p className="mt-1 text-xs text-slate-600">{request.descriptionPreview}</p>
                ) : (
                  // Причина видимым текстом: отсутствующее описание само себя
                  // не объясняет, а пустое место читалось бы как «не заполнено».
                  <p className="mt-1 text-xs text-slate-600">{request.restrictedReason}</p>
                )}

                {request.attachments !== null && request.attachments.length > 0 && (
                  <p className="mt-1 text-xs text-slate-600">
                    Вложения (метаданные):{' '}
                    {request.attachments
                      .map((file) => `${file.fileName} · ${formatSize(file.sizeBytes)}`)
                      .join('; ')}
                  </p>
                )}

                {request.technicalInfo !== null && (
                  <p className="mt-1 text-xs text-slate-600">
                    Техническая информация (по согласию автора):{' '}
                    {request.technicalInfo.appRevision} · {request.technicalInfo.viewport} ·{' '}
                    {request.technicalInfo.platform}
                  </p>
                )}

                {request.isOwn && request.statusCode === 'DRAFT' && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={submitDraft.isPending}
                      onClick={() => submitDraft.mutate({ feedbackId: request.feedbackId })}
                    >
                      Отправить в работу
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {submitDraft.error !== null && (
          <p className="mt-2 text-xs text-destructive">{submitDraft.error.message}</p>
        )}

        {data !== undefined && (
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-600">
            <Button
              size="sm"
              variant="outline"
              disabled={data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              Назад
            </Button>
            <span>
              Страница {data.page} из {data.pageCount} · найдено {data.totalMatched}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={data.page >= data.pageCount}
              onClick={() => setPage(data.page + 1)}
            >
              Вперёд
            </Button>
          </div>
        )}
      </section>

      {data !== undefined && (
        <section className="rounded-xl border border-dashed bg-muted/30 p-4">
          <h2 className="mb-2 text-sm font-semibold">Чего этот раздел не делает и почему</h2>
          <ul className="flex flex-col gap-2">
            {data.unavailableCapabilities.map((item) => (
              <li key={item.code} className="text-xs text-slate-600">
                <span className="font-semibold">{item.label}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

interface FeedbackFormProps {
  types: readonly { code: FeedbackTypeCode; label: string }[]
  priorities: readonly { code: FeedbackPriorityCode; label: string }[]
  modules: readonly { moduleCode: string; label: string }[]
  serverTime: string | null
  pending: boolean
  errorMessage: string | null
  onSubmit: (body: {
    subject: string
    description: string
    typeCode: FeedbackTypeCode
    priorityCode: FeedbackPriorityCode
    moduleCode: string
    expectedResult: string | null
    reproductionSteps: string | null
    contact: string | null
    confidential: boolean
    relatedRoute: string | null
    attachments: FeedbackAttachmentMeta[]
    includeTechnicalInfo: boolean
    technicalInfo: {
      appRevision: string
      viewport: string
      platform: string
      capturedAt: string
    } | null
    saveAsDraft: boolean
  }) => void
}

function FeedbackForm(props: FeedbackFormProps) {
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [typeCode, setTypeCode] = useState<FeedbackTypeCode>(props.types[0]?.code ?? 'BUG')
  const [priorityCode, setPriorityCode] = useState<FeedbackPriorityCode>('NORMAL')
  const [moduleCode, setModuleCode] = useState(props.modules[0]?.moduleCode ?? '')
  const [expectedResult, setExpectedResult] = useState('')
  const [reproductionSteps, setReproductionSteps] = useState('')
  const [contact, setContact] = useState('')
  const [confidential, setConfidential] = useState(false)
  const [includeTechnicalInfo, setIncludeTechnicalInfo] = useState(false)
  const [attachments, setAttachments] = useState<FeedbackAttachmentMeta[]>([])

  function collect(saveAsDraft: boolean): void {
    props.onSubmit({
      subject,
      description,
      typeCode,
      priorityCode,
      moduleCode,
      expectedResult: expectedResult.trim() === '' ? null : expectedResult,
      reproductionSteps: reproductionSteps.trim() === '' ? null : reproductionSteps,
      contact: contact.trim() === '' ? null : contact,
      confidential,
      // §28 «related route/context»: раздел, о котором обращение. Это предмет
      // обращения, а не телеметрия, поэтому не зависит от согласия на
      // техническую информацию.
      relatedRoute: window.location.pathname,
      attachments,
      includeTechnicalInfo,
      technicalInfo: includeTechnicalInfo
        ? {
            appRevision: import.meta.env.MODE,
            viewport: `${window.innerWidth}×${window.innerHeight}`,
            platform: navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop',
            // Время — СЕРВЕРНОЕ (из последнего ответа реестра), а не
            // `new Date()`: сценарные часы не совпадают с часами машины, и
            // отметка «снято в» по машинному времени разошлась бы с датами
            // самих обращений (§8.8).
            capturedAt: props.serverTime ?? '',
          }
        : null,
      saveAsDraft,
    })
  }

  return (
    <section
      role="group"
      aria-label="Форма обращения"
      className="mb-4 rounded-xl border bg-card p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">Новое обращение</h2>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Тема
          <Input
            aria-label="Тема обращения"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Описание
          <textarea
            aria-label="Описание обращения"
            className="min-h-20 rounded-md border bg-background p-2 text-sm"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Тип обращения
            <select
              aria-label="Тип обращения"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={typeCode}
              onChange={(event) => setTypeCode(event.target.value as FeedbackTypeCode)}
            >
              {props.types.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Приоритет
            <select
              aria-label="Приоритет обращения"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={priorityCode}
              onChange={(event) => setPriorityCode(event.target.value as FeedbackPriorityCode)}
            >
              {props.priorities.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Модуль
            <select
              aria-label="Модуль обращения"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={moduleCode}
              onChange={(event) => setModuleCode(event.target.value)}
            >
              {props.modules.map((entry) => (
                <option key={entry.moduleCode} value={entry.moduleCode}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Ожидаемый результат
          <Input
            aria-label="Ожидаемый результат"
            value={expectedResult}
            onChange={(event) => setExpectedResult(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Шаги воспроизведения
          <Input
            aria-label="Шаги воспроизведения"
            value={reproductionSteps}
            onChange={(event) => setReproductionSteps(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Контакт для ответа
          <Input
            aria-label="Контакт для ответа"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Вложение
          <input
            type="file"
            aria-label="Вложение обращения"
            className="text-xs"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              // Из файла берутся РОВНО метаданные. `File` не читается ни
              // `FileReader`, ни `arrayBuffer()` — содержимое никуда не едет
              // и никуда не сохраняется, потому что blob-хранилища нет.
              setAttachments(
                files.map((file) => ({
                  fileName: file.name,
                  sizeBytes: file.size,
                  mimeType: file.type,
                })),
              )
            }}
          />
        </label>
        <p className="text-xs text-slate-600">
          Сохраняются только имя, размер и тип файла: хранилища файлов в этом контуре нет, поэтому
          содержимое вложения не передаётся и не сохраняется.
        </p>

        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={confidential}
            onChange={(event) => setConfidential(event.target.checked)}
          />
          Конфиденциально — содержание видят только автор и обладатель отдельного права
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={includeTechnicalInfo}
            onChange={(event) => setIncludeTechnicalInfo(event.target.checked)}
          />
          Приложить техническую информацию (сборка, размер окна, платформа)
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={props.pending || subject.trim() === '' || description.trim() === ''}
            onClick={() => collect(false)}
          >
            Создать обращение
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={props.pending || subject.trim() === '' || description.trim() === ''}
            onClick={() => collect(true)}
          >
            Сохранить без отправки
          </Button>
        </div>
        {props.errorMessage !== null && (
          <p className="text-xs text-destructive">{props.errorMessage}</p>
        )}
      </div>
    </section>
  )
}
