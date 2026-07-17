// Manifest-каркас приложения (Story 10.9): ЕДИНСТВЕННЫЙ источник версии
// портала и записей журнала «сообщено → исправлено» (architecture L143/L145).
// Живёт в shared/lib, потому что версию читает футер shared/ui/AppLayout.tsx,
// а shared → features запрещён (ARCH-FE-013); features → shared легален —
// страница журнала (features/changelog) читает отсюда же.
//
// ШОВ (контракт): на стори 12.2 источником версии станет релизный
// manifest.json бандла (deploy/bundle.sh, architecture L560), на 13.4 записи
// журнала наполнятся из API багрепортов. Сигнатура AppManifest — контракт
// этого шва: заменяется источник константы, не форма данных.
// package.json "version": "0.0.0" — Vite-скаффолд, НЕ источник версии.

export interface ChangelogEntry {
  /** Версия релиза в формате vX.Y.Z (architecture L145). */
  version: string
  /** Дата релиза — статичная ISO-строка YYYY-MM-DD, рендерится как есть. */
  date: string
  /** Закрытые исправления («сообщено → исправлено»); наполнение — E13. */
  fixes: string[]
}

export interface AppManifest {
  /** Текущая версия приложения — показывается в футере портала. */
  version: string
  /** Записи журнала, новые сверху. */
  entries: ChangelogEntry[]
}

export const APP_MANIFEST: AppManifest = {
  version: 'v0.1.0',
  entries: [
    // стартовая запись каркаса: исправлений ещё нет — данные не выдумываем,
    // реальные пункты приедут из багрепортов E13 (стори 13.4)
    { version: 'v0.1.0', date: '2026-07-17', fixes: [] },
  ],
}
