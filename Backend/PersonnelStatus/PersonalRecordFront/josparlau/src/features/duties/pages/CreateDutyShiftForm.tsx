// §21.31 «Создание дежурства» + §21.33 «Подбор кандидатов» + §21.34 конфликты.
//
// До этого среза индивидуальные смены существовали ТОЛЬКО из demo-сида: весь
// §21 читался, но не заводился (у боевых групп аналог — `createCombatDutyShift`
// — есть с Этапа 18). Форма закрывает этот разрыв.
//
// ⚠️ ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ, хотя §21.31 это перечисляет:
//   • «время» — модель проекта «одна смена = один календарный день» (A55), поля
//     времени начала у `DutyShift` нет; выдуманное поле пришлось бы либо
//     игнорировать, либо тащить через весь §21;
//   • «продолжительность» и «правила отдыха» — НЕ вводятся, а ПОКАЗЫВАЮТСЯ:
//     оба атрибута вида дежурства (§21.35 «читай restAfterMinutes вида»),
//     дублировать их на смене значило бы завести второго владельца;
//   • «необходимое количество сотрудников» — у индивидуального дежурства оно
//     равно одному по определению режима (`requiredEmployees` заведён только у
//     боевых групп, см. UNAVAILABLE_MONTHLY_METRICS).
//
// Никакой политики форма не выводит: и «какая версия паспорта действует», и
// «почему объект недоступен», и severity конфликта приходят с сервера
// (§21.29/§21.34). Отсюда и порядок полей — дата и вид ПЕРВЫМИ: без них сервер
// не может разрешить список объектов.
import { useEffect, useId, useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ConflictDialog } from '../../../shared/ui/ConflictDialog'
import { usePermissions } from '../../../shared/auth/usePermissions'
import { useCreateDutyShift, useDutyCandidates, useDutyPlanObjects } from '../api/queries'
import type { DutyPlanObjectOption } from '../api/pending-contracts'
import type { ConflictPolicy, DutyTypeDefinition } from '../model/types'

function durationLabel(minutes: number): string {
  const hours = minutes / 60
  return Number.isInteger(hours) ? `${hours} ч` : `${minutes} мин`
}

const REST_POLICY_LABEL = {
  HARD_BLOCK: 'нарушение блокируется',
  SOFT_OVERRIDE: 'нарушение обходится с обоснованием',
} as const

export function CreateDutyShiftForm({
  dutyTypes,
  conflictPolicy,
  defaultBusinessDate,
}: {
  dutyTypes: DutyTypeDefinition[]
  /** Режим отдыха §21.35 — глобальная политика, а не свойство вида: приходит
   * с сервера тем же ответом, что и виды. */
  conflictPolicy: ConflictPolicy
  /** Дата из УЖЕ загруженных смен, не из `new Date()`: demo-runtime живёт по
   * DemoClock (§8.8) и часы машины показали бы дату вне демо-сценария. */
  defaultBusinessDate: string
}) {
  const { hasPermission } = usePermissions()
  const [open, setOpen] = useState(false)

  if (!hasPermission('ops.duty.manage')) return null

  return (
    <section className="mb-4 rounded-xl border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Новое дежурство</h2>
          <p className="text-xs text-muted-foreground">
            Объект, пост из действующей версии паспорта и сотрудник
          </p>
        </div>
        <Button size="sm" variant={open ? 'ghost' : 'outline'} onClick={() => setOpen(!open)}>
          {open ? 'Свернуть' : 'Создать дежурство'}
        </Button>
      </div>
      {/* Размонтирование при закрытии = сброс полей и состояния мутации:
          повторный вход в форму начинается с чистого листа, а не с прошлой
          ошибки (иначе висящая ошибка гардила бы путь — см. 10.6). */}
      {open && (
        <CreateDutyShiftFields
          dutyTypes={dutyTypes}
          conflictPolicy={conflictPolicy}
          defaultBusinessDate={defaultBusinessDate}
          onCreated={() => setOpen(false)}
        />
      )}
    </section>
  )
}

