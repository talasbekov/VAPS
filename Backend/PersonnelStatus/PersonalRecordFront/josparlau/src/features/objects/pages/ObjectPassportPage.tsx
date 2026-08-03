// Паспорт объекта (§21.2/§21.6): секторы и постоянные посты, редактируемые
// (permission `ops.object.manage`). Схемы/документы/чек-листы/дежурства —
// Not started в этом срезе (§21.2 полный список; см. FRONTEND_DECISIONS).
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ROUTES } from '../../../shared/routes'
import { useObject, usePublishPassportVersion, useUpdatePassport } from '../api/queries'
import type { ObjectSector, PassportVersion, SecurityPost } from '../model/types'

let localSeq = 0
function nextLocalId(): string {
  localSeq += 1
  return `local-${localSeq}`
}

export function ObjectPassportPage() {
  const { id } = useParams<{ id: string }>()
  const query = useObject(id ?? '')

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка объекта…</p>
  }
  if (query.isError || query.data === undefined) {
    return (
      <div>
        <p className="text-sm text-destructive">Объект не найден или недоступен.</p>
        <Link to={ROUTES.objects} className="mt-2 inline-block text-sm font-semibold text-primary">
          ← Назад к реестру
        </Link>
      </div>
    )
  }

  const object = query.data

  return (
    <div>
      <Link to={ROUTES.objects} className="mb-3 inline-block text-xs font-semibold text-primary">
        ← Назад к реестру
      </Link>

      <section className="mb-4 rounded-xl border bg-card p-4">
        <div className="mb-1 flex gap-1.5">
          <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-foreground">
            {object.code}
          </span>
        </div>
        <h1 className="text-xl font-bold">{object.name}</h1>
        <p className="text-sm text-muted-foreground">
          {object.type} · {object.region} · {object.address}
        </p>
      </section>

      <PassportForm key={object.updatedAt} objectId={object.id} sectors={object.sectors} />

      <PassportVersionsPanel
        key={`versions-${object.updatedAt}`}
        objectId={object.id}
        versions={object.passportVersions}
        hasPosts={object.sectors.some((sector) => sector.posts.length > 0)}
      />
    </div>
  )
}

export const NOTHING_TO_PUBLISH_TEXT =
  'В паспорте нет ни одного поста — публиковать нечего.'

/**
 * История публикаций паспорта (§8.5 `publishPassportVersion`). Публикует
 * ДЕЙСТВУЮЩУЮ редакцию — ту, что показывает форма выше; секторы в запрос не
 * кладутся, снимок делает repository (иначе можно было бы опубликовать не то,
 * что видно). Опубликованные версии здесь только читаются: ни правки, ни
 * удаления не предусмотрено — §8.10 «версия паспорта неизменяема».
 */
