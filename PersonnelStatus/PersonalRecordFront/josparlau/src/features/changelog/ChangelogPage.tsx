// Стори 10.9 — страница журнала «сообщено → исправлено» (`/changelog`).
// Вход на неё — ссылка версии в футере каркаса (AppLayout), а не пункт
// сайдбара: NavSection.permission обязателен (routes.ts:60), и «доступно всем»
// в эту модель не выражается без её переделки (AC-7).
//
// ═══ ЧЕГО ЗДЕСЬ ОСОЗНАННО НЕТ ═══
// · НАПОЛНЕНИЯ ЖУРНАЛА. Модели багрепорта на бэке не существует — строки
//   принесёт 13.4 (epics.md#L1372-1378). Пустое состояние сегодня — НОРМА,
//   а не сбой, и оформлено первоклассным состоянием с объяснением (Решение №5).
// · ИСТОРИИ ВЕРСИЙ (списка релизов). Её источник — manifest.json, артефакт
//   12.2; сегодня системе известна ровно одна версия — текущая.
// · ДАТЫ СБОРКИ. Ломает воспроизводимость бандла (AC 12.2: «повторная сборка
//   того же sha даёт тот же состав»); версии и sha достаточно.
// · ЛИЧНОСТИ СООБЩИВШЕГО — и не появится: анонимность от начальства
//   (epics.md#L1354). Поля автора нет в самом типе (changelog.ts).
//
// 🔴 ПРОП `fixes` — ЭТО ШОВ, А НЕ УКРАШЕНИЕ (AC-9, Решение №4). Дефолт —
// константа модуля; 13.4 заменит ДЕФОЛТ на запрос, а проп останется точкой
// инъекции. Без него ветка «есть строки» была бы недостижима до E13 и покрыта
// нулём тестов — ровно урок 10.5 (HIGH).
import { Card, CardContent, CardHeader } from '../../shared/ui/Card'
import { APP_VERSION, BUILD_SHA, buildLabel, versionLabel } from '../../shared/version'
import type { FixEntry } from './changelog'
import { CLOSED_FIXES, formatJournalDate, sortFixesByRelease } from './changelog'

const HEADING = 'Журнал: сообщено → исправлено'
const VERSION_SECTION = 'Версия приложения'
const FIXES_SECTION = 'Закрытые исправления'
const EMPTY_TEXT = 'Исправлений пока нет.'
const EMPTY_HINT = 'Журнал наполнится, когда будет закрыт первый багрепорт.'
const COLUMN_VERSION = 'Версия'
const COLUMN_DATE = 'Дата'
const COLUMN_SUMMARY = 'Что исправлено'

export function ChangelogPage({
  fixes = CLOSED_FIXES,
}: {
  fixes?: readonly FixEntry[]
}) {
  // сортировка не мутирует вход — см. sortFixesByRelease
  const rows = sortFixesByRelease(fixes)
  const build = buildLabel(BUILD_SHA)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold leading-none tracking-tight">
        {HEADING}
      </h1>

      <Card>
        <CardHeader>
          <h2 className="font-semibold leading-none tracking-tight">
            {VERSION_SECTION}
          </h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {/* реальные данные уже сегодня: значения приезжают build-time
              (scripts/build-constants.ts) */}
          <p className="text-sm">{versionLabel(APP_VERSION)}</p>
          {/* метка сборки только при непустом sha: пустой = сборка вне git,
              «неизвестно» пользователю не показываем */}
          {build === '' ? null : (
            <p className="text-sm text-muted-foreground">{build}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold leading-none tracking-tight">
            {FIXES_SECTION}
          </h2>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col gap-1">
              <p role="status" className="text-sm">
                {EMPTY_TEXT}
              </p>
              <p className="text-sm text-muted-foreground">{EMPTY_HINT}</p>
            </div>
          ) : (
            // плотная рабочая таблица внутри карточки (EXPERIENCE.md#L46)
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {COLUMN_VERSION}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {COLUMN_DATE}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {COLUMN_SUMMARY}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((fix) => (
                  <tr key={fix.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 align-top">{fix.version}</td>
                    <td className="py-2 pr-4 align-top whitespace-nowrap">
                      {formatJournalDate(fix.releasedAt)}
                    </td>
                    <td className="py-2 align-top">{fix.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
