// Реестр справочников (§30): «все авторизованные могут видеть разрешённые
// справочники» — эта страница read-only, редактирование значений — на
// DictionaryDetailPage за ops.dictionary.manage (§8.5, серверная проверка).
import { Link } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { useDictionaryDefinitions } from '../api/queries'

export function DictionariesListPage() {
  const query = useDictionaryDefinitions()

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Настройки
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Справочники</h1>
        <span className="text-sm text-muted-foreground">
          Причины, требования постов, сезонные поправки, типы записей журнала, группы требований —
          управление за отдельным правом
        </span>
      </header>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка справочников…</p>
      )}
      {query.isError && (
        <p className="text-sm text-destructive">Не удалось загрузить справочники.</p>
      )}

      {!query.isLoading && !query.isError && (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {(query.data?.results ?? []).map((def) => (
            <Link
              key={def.code}
              to={ROUTES.dictionaryDetailTo(def.code)}
              className="block rounded-xl border bg-card p-4 hover:bg-muted/30"
            >
              <h2 className="font-semibold text-foreground">{def.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{def.description}</p>
              <p className="mt-3 text-xs font-semibold text-muted-foreground">
                {def.activeCount} активных из {def.totalCount}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