function CreateDutyShiftFields({
  dutyTypes,
  conflictPolicy,
  defaultBusinessDate,
  onCreated,
}: {
  dutyTypes: DutyTypeDefinition[]
  conflictPolicy: ConflictPolicy
  defaultBusinessDate: string
  onCreated: () => void
}) {
  const ids = useId()
  const [businessDate, setBusinessDate] = useState(defaultBusinessDate)
  const [dutyTypeCode, setDutyTypeCode] = useState(dutyTypes[0]?.dutyTypeCode ?? '')
  const [objectId, setObjectId] = useState('')
  const [postKey, setPostKey] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [note, setNote] = useState('')

  const objectsQuery = useDutyPlanObjects(businessDate, dutyTypeCode)
  const candidatesQuery = useDutyCandidates(businessDate)
  const createMutation = useCreateDutyShift()

  const objects = useMemo(() => objectsQuery.data?.results ?? [], [objectsQuery.data])
  const selectedObject = objects.find((option) => option.objectId === objectId) ?? null
  const dutyType = dutyTypes.find((type) => type.dutyTypeCode === dutyTypeCode) ?? null

  // Смена даты/вида меняет и набор объектов, и действующую версию паспорта —
  // выбранный ранее пост может в новой версии отсутствовать. Сбрасываем выбор,
  // а не оставляем висеть: отправка «исчезнувшего» поста получила бы 422
  // UNKNOWN_POST, и пользователь не понял бы, почему. В обработчике, а не в
  // эффекте: это следствие действия пользователя, а не синхронизация с
  // внешней системой (react-hooks/set-state-in-effect).
  function changeBusinessDate(next: string): void {
    setBusinessDate(next)
    setObjectId('')
    setPostKey('')
  }

  function changeDutyType(next: string): void {
    setDutyTypeCode(next)
    setObjectId('')
    setPostKey('')
  }

  function changeObject(next: string): void {
    setObjectId(next)
    setPostKey('')
  }

  const posts = useMemo(() => {
    if (selectedObject === null) return []
    return selectedObject.sectors.flatMap((sector) =>
      sector.posts.map((post) => ({
        key: `${sector.sectorId}::${post.postId}`,
        sectorId: sector.sectorId,
        postId: post.postId,
        label: `${sector.sectorName} · ${post.postName}`,
        task: post.task,
        requirements: post.requirements,
      })),
    )
  }, [selectedObject])
  const selectedPost = posts.find((post) => post.key === postKey) ?? null

  const canSubmit =
    businessDate !== '' &&
    dutyTypeCode !== '' &&
    selectedObject !== null &&
    selectedObject.blockReason === null &&
    selectedPost !== null &&
    employeeName !== '' &&
    !createMutation.isPending

  function submit(): void {
    if (selectedPost === null || selectedObject === null) return
    createMutation.mutate({
      businessDate,
      dutyTypeCode,
      objectId: selectedObject.objectId,
      sectorId: selectedPost.sectorId,
      postId: selectedPost.postId,
      employeeName,
      note: note.trim() === '' ? null : note.trim(),
    })
  }

  // Успех закрывает форму ТОЛЬКО когда данные действительно записаны: `data`
  // появляется после ответа сервера, а не после отправки.
  useEffect(() => {
    if (createMutation.data !== undefined) onCreated()
  }, [createMutation.data, onCreated])

  return (
    // Именованная группа: у формы и у панели persona (DemoToolbar) есть поля с
    // близкими подписями, и без области поиска локатор цепляет обе. Заодно это
    // корректная a11y-группировка полей одной операции.
    <div
      role="group"
      aria-label="Форма нового дежурства"
      className="flex flex-col gap-3 border-t px-4 py-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-date`}>
            Дата дежурства
          </label>
          <input
            id={`${ids}-date`}
            type="date"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={businessDate}
            onChange={(event) => changeBusinessDate(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-type`}>
            Вид дежурства
          </label>
          <select
            id={`${ids}-type`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={dutyTypeCode}
            onChange={(event) => changeDutyType(event.target.value)}
          >
            {dutyTypes.map((type) => (
              <option key={type.dutyTypeCode} value={type.dutyTypeCode}>
                {type.safeLabel}
              </option>
            ))}
          </select>
        </div>
      </div>

      {dutyType !== null && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-slate-600">
          Продолжительность {durationLabel(dutyType.defaultDurationMinutes)} · обязательный отдых{' '}
          {durationLabel(dutyType.restAfterMinutes)} ({REST_POLICY_LABEL[conflictPolicy.restAfterDutyMode]}) ·
          актуальный паспорт{' '}
          {dutyType.requiresCurrentPassport ? 'обязателен' : 'не обязателен'}. Срок отдыха и
          требование паспорта заданы видом дежурства; режим нарушения отдыха — действующими
          правилами конфликтов{' '}
          {conflictPolicy.conflictPolicyVersion === null
            ? '(политика не прочитана — применён строгий режим)'
            : `(ред. ${conflictPolicy.conflictPolicyVersion})`}
          .
        </p>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-object`}>
          Объект
        </label>
        {objectsQuery.isError ? (
          <p className="text-xs text-destructive">Не удалось загрузить объекты для этой даты.</p>
        ) : (
          <select
            id={`${ids}-object`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={objectId}
            onChange={(event) => changeObject(event.target.value)}
            disabled={objectsQuery.isLoading}
          >
            <option value="">— выбрать —</option>
            {objects.map((option) => (
              <option key={option.objectId} value={option.objectId}>
                {objectOptionLabel(option)}
              </option>
            ))}
          </select>
        )}
        {selectedObject !== null && selectedObject.blockReason !== null && (
          <p className="mt-1 text-xs font-semibold text-amber-700">{selectedObject.blockReason}</p>
        )}
        {selectedObject !== null &&
          selectedObject.blockReason === null &&
          selectedObject.applicableVersionNumber !== null && (
            <p className="mt-1 text-xs text-slate-600 tabular-nums">
              Паспорт: ред. {selectedObject.applicableVersionNumber} от{' '}
              {selectedObject.applicableVersionEffectiveFrom}
            </p>
          )}
      </div>

      {selectedObject !== null && selectedObject.blockReason === null && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-post`}>
            Пост
          </label>
          <select
            id={`${ids}-post`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={postKey}
            onChange={(event) => setPostKey(event.target.value)}
          >
            <option value="">— выбрать —</option>
            {posts.map((post) => (
              <option key={post.key} value={post.key}>
                {post.label}
              </option>
            ))}
          </select>
          {selectedPost !== null && (
            <p className="mt-1 text-xs text-slate-600">
              Задача: {selectedPost.task}. Требования: {selectedPost.requirements}
            </p>
          )}
        </div>
      )}

      <div>
        <label
          className="mb-1 block text-xs font-medium text-slate-600"
          htmlFor={`${ids}-employee`}
        >
          Сотрудник
        </label>
        <select
          id={`${ids}-employee`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={employeeName}
          onChange={(event) => setEmployeeName(event.target.value)}
          disabled={candidatesQuery.isLoading}
        >
          <option value="">— выбрать —</option>
          {(candidatesQuery.data?.results ?? []).map((candidate) => (
            <option key={candidate.employeeName} value={candidate.employeeName}>
              {candidate.employeeName} · {candidate.positionName}, {candidate.unitName}
              {candidate.busyOnRequestedDate
                ? ' — уже назначен на эту дату'
                : candidate.nearestDutyDate === null
                  ? ' — ближайших дежурств нет'
                  : ` — ближайшее дежурство ${candidate.nearestDutyDate}`}
            </option>
          ))}
        </select>
        {/* §21.33/§35: чего подбор НЕ учитывает — текстом с причиной, а не
            молчанием. Молчание читалось бы как «учтено и всё в порядке». */}
        {(candidatesQuery.data?.unavailableAttributes ?? []).length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-slate-600">
              Что подбор не учитывает ({candidatesQuery.data?.unavailableAttributes.length})
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {(candidatesQuery.data?.unavailableAttributes ?? []).map((attribute) => (
                <li key={attribute.code} className="text-xs text-slate-600">
                  <span className="font-medium">{attribute.label}</span> — {attribute.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-note`}>
          Примечание (необязательно)
        </label>
        <textarea
          id={`${ids}-note`}
          className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {/* 422 — отказ (жёсткий конфликт, паспорт, неизвестный пост). Мягкий
          конфликт сюда не попадает: он уходит в ConflictDialog ниже. */}
      {createMutation.error !== null && createMutation.conflict === null && (
        <p className="text-xs text-destructive">{createMutation.error.message}</p>
      )}

      <div>
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          Создать дежурство
        </Button>
      </div>

      <ConflictDialog
        conflict={createMutation.conflict}
        onOverride={(reason) => createMutation.confirmOverride(reason)}
        onCancel={() => createMutation.dismissConflict()}
      />
    </div>
  )
}

/** Причина недоступности — в самой подписи опции: объект остаётся видимым
 * (§21.31 «состояние данных»), но выбор его ни к чему не приведёт, и это
 * должно быть понятно ДО выбора. */
function objectOptionLabel(option: DutyPlanObjectOption): string {
  const base = `${option.objectName} (${option.objectCode})`
  return option.blockReason === null ? base : `${base} — недоступен`
}
