// Карточка ОМ + стадийный контент. BULLETIN — Smart Josparlau.dc.html:336-408
// «Информационный бюллетень». RECON — Smart Josparlau.dc.html:408-495
// «Рекогносцировка объекта» (чек-лист + посты/секторы; материалы/фото —
// Not started, требуют blob-хранилища, см. FRONTEND_DECISIONS). Остальные
// стадии stepper'а показаны, но неактивны (не мёртвые кнопки — честно
// задизейблены, запрет §35 соблюдён явным disabled-состоянием).
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ROUTES } from '../../../shared/routes'
import { ApiError } from '../../../shared/api/errors'
import {
  useAcknowledgePlacement,
  useAddJournalEntry,
  useApproveDemand,
  useApprovePlacement,
  useAssignPlacement,
  useCloseSecurityEvent,
  useCompleteAcknowledgement,
  useCompleteForces,
  useCompletePlacement,
  useCompleteRecon,
  usePersonnelRoster,
  useReturnPlacement,
  useSecurityEvent,
  useUnassignPlacement,
  useUpdateBulletin,
  useUpdateForceAllocation,
  useUpdateRecon,
} from '../api/queries'
import { SECURITY_EVENT_STAGES } from '../model/types'
import type {
  ForceRequest,
  JournalEntryType,
  ReconChecklistItem,
  ReconSectorPost,
  SecurityEvent,
  SecurityEventStage,
  StaffingDemandRow,
} from '../model/types'
import { STAGE_LABEL, stageBadgeVariants } from '../lib/stageMeta'

const bulletinSchema = z.object({
  briefDescription: z.string().trim().min(1, 'Обязательное поле'),
  initialTasks: z.string().trim().min(1, 'Обязательное поле'),
})
type BulletinValues = z.infer<typeof bulletinSchema>

export function SecurityEventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const query = useSecurityEvent(id ?? '')

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка мероприятия…</p>
  }
  if (query.isError || query.data === undefined) {
    return (
      <div>
        <p className="text-sm text-destructive">
          Мероприятие не найдено или недоступно.
        </p>
        <Link
          to={ROUTES.securityEvents}
          className="mt-2 inline-block text-sm font-semibold text-primary"
        >
          ← Назад к реестру
        </Link>
      </div>
    )
  }

  const event = query.data

  return (
    <div>
      <Link
        to={ROUTES.securityEvents}
        className="mb-3 inline-block text-xs font-semibold text-primary"
      >
        ← Назад к реестру
      </Link>

      <section className="mb-4 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] bg-purple-100 text-sm font-black text-purple-800">
            ОМ
          </div>
          <div>
            <div className="mb-1 flex gap-1.5">
              <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[10.5px] font-bold text-purple-800">
                {event.code}
              </span>
              <span className={stageBadgeVariants({ stage: event.stage })}>
                {STAGE_LABEL[event.stage]}
              </span>
            </div>
            <h2 className="text-base font-bold">{event.title}</h2>
            <p className="text-[11.5px] text-muted-foreground">
              {event.businessDate} · {event.objectName} · {event.ownerName}
            </p>
          </div>
        </div>
        <StageTracker current={event.stage} />
      </section>

      <StageContent event={event} />
    </div>
  )
}

