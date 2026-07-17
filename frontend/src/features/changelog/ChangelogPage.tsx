// Страница журнала «сообщено → исправлено» (Story 10.9, architecture L145):
// статический рендер manifest-каркаса из shared/lib/appManifest — БЕЗ
// useQuery/apiClient (источник — константа; API багрепортов приедет в E13,
// стори 13.4). Card-язык — зеркало app/section-stubs (features → shared
// легален, ARCH-FE-013). Проп manifest — для изолированных тестов пустых
// состояний (AC-3); прод-рендер всегда идёт с дефолтом APP_MANIFEST.
import { APP_MANIFEST } from '../../shared/lib/appManifest'
import type { AppManifest } from '../../shared/lib/appManifest'
import { Card, CardContent, CardDescription, CardHeader } from '../../shared/ui/Card'

/** Честное пустое состояние записи без исправлений (AC-3, не пустой блок). */
export const NO_FIXES_TEXT = 'В этой версии закрытых исправлений нет'

/** Честное пустое состояние журнала без записей (AC-3). */
export const EMPTY_JOURNAL_TEXT = 'Журнал пока пуст'

/** Честная пометка каркаса (Scope 4): наполнение приедет из багрепортов E13. */
export const E13_NOTE_TEXT =
  'Наполнение журнала из сообщений об ошибках появится позже (E13) — пока здесь каркас.'

export function ChangelogPage({
  manifest = APP_MANIFEST,
}: {
  manifest?: AppManifest
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            Сообщено → исправлено
          </h1>
          <CardDescription>
            Журнал версий приложения и закрытых исправлений: что было сообщено
            и в какой версии исправлено.
          </CardDescription>
          <CardDescription>{E13_NOTE_TEXT}</CardDescription>
        </CardHeader>
      </Card>
      {manifest.entries.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {EMPTY_JOURNAL_TEXT}
            </p>
          </CardContent>
        </Card>
      ) : (
        manifest.entries.map((entry) => (
          <Card key={entry.version}>
            <CardHeader>
              <h2 className="text-lg font-semibold leading-none tracking-tight">
                {entry.version}
              </h2>
              {/* дата — статичная ISO-строка manifest-каркаса, рендер как
                  есть (БЕЗ дата-хелперов — хойст-гейт Out of Scope) */}
              <CardDescription>{entry.date}</CardDescription>
            </CardHeader>
            <CardContent>
              {entry.fixes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{NO_FIXES_TEXT}</p>
              ) : (
                <ul
                  aria-label={`Исправления ${entry.version}`}
                  className="list-disc space-y-1 pl-5 text-sm"
                >
                  {entry.fixes.map((fix, index) => (
                    // key по индексу: дубли формулировок внутри версии штатны
                    // для наполнения из багрепортов (13.4), текст — не ключ
                    <li key={`${entry.version}-${index}`}>{fix}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
