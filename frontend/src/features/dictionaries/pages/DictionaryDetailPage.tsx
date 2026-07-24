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
})

type FormValues = z.infer<typeof formSchema>

export function DictionaryDetailPage() {
  const { code } = useParams<{ code: string }>()
  const dictionaryCode = code ?? ''
  const definitionsQuery = useDictionaryDefinitions()
  const entriesQuery = useDictionaryEntries(dictionaryCode)
  const definition = definitionsQuery.data?.results.find((d) => d.code === dictionaryCode)

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
          <EntriesTable entries={entriesQuery.data?.results ?? []} dictionaryCode={dictionaryCode} />
          <CreateEntryForm dictionaryCode={dictionaryCode} />
        </>
      )}
    </div>
  )
}

function EntriesTable({
  entries,
  dictionaryCode,
}: {
  entries: DictionaryEntry[]
  dictionaryCode: string
}) {
  const mutation = useSetDictionaryEntryActive(dictionaryCode)

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

function CreateEntryForm({ dictionaryCode }: { dictionaryCode: string }) {
  const mutation = useCreateDictionaryEntry(dictionaryCode)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: '', label: '', description: '' },
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
      reset({ code: '', label: '', description: '' })
    }
  }, [mutation.data, reset])

  function submit(values: FormValues): void {
    mutation.mutate(values)
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 font-semibold">Добавить значение</h2>
      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.4fr_1.8fr_auto] md:items-end"
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
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Сохранение…' : 'Добавить'}
        </Button>
      </form>
    </section>
  )
}
