// Story 13.4b — тонкий контейнер (паттерн DailyGridContainer.tsx: «данные/
// эндпоинт снаружи»), НЕ правит ChangelogPage.tsx (10.9's `fixes`-проп —
// уже готовая точка инъекции, «шов, не украшение»).
import { ChangelogPage } from './ChangelogPage'
import { useChangelogJournal } from './useChangelogJournal'

export const JOURNAL_ERROR_TEXT = 'Не удалось загрузить журнал исправлений'

export function ChangelogPageContainer() {
  const { fixes, isError } = useChangelogJournal()

  return (
    <>
      {/* AC-5: ошибка НЕ маскируется тихим пустым списком — ChangelogPage's
          собственное пустое состояние остаётся видимым (загрузка/ошибка обе
          проходят через тот же fixes=[] путь, это приемлемо, см. Dev Notes),
          но явный признак ошибки добавляется поверх. */}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {JOURNAL_ERROR_TEXT}
        </p>
      )}
      <ChangelogPage fixes={fixes} />
    </>
  )
}
