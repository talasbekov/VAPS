// Story 17.7c: журнал штаба (17.1/17.2/17.7a) на странице версии
// Расстановки. Real-API панель под features/placement/ — features/
// security-events/ остаётся отдельным mock-прототипом (Scope Decision,
// see 17-7c story file).
//
// RBAC — этот кодовый путь НЕ хранит permission-коды клиентской стороной
// (как весь остальной features/placement/): 403 обрабатывается реактивно
// через query/mutation error-каналы, не скрывается заранее по client-side
// permission-check.
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '../../../shared/ui/Button'
import { ApiError } from '../../../shared/api/errors'
import { GENERIC_FAILURE_MESSAGE } from '../../../shared/api/useApiMutation'
import { useAddJournalEntry, useJournalEntries } from '../api/queries'
import type { JournalEntriesListResponse } from '../api/queries'

const ENTRY_TYPE_LABEL: Record<string, string> = {
  BRIEFING: 'Инструктаж',
  DIRECTIVE: 'Указание',
  INCIDENT: 'Инцидент',
}

const journalEntrySchema = z.object({
  entry_type: z.enum(['BRIEFING', 'DIRECTIVE']),
  text: z.string().trim().min(1, 'Обязательное поле'),
})
type JournalEntryValues = z.infer<typeof journalEntrySchema>

export function JournalPanel({ eventId }: { eventId: number }) {
  const entriesQuery = useJournalEntries(eventId)
  const addMutation = useAddJournalEntry(eventId)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<JournalEntryValues>({
    resolver: zodResolver(journalEntrySchema),
    defaultValues: { entry_type: 'BRIEFING', text: '' },
  })

  const isViewForbidden =
    entriesQuery.isError &&
    entriesQuery.error instanceof ApiError &&
    entriesQuery.error.status === 403
  const isCreateForbidden =
    addMutation.error instanceof ApiError && addMutation.error.status === 403

  useEffect(() => {
    if (addMutation.data !== undefined) {
      reset({ entry_type: 'BRIEFING', text: '' })
    }
  }, [addMutation.data, reset])

  const onSubmit = (values: JournalEntryValues) => {
    addMutation.mutate(values)
  }

  return (
    <section className="mb-3.5 rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-bold">Журнал штаба</h2>

      {isViewForbidden ? (
        <p className="text-sm text-muted-foreground">Нет доступа.</p>
      ) : entriesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : entriesQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Не удалось загрузить журнал.
        </p>
      ) : (
        <JournalEntryList entries={entriesQuery.data ?? []} />
      )}

      {!isCreateForbidden && (
        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e)
          }}
          className="mt-3 flex flex-col gap-2 border-t pt-3"
        >
          <select
            {...register('entry_type')}
            className="rounded-md border px-2 py-1.5 text-sm"
          >
            <option value="BRIEFING">Инструктаж</option>
            <option value="DIRECTIVE">Указание</option>
          </select>
          <textarea
            {...register('text')}
            placeholder="Текст записи"
            className="min-h-16 rounded-md border px-2 py-1.5 text-sm"
          />
          {errors.text !== undefined && (
            <p className="text-xs text-destructive">{errors.text.message}</p>
          )}
          <Button type="submit" disabled={addMutation.isPending}>
            {addMutation.isPending ? 'Добавление…' : 'Добавить запись'}
          </Button>
          {addMutation.error !== null && !isCreateForbidden && (
            <p className="text-sm text-destructive" role="alert">
              {addMutation.error instanceof ApiError
                ? addMutation.error.message
                : GENERIC_FAILURE_MESSAGE}
            </p>
          )}
        </form>
      )}
      {isCreateForbidden && (
        <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
          Нет права на добавление записей.
        </p>
      )}
    </section>
  )
}

function JournalEntryList({ entries }: { entries: JournalEntriesListResponse }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Записей пока нет.</p>
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-md border px-3 py-2 text-sm">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-primary">
            {ENTRY_TYPE_LABEL[entry.entry_type] ?? entry.entry_type}
          </p>
          <p>{entry.text}</p>
        </li>
      ))}
    </ul>
  )
}