function StageContent({ event }: { event: SecurityEvent }) {
  const stageIndex = SECURITY_EVENT_STAGES.indexOf(event.stage) + 1

  if (event.stage === 'BULLETIN') {
    return (
      <>
        <StageHeader
          stageIndex={stageIndex}
          title="Информационный бюллетень"
          description="Краткое описание, первичные задачи и сроки подготовки документов"
        />
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[2fr_1fr]">
          <BulletinForm
            eventId={event.id}
            briefDescription={event.briefDescription}
            initialTasks={event.initialTasks}
          />
          <aside className="rounded-xl border bg-card p-4">
            <div className="mb-2 text-sm font-semibold">Что дальше</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              После сохранения бюллетеня направления получат уведомление о
              задачах и сроках. Следующий этап — рекогносцировка объекта
              старшим наряда.
            </p>
          </aside>
        </div>
      </>
    )
  }

  if (event.stage === 'RECON') {
    return (
      <>
        <StageHeader
          stageIndex={stageIndex}
          title="Рекогносцировка объекта"
          description="Зоны и посты, необходимые направления, предварительные риски"
        />
        {/* key=updatedAt: React-рекомендованный способ сбросить локальное
            состояние формы при смене данных (после успешного сохранения) —
            БЕЗ setState в эффекте (react-hooks/set-state-in-effect). */}
        <ReconForm key={event.updatedAt} event={event} />
      </>
    )
  }

  if (event.stage === 'DEMAND') {
    return (
      <>
        <StageHeader
          stageIndex={stageIndex}
          title="Потребность и выделение сил"
          description="Двухуровневый брокеридж · запросы группам · контроль дефицита"
        />
        <DemandForm key={event.updatedAt} event={event} />
      </>
    )
  }

  if (event.stage === 'FORCES') {
    return (
      <>
        <StageHeader
          stageIndex={stageIndex}
          title="Потребность и выделение сил"
          description="Запросы группам и подразделениям — выделение по мере ответа"
        />
        <ForcesPanel event={event} />
      </>
    )
  }

  if (event.stage === 'PLACEMENT') {
    return (
      <>
        <StageHeader
          stageIndex={stageIndex}
          title="Расстановка"
          description="Назначение сотрудников на посты рекогносцировки"
        />
        <PlacementWorkspace event={event} />
      </>
    )
  }

  if (event.stage === 'APPROVAL') {
    return (
      <>
        <StageHeader
          stageIndex={stageIndex}
          title="Согласование расстановки"
          description="Утверждение перед началом мероприятия"
        />
        <ApprovalPanel event={event} />
      </>
    )
  }

  if (event.stage === 'ACKNOWLEDGEMENT') {
    return (
      <>
        <StageHeader
          stageIndex={stageIndex}
          title="Ознакомление"
          description="Подтверждение назначения каждым сотрудником перед проведением"
        />
        <AcknowledgementPanel event={event} />
      </>
    )
  }

  if (event.stage === 'CONDUCT') {
    return (
      <>
        <StageHeader
          stageIndex={stageIndex}
          title="Проведение"
          description="Журнал штаба: инструктаж, распоряжения, инциденты, замены"
        />
        <ConductJournal event={event} />
      </>
    )
  }

  return (
    <>
      <StageHeader
        stageIndex={stageIndex}
        title="Закрыто"
        description="Итоги мероприятия по направлениям"
      />
      <ClosureSummary event={event} />
    </>
  )
}

function StageHeader({
  stageIndex,
  title,
  description,
}: {
  stageIndex: number
  title: string
  description: string
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Этап {stageIndex} из {SECURITY_EVENT_STAGES.length}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <span className="text-sm text-muted-foreground">{description}</span>
      </div>
    </header>
  )
}

