// Значения справочника (§30): таблица + добавление значения (permission
// `ops.dictionary.manage`, серверная проверка §8.5 — как ObjectPassportPage,
// форма видна всем с ops.dictionary.view, 403 от mock API — единственный
// гейт немедленной попытки без прав). Деактивация значения, используемого
// связанными сущностями, отклоняется 409 с понятной причиной (§30) —
// показывается дословно из mutation.error.message, не generic-текстом.
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { Label } from '../../../shared/ui/Label'
import { ROUTES } from '../../../shared/routes'
import { ApiError } from '../../../shared/api/errors'
import {
  useCreateDictionaryEntry,
  useDictionaryDefinitions,
  useDictionaryEntries,
  useSetDictionaryEntryActive,
} from '../api/queries'
import type { DictionaryEntry } from '../model/types'

const formSchema = z.object({
  code: z.string().trim().min(1, 'Обязательное поле.'),
  label: z.string().trim().min(1, 'Обязательное поле.'),
  description: z.string(),
  groupCode: z.string(),
})

type FormValues = z.infer<typeof formSchema>

const POST_REQUIREMENT_GROUPS_CODE = 'POST_REQUIREMENT_GROUPS'

export function DictionaryDetailPage() {
  const { code } = useParams<{ code: string }>()
  const dictionaryCode = code ?? ''
  const isPostRequirements = dictionaryCode === 'POST_REQUIREMENTS'
  const definitionsQuery = useDictionaryDefinitions()
  const entriesQuery = useDictionaryEntries(dictionaryCode)
  const groupsQuery = useDictionaryEntries(
    isPostRequirements ? POST_REQUIREMENT_GROUPS_CODE : '',
  )
  const definition = definitionsQuery.data?.results.find((d) => d.code === dictionaryCode)
  const groups = groupsQuery.data?.results ?? []

  return (
    <div>
      <Link
        to={ROUTES.dictionaries}
        className="mb-3 inline-block text-xs font-semibold text-primary"
      >
        ← Назад к справочникам
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {definition?.label ?? dictionaryCode}
        </h1>
        {definition !== undefined && (
          <span className="text-sm text-muted-foreground">{definition.description}</span>
        )}
      </header>

      {entriesQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка значений…</p>
      )}
      {entriesQuery.isError && (
        <p className="text-sm text-destructive">Справочник не найден или недоступен.</p>
      )}

      {!entriesQuery.isLoading && !entriesQuery.isError && (
        <>
          <EntriesTable
            entries={entriesQuery.data?.results ?? []}
            dictionaryCode={dictionaryCode}
            groups={groups}
          />
          <CreateEntryForm dictionaryCode={dictionaryCode} groups={groups} />
        </>
      )}
    </div>
  )
}

function EntriesTable({
  entries,
  dictionaryCode,
  groups,
}: {
  entries: DictionaryEntry[]
  dictionaryCode: string
  groups: DictionaryEntry[]
}) {
  const mutation = useSetDictionaryEntryActive(dictionaryCode)
  const showGroupColumn = dictionaryCode === 'POST_REQUIREMENTS'

  if (entries.length === 0) {
    return (
      <section className="mb-4 rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
        Значений пока нет
      </section>
    )
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border bg-card">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-muted/40">
            <th className="p-3 text-[11px] font-semibold text-muted-foreground">Код</th>
            <th className="p-3 text-[11px] font-semibold text-muted-foreground">Наименование</th>
            <th className="p-3 text-[11px] font-semibold text-muted-foreground">Описание</th>
            {showGroupColumn && (
              <th className="p-3 text-[11px] font-semibold text-muted-foreground">Группа</th>
            )}
            <th className="p-3 text-[11px] font-semibold text-muted-foreground">Статус</th>
            <th className="p-3 text-[11px] font-semibold text-muted-foreground" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t align-top">
              <td className="p-3 text-sm font-mono">{entry.code}</td>
              <td className="p-3 text-sm font-semibold">{entry.label}</td>
              <td className="p-3 text-sm text-muted-foreground">{entry.description}</td>
              {showGroupColumn && (
                <td className="p-3 text-sm text-muted-foreground">
                  {entry.groupCode === null
                    ? '—'
                    : (groups.find((g) => g.code === entry.groupCode)?.label ?? entry.groupCode)}
                </td>
              )}
              <td className="p-3">
                <span
                  className={
                    entry.isActive
                      ? 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800'
                      : 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground'
                  }
                >
                  {entry.isActive ? 'Активно' : 'Деактивировано'}
                </span>
              </td>
              <td className="p-3 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ id: entry.id, isActive: !entry.isActive })}
                >
                  {entry.isActive ? 'Деактивировать' : 'Активировать'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {mutation.error !== null && (
        <p className="border-t bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {mutation.error.message}
        </p>
      )}
    </section>
  )
}

function CreateEntryForm({
  dictionaryCode,
  groups,
}: {
  dictionaryCode: string
  groups: DictionaryEntry[]
}) {
  const isPostRequirements = dictionaryCode === 'POST_REQUIREMENTS'
  const mutation = useCreateDictionaryEntry(dictionaryCode)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: '', label: '', description: '', groupCode: '' },
  })

  useEffect(() => {
    if (!(mutation.error instanceof ApiError)) return
    for (const [field, value] of Object.entries(mutation.error.details)) {
      const message = Array.isArray(value) ? String(value[0]) : String(value)
      setError(field as keyof FormValues, { message })
    }
  }, [mutation.error, setError])

  useEffect(() => {
    if (mutation.data !== undefined) {
      reset({ code: '', label: '', description: '', groupCode: '' })
    }
  }, [mutation.data, reset])

  function submit(values: FormValues): void {
    mutation.mutate({ ...values, groupCode: values.groupCode === '' ? null : values.groupCode })
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 font-semibold">Добавить значение</h2>
      <form
        className={
          isPostRequirements
            ? 'grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.4fr_1.4fr_1.4fr_auto] md:items-end'
            : 'grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.4fr_1.8fr_auto] md:items-end'
        }
        onSubmit={(e) => void handleSubmit(submit)(e)}
      >
        <div>
          <Label htmlFor="code">Код</Label>
          <Input id="code" {...register('code')} />
          {errors.code && <p className="mt-1 text-xs text-destructive">{errors.code.message}</p>}
        </div>
        <div>
          <Label htmlFor="label">Наименование</Label>
          <Input id="label" {...register('label')} />
          {errors.label && <p className="mt-1 text-xs text-destructive">{errors.label.message}</p>}
        </div>
        <div>
          <Label htmlFor="description">Описание</Label>
          <Input id="description" {...register('description')} />
        </div>
        {isPostRequirements && (
          <div>
            <Label htmlFor="groupCode">Группа</Label>
            <select
              id="groupCode"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              {...register('groupCode')}
            >
              <option value="">Без группы</option>
              {groups
                .filter((g) => g.isActive)
                .map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label}
                  </option>
                ))}
            </select>
            {errors.groupCode && (
              <p className="mt-1 text-xs text-destructive">{errors.groupCode.message}</p>
            )}
          </div>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Сохранение…' : 'Добавить'}
        </Button>
      </form>
    </section>
  )
}