function PassportVersionsPanel({
  objectId,
  versions,
  hasPosts,
}: {
  objectId: string
  versions: PassportVersion[]
  hasPosts: boolean
}) {
  const mutation = usePublishPassportVersion(objectId)
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [note, setNote] = useState('')

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-2.5 text-sm font-semibold">Версии паспорта</h2>

      {versions.length === 0 ? (
        <p className="mb-3 text-xs text-slate-600">
          Паспорт ещё не публиковался. Дежурства и расстановки опираются на
          опубликованную версию, а не на черновик.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1.5">
          {[...versions]
            .sort((a, b) => b.versionNumber - a.versionNumber)
            .map((version) => (
              <li key={version.id} className="rounded-md border p-2.5 text-xs">
                <Link
                  to={ROUTES.objectPassportVersionTo(objectId, version.id)}
                  className="font-semibold text-primary"
                >
                  Версия {version.versionNumber}
                </Link>{' '}
                <span className="text-slate-600">
                  действует с {version.effectiveFrom} · опубликовано{' '}
                  {version.publishedAt}
                  {version.note !== '' ? ` · ${version.note}` : ''}
                </span>
              </li>
            ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label
            htmlFor="passport-version-effective-from"
            className="block text-[11.5px] font-bold text-slate-600"
          >
            Действует с *
          </label>
          <input
            id="passport-version-effective-from"
            type="date"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </div>
        <div className="min-w-56 flex-1">
          <label
            htmlFor="passport-version-note"
            className="block text-[11.5px] font-bold text-slate-600"
          >
            Примечание к публикации
          </label>
          <input
            id="passport-version-note"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <Button
          type="button"
          disabled={effectiveFrom === '' || !hasPosts || mutation.isPending}
          title={hasPosts ? undefined : NOTHING_TO_PUBLISH_TEXT}
          onClick={() => mutation.mutate({ effectiveFrom, note })}
        >
          {mutation.isPending ? 'Публикация…' : 'Опубликовать версию'}
        </Button>
      </div>

      {!hasPosts && (
        <p className="mt-2 text-xs text-slate-600">{NOTHING_TO_PUBLISH_TEXT}</p>
      )}
      {mutation.error !== null && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          Не удалось опубликовать версию: на эту дату версия уже есть либо
          паспорт пуст.
        </p>
      )}
    </section>
  )
}

function PassportForm({ objectId, sectors: initial }: { objectId: string; sectors: ObjectSector[] }) {
  const mutation = useUpdatePassport(objectId)
  const [sectors, setSectors] = useState<ObjectSector[]>(initial)

  const dirty = JSON.stringify(sectors) !== JSON.stringify(initial)

  function addSector(): void {
    setSectors((prev) => [...prev, { id: nextLocalId(), name: '', posts: [] }])
  }

  function updateSector(sectorId: string, patch: Partial<ObjectSector>): void {
    setSectors((prev) => prev.map((s) => (s.id === sectorId ? { ...s, ...patch } : s)))
  }

  function removeSector(sectorId: string): void {
    setSectors((prev) => prev.filter((s) => s.id !== sectorId))
  }

  function addPost(sectorId: string): void {
    setSectors((prev) =>
      prev.map((s) =>
        s.id === sectorId
          ? { ...s, posts: [...s.posts, { id: nextLocalId(), name: '', task: '', requirements: '' }] }
          : s,
      ),
    )
  }

  function updatePost(sectorId: string, postId: string, patch: Partial<SecurityPost>): void {
    setSectors((prev) =>
      prev.map((s) =>
        s.id === sectorId
          ? { ...s, posts: s.posts.map((p) => (p.id === postId ? { ...p, ...patch } : p)) }
          : s,
      ),
    )
  }

  function removePost(sectorId: string, postId: string): void {
    setSectors((prev) =>
      prev.map((s) => (s.id === sectorId ? { ...s, posts: s.posts.filter((p) => p.id !== postId) } : s)),
    )
  }

  return (
    <>
      <div className="mb-3.5 flex flex-col gap-3.5">
        {sectors.map((sector) => (
          <section key={sector.id} className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <input
                className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm font-semibold"
                placeholder="Название сектора"
                aria-label="Название сектора"
                value={sector.name}
                onChange={(e) => updateSector(sector.id, { name: e.target.value })}
              />
              <Button variant="outline" size="sm" type="button" onClick={() => removeSector(sector.id)}>
                Удалить сектор
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {sector.posts.map((post) => (
                <div
                  key={post.id}
                  className="grid grid-cols-1 gap-2 border-b py-2.5 last:border-0 md:grid-cols-[1fr_1.3fr_1.3fr_auto]"
                >
                  <input
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Название поста"
                    aria-label="Название поста"
                    value={post.name}
                    onChange={(e) => updatePost(sector.id, post.id, { name: e.target.value })}
                  />
                  <input
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Задача"
                    aria-label="Задача поста"
                    value={post.task}
                    onChange={(e) => updatePost(sector.id, post.id, { task: e.target.value })}
                  />
                  <input
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Требования к назначению"
                    aria-label="Требования к назначению"
                    value={post.requirements}
                    onChange={(e) => updatePost(sector.id, post.id, { requirements: e.target.value })}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    aria-label="Удалить пост"
                    onClick={() => removePost(sector.id, post.id)}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                type="button"
                className="w-fit"
                onClick={() => addPost(sector.id)}
              >
                + Пост
              </Button>
            </div>
          </section>
        ))}
      </div>

      <div className="mb-3.5 flex justify-between">
        <Button variant="outline" type="button" onClick={addSector}>
          + Сектор
        </Button>
        <div className="flex flex-col items-end gap-2">
          {mutation.error !== null && (
            <p className="text-sm text-destructive" role="alert">
              Не удалось сохранить паспорт.
            </p>
          )}
          <Button
            type="button"
            disabled={mutation.isPending || !dirty}
            onClick={() => mutation.mutate({ sectors })}
          >
            {mutation.isPending ? 'Сохранение…' : 'Сохранить паспорт'}
          </Button>
        </div>
      </div>
    </>
  )
}
