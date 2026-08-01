// Опубликованная версия паспорта объекта — read-only просмотр по собственному
// deep link (мастер-промпт L5562 `/objects/:objectId/passports/:passportVersionId`,
// L6038 «версия паспорта имеет собственный deep link», §8.10 «версия паспорта
// неизменяема после публикации»).
//
// ⚠️ Экран НЕ редактирует: ни мутирующего хука, ни `<button>`/`<input>` —
// закреплено ассертом в `ObjectPassportVersionPage.test.tsx`. Открытие старой
// версии НЕ переключает пользователя на действующую редакцию (мастер-промпт
// L5651): страница показывает СНИМОК и явно говорит, что это не черновик.
import { Link, useParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { useObject } from '../api/queries'

export const VERSION_NOT_FOUND_TEXT =
  'Версия паспорта не найдена — возможно, ссылка ведёт на другой объект.'

export const READ_ONLY_HINT =
  'Опубликованная версия неизменяема: это снимок паспорта на момент публикации, а не действующая редакция.'

export function ObjectPassportVersionPage() {
  const { id, versionId } = useParams<{ id: string; versionId: string }>()
  const query = useObject(id ?? '')

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка версии паспорта…</p>
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
  const version = object.passportVersions.find((v) => v.id === versionId)

  return (
    <div>
      <Link
        to={ROUTES.objectDetailTo(object.id)}
        className="mb-3 inline-block text-xs font-semibold text-primary"
      >
        ← Назад к паспорту объекта
      </Link>

      {version === undefined ? (
        <section className="rounded-xl border bg-card p-9 text-center">
          <p className="text-sm text-destructive">{VERSION_NOT_FOUND_TEXT}</p>
        </section>
      ) : (
        <>
          <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
                Паспорт объекта
              </p>
              <h1 className="text-xl font-bold">
                {object.name} · версия {version.versionNumber}
              </h1>
              <p className="text-sm text-slate-600">
                Действует с {version.effectiveFrom} · опубликовано{' '}
                {version.publishedAt} · {version.publishedBy}
              </p>
            </div>
            <span className="inline-flex rounded-full bg-muted px-3 py-1 text-[11.5px] font-semibold text-slate-600">
              read-only
            </span>
          </header>

          <p className="mb-3.5 text-xs leading-relaxed text-slate-600">{READ_ONLY_HINT}</p>

          {version.note !== '' && (
            <section className="mb-3.5 rounded-xl border bg-card p-4">
              <h2 className="mb-1 text-sm font-semibold">Примечание к публикации</h2>
              <p className="text-sm text-slate-600">{version.note}</p>
            </section>
          )}

          <div className="flex flex-col gap-3.5">
            {version.sectors.map((sector) => (
              <section key={sector.id} className="rounded-xl border bg-card p-4">
                <h2 className="mb-2 text-sm font-semibold">{sector.name}</h2>
                {sector.posts.length === 0 ? (
                  <p className="text-xs text-slate-600">Постов в секторе нет.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {sector.posts.map((post) => (
                      <li key={post.id} className="rounded-md border p-2.5 text-xs">
                        <span className="font-semibold">{post.name}</span>{' '}
                        <span className="text-slate-600">
                          {post.task}
                          {post.requirements !== '' ? ` · ${post.requirements}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
