// §21.31, правка и отмена заведённой смены (Этап 34). До этого среза создание
// было односторонним: ошибку в дате-сотруднике-посте исправить было нечем.
//
// ЧТО ЗДЕСЬ НЕЛЬЗЯ ПОМЕНЯТЬ и почему — дата и вид дежурства. Оба задают, какая
// версия паспорта действует и какие правила отдыха применяются; смена с другой
// датой — это ДРУГАЯ смена. Для этого есть отмена + создание, где конфликты
// пересчитываются с нуля и видны человеку, а не подменяются молча.
//
// Список постов берётся тем же серверным ресурсом, что у формы создания
// (`useDutyPlanObjects`): выбор действующей версии паспорта принадлежит
// серверу, и второй источник постов разошёлся бы с первым.
import { useEffect, useId, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { ConflictDialog } from '../../../shared/ui/ConflictDialog'
import {
  useCancelDutyShift,
  useDutyCandidates,
  useDutyPlanObjects,
  useUpdateDutyShift,
} from '../api/queries'
import type { DutyShift } from '../model/types'

export function EditDutyShiftSection({ shift }: { shift: DutyShift }) {
  const [mode, setMode] = useState<'IDLE' | 'EDIT' | 'CANCEL'>('IDLE')

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Изменение плана</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === 'EDIT' ? 'default' : 'outline'}
            onClick={() => setMode(mode === 'EDIT' ? 'IDLE' : 'EDIT')}
          >
            Изменить
          </Button>
          <Button
            size="sm"
            variant={mode === 'CANCEL' ? 'default' : 'outline'}
            onClick={() => setMode(mode === 'CANCEL' ? 'IDLE' : 'CANCEL')}
          >
            Отменить дежурство
          </Button>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-slate-600">
        Дата и вид дежурства не меняются: от них зависит действующая версия паспорта и
        правила отдыха. Чтобы перенести смену, отмените её и заведите новую.
      </p>
      {/* Размонтирование при закрытии = сброс полей и состояния мутации:
          повторный вход начинается с чистого листа, а не с прошлой ошибки. */}
      {mode === 'EDIT' && <EditFields shift={shift} onDone={() => setMode('IDLE')} />}
      {mode === 'CANCEL' && <CancelFields shift={shift} onDone={() => setMode('IDLE')} />}
    </section>
  )
}

function EditFields({ shift, onDone }: { shift: DutyShift; onDone: () => void }) {
  const ids = useId()
  const [employeeName, setEmployeeName] = useState(shift.employeeName)
  const [postKey, setPostKey] = useState(
    shift.passportBinding === null
      ? ''
      : `${shift.passportBinding.sectorId}::${shift.passportBinding.postId}`,
  )
  const [note, setNote] = useState(shift.note ?? '')

  const objectsQuery = useDutyPlanObjects(shift.businessDate, shift.dutyTypeCode)
  const candidatesQuery = useDutyCandidates(shift.businessDate)
  const updateMutation = useUpdateDutyShift(shift.id)

  const target =
    objectsQuery.data?.results.find((option) => option.objectId === shift.target.objectId) ?? null
  const posts = (target?.sectors ?? []).flatMap((sector) =>
    sector.posts.map((post) => ({
      key: `${sector.sectorId}::${post.postId}`,
      sectorId: sector.sectorId,
      postId: post.postId,
      label: `${sector.sectorName} · ${post.postName}`,
    })),
  )
  const selectedPost = posts.find((post) => post.key === postKey) ?? null

  useEffect(() => {
    if (updateMutation.data !== undefined) onDone()
  }, [updateMutation.data, onDone])

  const employeeChanged = employeeName !== shift.employeeName

  return (
    <div role="group" aria-label="Правка дежурства" className="mt-3 flex flex-col gap-3 border-t pt-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-employee`}>
          Сотрудник
        </label>
        <select
          id={`${ids}-employee`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={employeeName}
          onChange={(event) => setEmployeeName(event.target.value)}
          disabled={candidatesQuery.isLoading}
        >
          {/* Текущий исполнитель обязан быть в списке, даже если его нет в
              справочнике кандидатов: иначе select молча сбросил бы значение и
              «правка примечания» подменила бы сотрудника. */}
          {(candidatesQuery.data?.results ?? []).every(
            (candidate) => candidate.employeeName !== shift.employeeName,
          ) && <option value={shift.employeeName}>{shift.employeeName} (текущий)</option>}
          {(candidatesQuery.data?.results ?? []).map((candidate) => (
            <option key={candidate.employeeName} value={candidate.employeeName}>
              {candidate.employeeName} · {candidate.positionName}, {candidate.unitName}
              {candidate.employeeName === shift.employeeName
                ? ' — текущий исполнитель'
                : candidate.busyOnRequestedDate
                  ? ' — уже назначен на эту дату'
                  : ''}
            </option>
          ))}
        </select>
        {employeeChanged && shift.stateCode === 'ACKNOWLEDGED' && (
          <p className="mt-1 text-xs font-semibold text-amber-700">
            Ознакомление будет снято: подтверждал прежний сотрудник, новый — ещё нет.
          </p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-post`}>
          Пост
        </label>
        <select
          id={`${ids}-post`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={postKey}
          onChange={(event) => setPostKey(event.target.value)}
          disabled={objectsQuery.isLoading}
        >
          <option value="">— выбрать —</option>
          {posts.map((post) => (
            <option key={post.key} value={post.key}>
              {post.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-note`}>
          Примечание
        </label>
        <textarea
          id={`${ids}-note`}
          className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {updateMutation.error !== null && updateMutation.conflict === null && (
        <p className="text-xs text-destructive">{updateMutation.error.message}</p>
      )}

      <div>
        <Button
          size="sm"
          disabled={selectedPost === null || employeeName === '' || updateMutation.isPending}
          onClick={() => {
            if (selectedPost === null) return
            updateMutation.mutate({
              employeeName,
              sectorId: selectedPost.sectorId,
              postId: selectedPost.postId,
              note: note.trim() === '' ? null : note.trim(),
            })
          }}
        >
          Сохранить изменения
        </Button>
      </div>

      <ConflictDialog
        conflict={updateMutation.conflict}
        onOverride={(reason) => updateMutation.confirmOverride(reason)}
        onCancel={() => updateMutation.dismissConflict()}
      />
    </div>
  )
}

function CancelFields({ shift, onDone }: { shift: DutyShift; onDone: () => void }) {
  const ids = useId()
  const [reason, setReason] = useState('')
  const cancelMutation = useCancelDutyShift()

  useEffect(() => {
    if (cancelMutation.data !== undefined) onDone()
  }, [cancelMutation.data, onDone])

  return (
    <div
      role="group"
      aria-label="Отмена дежурства"
      className="mt-3 flex flex-col gap-3 border-t pt-3"
    >
      <p className="text-xs text-slate-600">
        Отменённое дежурство остаётся в плане с причиной — оно выбывает из показателей и
        перестаёт занимать сотрудника, но след планирования сохраняется.
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${ids}-reason`}>
          Причина отмены
        </label>
        <textarea
          id={`${ids}-reason`}
          className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {cancelMutation.error !== null && (
        <p className="text-xs text-destructive">{cancelMutation.error.message}</p>
      )}
      <div>
        <Button
          size="sm"
          disabled={reason.trim() === '' || cancelMutation.isPending}
          onClick={() => cancelMutation.mutate({ id: shift.id, body: { reason: reason.trim() } })}
        >
          Подтвердить отмену
        </Button>
      </div>
    </div>
  )
}