function BulletinForm({
  eventId,
  briefDescription,
  initialTasks,
}: {
  eventId: string
  briefDescription: string
  initialTasks: string
}) {
  const mutation = useUpdateBulletin(eventId)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<BulletinValues>({
    resolver: zodResolver(bulletinSchema),
    values: { briefDescription, initialTasks },
  })

  useEffect(() => {
    if (mutation.data !== undefined) {
      reset({
        briefDescription: mutation.data.briefDescription,
        initialTasks: mutation.data.initialTasks,
      })
    }
  }, [mutation.data, reset])

  return (
    <section className="rounded-xl border bg-card p-4">
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
      >
        <label className="text-[11.5px] font-bold text-muted-foreground">
          Краткое описание *
        </label>
        <textarea
          className="min-h-20 rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          {...register('briefDescription')}
        />
        {errors.briefDescription && (
          <p className="text-[11px] font-semibold text-destructive">
            {errors.briefDescription.message}
          </p>
        )}

        <label className="mt-3.5 text-[11.5px] font-bold text-muted-foreground">
          Первичные задачи *
        </label>
        <textarea
          className="min-h-20 rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          {...register('initialTasks')}
        />
        {errors.initialTasks && (
          <p className="text-[11px] font-semibold text-destructive">
            {errors.initialTasks.message}
          </p>
        )}

        {mutation.error !== null && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            Не удалось сохранить бюллетень.
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={mutation.isPending || !isDirty}>
            {mutation.isPending ? 'Сохранение…' : 'Сохранить бюллетень'}
          </Button>
        </div>
      </form>
    </section>
  )
}

let sectorPostSeq = 0
function nextLocalId(): string {
  sectorPostSeq += 1
  return `local-${sectorPostSeq}`
}

function ReconForm({ event }: { event: SecurityEvent }) {
  const updateMutation = useUpdateRecon(event.id)
  const completeMutation = useCompleteRecon(event.id)
  const [checklist, setChecklist] = useState<ReconChecklistItem[]>(event.reconChecklist)
  const [rows, setRows] = useState<ReconSectorPost[]>(event.reconSectorPosts)

  const dirty =
    JSON.stringify(checklist) !== JSON.stringify(event.reconChecklist) ||
    JSON.stringify(rows) !== JSON.stringify(event.reconSectorPosts)

  const checklistDoneCount = checklist.filter((item) => item.done).length
  const canComplete =
    !dirty && checklistDoneCount === checklist.length && rows.length > 0

  function updateChecklistItem(id: string, patch: Partial<ReconChecklistItem>): void {
    setChecklist((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function addRow(): void {
    setRows((prev) => [
      ...prev,
      {
        id: nextLocalId(),
        sector: '',
        post: '',
        task: '',
        need: 1,
        requirements: '',
        result: null,
        comment: '',
      },
    ])
  }

  function updateRow(id: string, patch: Partial<ReconSectorPost>): void {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function removeRow(id: string): void {
    setRows((prev) => prev.filter((row) => row.id !== id))
  }

  return (
    <>
      <section className="mb-3.5 rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Чек-лист рекогносцировки</div>
          <span className="text-xs text-muted-foreground">
            Выполнено: {checklistDoneCount}/{checklist.length}
          </span>
        </div>
        <div className="flex flex-col">
          {checklist.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-1 gap-2 border-b py-2.5 last:border-0 md:grid-cols-[1.2fr_170px_1.3fr]"
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) => updateChecklistItem(item.id, { done: e.target.checked })}
                />
                <span className="text-sm font-medium">{item.label} *</span>
              </label>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={item.result ?? ''}
                onChange={(e) =>
                  updateChecklistItem(item.id, {
                    result: e.target.value === '' ? null : (e.target.value as 'MATCHES' | 'NEEDS_CHANGES'),
                  })
                }
              >
                <option value="">—</option>
                <option value="MATCHES">Соответствует</option>
                <option value="NEEDS_CHANGES">Требует изменений</option>
              </select>
              <div>
                <input
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  placeholder="Комментарий"
                  value={item.comment}
                  onChange={(e) => updateChecklistItem(item.id, { comment: e.target.value })}
                />
                {item.result === 'NEEDS_CHANGES' && item.comment.trim() === '' && (
                  <p className="mt-1 text-[10.5px] font-semibold text-destructive">
                    Укажите комментарий
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-3.5 rounded-xl border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Посты и секторы</div>
            <div className="text-xs text-muted-foreground">Расчёт для текущего ОМ</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" type="button" onClick={addRow}>
              + Добавить пост
            </Button>
            <Button
              size="sm"
              type="button"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ checklist, sectorPosts: rows })}
            >
              {updateMutation.isPending ? 'Сохранение…' : 'Сохранить расчёт'}
            </Button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="py-5 text-center text-xs text-muted-foreground">
            Постов пока нет — добавьте пост
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-[11px] font-semibold text-muted-foreground">
                  <th className="pb-1.5">Сектор</th>
                  <th className="pb-1.5">Пост</th>
                  <th className="pb-1.5">Задача поста</th>
                  <th className="pb-1.5">Сотр.</th>
                  <th className="pb-1.5">Требования</th>
                  <th className="pb-1.5">Результат</th>
                  <th className="pb-1.5">Комментарий</th>
                  <th className="pb-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className="py-1.5 pr-1.5">
                      <input
                        className="h-7 w-16 rounded border border-input bg-background px-1.5"
                        value={row.sector}
                        onChange={(e) => updateRow(row.id, { sector: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <input
                        className="h-7 w-24 rounded border border-input bg-background px-1.5"
                        value={row.post}
                        onChange={(e) => updateRow(row.id, { post: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <input
                        className="h-7 w-full rounded border border-input bg-background px-1.5"
                        value={row.task}
                        onChange={(e) => updateRow(row.id, { task: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <input
                        type="number"
                        min={1}
                        className="h-7 w-14 rounded border border-input bg-background px-1.5"
                        value={row.need}
                        onChange={(e) => updateRow(row.id, { need: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <input
                        className="h-7 w-full rounded border border-input bg-background px-1.5"
                        value={row.requirements}
                        onChange={(e) => updateRow(row.id, { requirements: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <select
                        className="h-7 w-full rounded border border-input bg-background px-1"
                        value={row.result ?? ''}
                        onChange={(e) =>
                          updateRow(row.id, {
                            result: e.target.value === '' ? null : (e.target.value as 'MATCHES' | 'NEEDS_CHANGES'),
                          })
                        }
                      >
                        <option value="">—</option>
                        <option value="MATCHES">Соответствует</option>
                        <option value="NEEDS_CHANGES">Требует изменений</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-1.5">
                      <input
                        className="h-7 w-full rounded border border-input bg-background px-1.5"
                        value={row.comment}
                        onChange={(e) => updateRow(row.id, { comment: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeRow(row.id)}
                      >
                        Удалить
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {updateMutation.error !== null && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            Не удалось сохранить расчёт. Проверьте поля.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {dirty
              ? 'Есть несохранённые изменения — сначала сохраните расчёт.'
              : canComplete
                ? 'Чек-лист выполнен, посты рассчитаны — можно завершать этап.'
                : 'Отметьте все пункты чек-листа и добавьте хотя бы один пост.'}
          </p>
          <Button
            type="button"
            disabled={!canComplete || completeMutation.isPending}
            onClick={() => completeMutation.mutate({})}
          >
            {completeMutation.isPending ? 'Завершение…' : 'Завершить этап и перейти далее'}
          </Button>
        </div>
        {completeMutation.error !== null && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {completeMutation.error instanceof ApiError
              ? completeMutation.error.message
              : 'Не удалось завершить этап.'}
          </p>
        )}
      </section>
    </>
  )
}

const DEMAND_GROUP_OPTIONS = [
  'Группа досмотра',
  'Физическая охрана',
  'Управление ОМ',
  'Резерв',
]

function DemandForm({ event }: { event: SecurityEvent }) {
  const approveMutation = useApproveDemand(event.id)
  const [rows, setRows] = useState<StaffingDemandRow[]>(event.demandRows)
  const locked = event.demandApproved

  const dirty = JSON.stringify(rows) !== JSON.stringify(event.demandRows)
  const totalNeed = rows.reduce((sum, r) => sum + r.need, 0)

  function addRow(): void {
    setRows((prev) => [
      ...prev,
      {
        id: nextLocalId(),
        sector: '',
        task: '',
        shift: 'День',
        need: 1,
        group: DEMAND_GROUP_OPTIONS[0],
        requirements: '',
        comment: '',
      },
    ])
  }

  function updateRow(id: string, patch: Partial<StaffingDemandRow>): void {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function removeRow(id: string): void {
    setRows((prev) => prev.filter((row) => row.id !== id))
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">1 · Потребность в силах</div>
          <div className="text-xs text-muted-foreground">
            Посты и секторы загружены из этапа «Рекогносцировка»
          </div>
        </div>
        {locked ? (
          <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
            Потребность утверждена
          </span>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" type="button" onClick={addRow}>
              + Добавить потребность
            </Button>
            <Button
              size="sm"
              type="button"
              disabled={approveMutation.isPending || rows.length === 0}
              onClick={() => approveMutation.mutate({ rows })}
            >
              {approveMutation.isPending
                ? 'Утверждение…'
                : 'Сохранить и утвердить потребность'}
            </Button>
          </div>
        )}
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <StatBox label="Всего требуется" value={totalNeed} />
        <StatBox label="Постов" value={rows.length} />
        <StatBox
          label="Групп задействовано"
          value={new Set(rows.map((r) => r.group).filter(Boolean)).size}
        />
        <StatBox label="Готовность" value={`${event.readinessPercent}%`} />
      </div>

      {rows.length === 0 ? (
        <p className="py-5 text-center text-xs text-muted-foreground">
          Строк потребности пока нет
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
            <thead>
              <tr className="text-[11px] font-semibold text-muted-foreground">
                <th className="pb-1.5">Сектор</th>
                <th className="pb-1.5">Пост / задача</th>
                <th className="pb-1.5">Смена</th>
                <th className="pb-1.5">Сотр.</th>
                <th className="pb-1.5">Группа</th>
                <th className="pb-1.5">Требования</th>
                <th className="pb-1.5">Комментарий</th>
                <th className="pb-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="py-1.5 pr-1.5">
                    <input
                      disabled={locked}
                      className="h-7 w-16 rounded border border-input bg-background px-1.5 disabled:opacity-60"
                      value={row.sector}
                      onChange={(e) => updateRow(row.id, { sector: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5 pr-1.5">
                    <input
                      disabled={locked}
                      className="h-7 w-full rounded border border-input bg-background px-1.5 disabled:opacity-60"
                      value={row.task}
                      onChange={(e) => updateRow(row.id, { task: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5 pr-1.5">
                    <select
                      disabled={locked}
                      className="h-7 w-full rounded border border-input bg-background px-1 disabled:opacity-60"
                      value={row.shift}
                      onChange={(e) => updateRow(row.id, { shift: e.target.value })}
                    >
                      <option value="День">День</option>
                      <option value="Ночь">Ночь</option>
                    </select>
                  </td>
                  <td className="py-1.5 pr-1.5">
                    <input
                      type="number"
                      min={1}
                      disabled={locked}
                      className="h-7 w-14 rounded border border-input bg-background px-1.5 disabled:opacity-60"
                      value={row.need}
                      onChange={(e) => updateRow(row.id, { need: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="py-1.5 pr-1.5">
                    <select
                      disabled={locked}
                      className="h-7 w-full rounded border border-input bg-background px-1 disabled:opacity-60"
                      value={row.group}
                      onChange={(e) => updateRow(row.id, { group: e.target.value })}
                    >
                      {DEMAND_GROUP_OPTIONS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-1.5">
                    <input
                      disabled={locked}
                      className="h-7 w-full rounded border border-input bg-background px-1.5 disabled:opacity-60"
                      value={row.requirements}
                      onChange={(e) => updateRow(row.id, { requirements: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5 pr-1.5">
                    <input
                      disabled={locked}
                      className="h-7 w-full rounded border border-input bg-background px-1.5 disabled:opacity-60"
                      value={row.comment}
                      onChange={(e) => updateRow(row.id, { comment: e.target.value })}
                    />
                  </td>
                  <td className="py-1.5 text-right">
                    {!locked && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeRow(row.id)}
                      >
                        Удалить
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!locked && dirty && (
        <p className="mt-2 text-xs text-muted-foreground">
          Изменения сохранятся вместе с утверждением потребности.
        </p>
      )}
      {approveMutation.error !== null && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          Не удалось сохранить/утвердить потребность.
        </p>
      )}
    </section>
  )
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-extrabold tabular-nums">{value}</div>
    </div>
  )
}

const FORCE_STATUS_LABEL: Record<ForceRequest['status'], string> = {
  NOT_SENT: 'Не отправлен',
  SENT: 'Отправлен',
  PARTIALLY_ALLOCATED: 'Частично выделено',
  ALLOCATED: 'Выделено',
}

const FORCE_STATUS_CLASS: Record<ForceRequest['status'], string> = {
  NOT_SENT: 'bg-muted text-muted-foreground',
  SENT: 'bg-blue-100 text-blue-800',
  PARTIALLY_ALLOCATED: 'bg-amber-100 text-amber-800',
  ALLOCATED: 'bg-green-100 text-green-800',
}

function ForcesPanel({ event }: { event: SecurityEvent }) {
  const completeMutation = useCompleteForces(event.id)
  const allAllocated =
    event.forceRequests.length > 0 &&
    event.forceRequests.every((r) => r.allocatedCount >= r.requestedCount)

  return (
    <>
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 text-sm font-semibold">2 · Выделение сил</div>
        {event.forceRequests.length === 0 ? (
          <p className="py-5 text-center text-xs text-muted-foreground">
            Запросов пока нет
          </p>
        ) : (
          <div className="flex flex-col">
            {event.forceRequests.map((request) => (
              <ForceRequestRow key={request.id} eventId={event.id} request={request} />
            ))}
          </div>
        )}
      </section>
      <section className="mt-3.5 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {allAllocated
              ? 'Все запросы полностью выделены — можно переходить к расстановке.'
              : 'Дождитесь полного выделения сил по всем группам.'}
          </p>
          <Button
            type="button"
            disabled={!allAllocated || completeMutation.isPending}
            onClick={() => completeMutation.mutate({})}
          >
            {completeMutation.isPending ? 'Завершение…' : 'Завершить этап и перейти далее'}
          </Button>
        </div>
        {completeMutation.error !== null && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {completeMutation.error instanceof ApiError
              ? completeMutation.error.message
              : 'Не удалось завершить этап.'}
          </p>
        )}
      </section>
    </>
  )
}

function ForceRequestRow({
  eventId,
  request,
}: {
  eventId: string
  request: ForceRequest
}) {
  const mutation = useUpdateForceAllocation(eventId, request.id)
  const [allocated, setAllocated] = useState(request.allocatedCount)
  const [comment, setComment] = useState(request.comment)
  const dirty = allocated !== request.allocatedCount || comment !== request.comment

  return (
    <div className="grid grid-cols-2 gap-2.5 border-b py-3 last:border-0 md:grid-cols-[1.3fr_70px_70px_1fr_100px]">
      <div className="text-sm font-semibold">{request.group}</div>
      <div className="text-sm tabular-nums">{request.requestedCount}</div>
      <input
        type="number"
        min={0}
        className="h-8 w-16 rounded border border-input bg-background px-1.5 text-sm"
        value={allocated}
        onChange={(e) => setAllocated(Number(e.target.value) || 0)}
      />
      <input
        className="h-8 rounded border border-input bg-background px-2 text-sm"
        placeholder="—"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${FORCE_STATUS_CLASS[request.status]}`}>
          {FORCE_STATUS_LABEL[request.status]}
        </span>
        {dirty && (
          <Button
            type="button"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ allocatedCount: allocated, comment })}
          >
            {mutation.isPending ? '…' : 'Сохранить'}
          </Button>
        )}
      </div>
    </div>
  )
}

function PlacementWorkspace({ event }: { event: SecurityEvent }) {
  const rosterQuery = usePersonnelRoster()
  const assignMutation = useAssignPlacement(event.id)
  const unassignMutation = useUnassignPlacement(event.id)
  const completeMutation = useCompletePlacement(event.id)
  const [selectedPostId, setSelectedPostId] = useState(event.reconSectorPosts[0]?.id ?? '')
  const [pickedEmployeeId, setPickedEmployeeId] = useState('')

  const staffedPostIds = new Set(event.placementAssignments.map((a) => a.postId))
  const allStaffed =
    event.reconSectorPosts.length > 0 &&
    event.reconSectorPosts.every((p) => staffedPostIds.has(p.id))
  const assignedElsewhere = new Set(
    event.placementAssignments
      .filter((a) => a.postId !== selectedPostId)
      .map((a) => a.employeeId),
  )

  return (
    <>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-xl border bg-card p-3">
          <div className="mb-2 text-sm font-semibold">Посты</div>
          <div className="flex flex-col gap-1">
            {event.reconSectorPosts.map((post) => {
              const count = event.placementAssignments.filter(
                (a) => a.postId === post.id,
              ).length
              return (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => setSelectedPostId(post.id)}
                  className={
                    post.id === selectedPostId
                      ? 'rounded-md bg-primary/10 px-2.5 py-2 text-left text-sm font-semibold text-primary'
                      : 'rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/50'
                  }
                >
                  <span className="block">
                    {post.sector} · {post.post}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {count > 0 ? `Укомплектован (${count})` : 'Не укомплектован'}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="rounded-xl border bg-card p-4">
          {(() => {
            const post = event.reconSectorPosts.find((p) => p.id === selectedPostId)
            if (post === undefined) {
              return (
                <p className="text-sm text-muted-foreground">
                  Постов рекогносцировки нет — расстановка недоступна.
                </p>
              )
            }
            const assignments = event.placementAssignments.filter(
              (a) => a.postId === post.id,
            )
            return (
              <>
                <div className="mb-3">
                  <div className="text-sm font-semibold">
                    {post.sector} · {post.post}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {post.task} · Требования: {post.requirements || '—'}
                  </div>
                </div>

                <div className="mb-3 flex flex-col gap-1.5">
                  {assignments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Никто не назначен</p>
                  ) : (
                    assignments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
                      >
                        <span>{a.employeeName}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={unassignMutation.isPending}
                          onClick={() => unassignMutation.mutate({ assignmentId: a.id })}
                        >
                          Снять
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex gap-2">
                  <select
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    value={pickedEmployeeId}
                    onChange={(e) => setPickedEmployeeId(e.target.value)}
                  >
                    <option value="">Выберите сотрудника…</option>
                    {(rosterQuery.data?.results ?? []).map((emp) => (
                      <option
                        key={emp.id}
                        value={emp.id}
                        disabled={assignedElsewhere.has(emp.id)}
                      >
                        {emp.rankLabel} {emp.name} · {emp.unit}
                        {assignedElsewhere.has(emp.id) ? ' (занят на другом посту)' : ''}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    disabled={pickedEmployeeId === '' || assignMutation.isPending}
                    onClick={() => {
                      assignMutation.mutate({ postId: post.id, employeeId: pickedEmployeeId })
                      setPickedEmployeeId('')
                    }}
                  >
                    Назначить
                  </Button>
                </div>
                {assignMutation.error !== null && (
                  <p className="mt-2 text-sm text-destructive" role="alert">
                    {assignMutation.error instanceof ApiError
                      ? assignMutation.error.message
                      : 'Не удалось назначить сотрудника.'}
                  </p>
                )}
              </>
            )
          })()}
        </section>
      </div>

      <section className="mt-3.5 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {allStaffed
              ? 'Все посты укомплектованы — можно переходить к согласованию.'
              : 'Укомплектуйте все посты хотя бы одним сотрудником.'}
          </p>
          <Button
            type="button"
            disabled={!allStaffed || completeMutation.isPending}
            onClick={() => completeMutation.mutate({})}
          >
            {completeMutation.isPending ? 'Завершение…' : 'Завершить этап и перейти далее'}
          </Button>
        </div>
        {completeMutation.error !== null && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {completeMutation.error instanceof ApiError
              ? completeMutation.error.message
              : 'Не удалось завершить этап.'}
          </p>
        )}
      </section>
    </>
  )
}

const APPROVAL_STATUS_LABEL: Record<SecurityEvent['approvalStatus'], string> = {
  PENDING: 'Ожидает решения',
  APPROVED: 'Утверждено',
  RETURNED: 'Возвращено на доработку',
}

function ApprovalPanel({ event }: { event: SecurityEvent }) {
  const approveMutation = useApprovePlacement(event.id)
  const returnMutation = useReturnPlacement(event.id)
  const [returnComment, setReturnComment] = useState('')
  const [showReturnForm, setShowReturnForm] = useState(false)

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">
          Расстановка: {event.placementAssignments.length} назначений на{' '}
          {event.reconSectorPosts.length} постов
        </div>
        <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
          {APPROVAL_STATUS_LABEL[event.approvalStatus]}
        </span>
      </div>

      {!showReturnForm ? (
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={approveMutation.isPending}
            onClick={() => approveMutation.mutate({})}
          >
            {approveMutation.isPending ? 'Утверждение…' : 'Утвердить расстановку'}
          </Button>
          <Button type="button" variant="outline" onClick={() => setShowReturnForm(true)}>
            Вернуть на доработку
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-muted-foreground">
            Причина возврата *
          </label>
          <input
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={returnComment}
            onChange={(e) => setReturnComment(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={returnMutation.isPending || returnComment.trim() === ''}
              onClick={() => returnMutation.mutate({ comment: returnComment })}
            >
              {returnMutation.isPending ? 'Отправка…' : 'Подтвердить возврат'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowReturnForm(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
      {(approveMutation.error !== null || returnMutation.error !== null) && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          Не удалось выполнить действие.
        </p>
      )}
    </section>
  )
}

const JOURNAL_TYPE_LABEL: Record<JournalEntryType, string> = {
  INSTRUCTION: 'Инструктаж',
  ORDER: 'Распоряжение',
  INCIDENT: 'Инцидент',
  REPLACEMENT: 'Замена',
}

function AcknowledgementPanel({ event }: { event: SecurityEvent }) {
  const acknowledgeMutation = useAcknowledgePlacement(event.id)
  const completeMutation = useCompleteAcknowledgement(event.id)
  const acknowledgedCount = event.placementAssignments.filter(
    (a) => a.acknowledgedAt !== null,
  ).length
  const allAcknowledged =
    event.placementAssignments.length > 0 &&
    acknowledgedCount === event.placementAssignments.length

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">
          Ознакомлено: {acknowledgedCount}/{event.placementAssignments.length}
        </div>
      </div>
      <div className="flex flex-col">
        {event.placementAssignments.map((assignment) => (
          <div
            key={assignment.id}
            className="flex items-center justify-between gap-2 border-b py-2 last:border-0"
          >
            <span className="text-sm font-medium">{assignment.employeeName}</span>
            {assignment.acknowledgedAt !== null ? (
              <span className="text-xs font-semibold text-green-800">Ознакомлен</span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={acknowledgeMutation.isPending}
                onClick={() => acknowledgeMutation.mutate({ assignmentId: assignment.id })}
              >
                Отметить ознакомление
              </Button>
            )}
          </div>
        ))}
      </div>
      {acknowledgeMutation.error !== null && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          Не удалось отметить ознакомление.
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          disabled={!allAcknowledged || completeMutation.isPending}
          onClick={() => completeMutation.mutate({})}
        >
          {completeMutation.isPending ? 'Открытие…' : 'Начать проведение'}
        </Button>
      </div>
      {completeMutation.error !== null && (
        <p className="mt-2 text-right text-sm text-destructive" role="alert">
          Не удалось перейти к проведению.
        </p>
      )}
    </section>
  )
}

const journalEntrySchema = z.object({
  type: z.enum(['INSTRUCTION', 'ORDER', 'INCIDENT', 'REPLACEMENT']),
  title: z.string().trim().min(1, 'Обязательное поле'),
  description: z.string().trim().min(1, 'Обязательное поле'),
})
type JournalEntryValues = z.infer<typeof journalEntrySchema>

function ConductJournal({ event }: { event: SecurityEvent }) {
  const addMutation = useAddJournalEntry(event.id)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<JournalEntryValues>({
    resolver: zodResolver(journalEntrySchema),
    defaultValues: { type: 'INSTRUCTION', title: '', description: '' },
  })

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.2fr]">
      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-semibold">Новая запись журнала</div>
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) =>
            void handleSubmit((values) => {
              addMutation.mutate(values)
              reset({ type: 'INSTRUCTION', title: '', description: '' })
            })(e)
          }
        >
          <label className="text-[11.5px] font-bold text-muted-foreground">Тип *</label>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            {...register('type')}
          >
            {Object.entries(JOURNAL_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <label className="mt-3 text-[11.5px] font-bold text-muted-foreground">
            Заголовок *
          </label>
          <input
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            {...register('title')}
          />
          {errors.title && (
            <p className="text-[11px] font-semibold text-destructive">{errors.title.message}</p>
          )}

          <label className="mt-3 text-[11.5px] font-bold text-muted-foreground">Описание *</label>
          <textarea
            className="min-h-20 rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            {...register('description')}
          />
          {errors.description && (
            <p className="text-[11px] font-semibold text-destructive">
              {errors.description.message}
            </p>
          )}

          {addMutation.error !== null && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              Не удалось добавить запись.
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={addMutation.isPending}>
              {addMutation.isPending ? 'Добавление…' : 'Добавить запись'}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-semibold">Журнал штаба</div>
        {event.journalEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Записей ещё нет.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {event.journalEntries.map((entry) => (
              <div key={entry.id} className="rounded-md border p-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold">
                    {JOURNAL_TYPE_LABEL[entry.type]}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">{entry.createdAt}</span>
                </div>
                <div className="text-sm font-semibold">{entry.title}</div>
                <p className="text-xs text-muted-foreground">{entry.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <ClosureTrigger event={event} />
    </div>
  )
}

function ClosureTrigger({ event }: { event: SecurityEvent }) {
  const closeMutation = useCloseSecurityEvent(event.id)
  const [open, setOpen] = useState(false)
  const directions = Array.from(new Set(event.reconSectorPosts.map((p) => p.sector))).filter(
    (s) => s.trim() !== '',
  )
  const [summaries, setSummaries] = useState<Record<string, string>>({})

  const allFilled = directions.length > 0 && directions.every((d) => (summaries[d] ?? '').trim() !== '')

  return (
    <section className="rounded-xl border bg-card p-4 lg:col-span-2">
      {!open ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Закрытие мероприятия</div>
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            Закрыть мероприятие
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-2 text-sm font-semibold">
            Итоги по направлениям (обязательны все)
          </div>
          <div className="flex flex-col gap-2">
            {directions.map((direction) => (
              <div key={direction}>
                <label className="text-[11.5px] font-bold text-muted-foreground">
                  {direction} *
                </label>
                <textarea
                  className="min-h-16 w-full rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={summaries[direction] ?? ''}
                  onChange={(e) =>
                    setSummaries((prev) => ({ ...prev, [direction]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          {closeMutation.error !== null && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              Не удалось закрыть мероприятие.
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={!allFilled || closeMutation.isPending}
              onClick={() =>
                closeMutation.mutate({
                  directionSummaries: directions.map((direction) => ({
                    direction,
                    summary: summaries[direction] ?? '',
                  })),
                })
              }
            >
              {closeMutation.isPending ? 'Закрытие…' : 'Подтвердить закрытие'}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function ClosureSummary({ event }: { event: SecurityEvent }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <p className="mb-3 text-sm font-semibold text-green-800">
        Мероприятие закрыто {event.closedAt !== null ? `· ${event.closedAt}` : ''}
      </p>
      <div className="flex flex-col gap-2">
        {event.closureDirectionSummaries.map((item) => (
          <div key={item.direction} className="rounded-md border p-2.5">
            <div className="text-sm font-semibold">{item.direction}</div>
            <p className="text-xs text-muted-foreground">{item.summary}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function StageTracker({ current }: { current: SecurityEventStage }) {
  const currentIndex = SECURITY_EVENT_STAGES.indexOf(current)
  return (
    <div
      className="relative mt-4 grid"
      style={{ gridTemplateColumns: `repeat(${SECURITY_EVENT_STAGES.length}, minmax(0, 1fr))` }}
    >
      <div className="absolute left-[4%] right-[4%] top-3 h-0.5 bg-muted" />
      {SECURITY_EVENT_STAGES.map((stage, index) => {
        const isCurrent = index === currentIndex
        const isReached = index <= currentIndex
        return (
          <div key={stage} className="relative z-10 text-center">
            <span
              className={
                isCurrent
                  ? stageBadgeVariants({ stage }) + ' block w-fit mx-auto'
                  : isReached
                    ? 'mx-auto block w-fit rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground'
                    : 'mx-auto block w-fit rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground'
              }
            >
              {index + 1}
            </span>
            <span
              className={
                isReached
                  ? 'mt-1 block text-[10px] font-semibold text-foreground'
                  : 'mt-1 block text-[10px] text-muted-foreground'
              }
            >
              {STAGE_LABEL[stage]}
            </span>
          </div>
        )
      })}
    </div>
  )
}
