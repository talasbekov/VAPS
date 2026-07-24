// Паспорт объекта (§21.2/§21.6): секторы и постоянные посты, редактируемые
// (permission `ops.object.manage`). Схемы/документы/чек-листы/дежурства —
// Not started в этом срезе (§21.2 полный список; см. FRONTEND_DECISIONS).
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { ROUTES } from '../../../shared/routes'
import { useObject, useUpdatePassport } from '../api/queries'
import type { ObjectSector, SecurityPost } from '../model/types'

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
    </div>
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
                    value={post.name}
                    onChange={(e) => updatePost(sector.id, post.id, { name: e.target.value })}
                  />
                  <input
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Задача"
                    value={post.task}
                    onChange={(e) => updatePost(sector.id, post.id, { task: e.target.value })}
                  />
                  <input
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    placeholder="Требования к назначению"
                    value={post.requirements}
                    onChange={(e) => updatePost(sector.id, post.id, { requirements: e.target.value })}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
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
