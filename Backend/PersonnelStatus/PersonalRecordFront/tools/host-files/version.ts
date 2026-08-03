// Стори 10.9 — версия приложения для UI (футер каркаса + страница журнала).
//
// Константы читают build-time `define`. Шов, через который значения попадают
// в бандл, описан в `frontend/scripts/build-constants.ts` — это единственное
// место, куда должна смотреть 12.2 (там же объяснено, почему «версия из
// manifest» сегодня закрыта швом, а не источником).
//
// Рантайм-чтения манифеста здесь нет и быть не может: `fetch`/`XHR` вне
// `src/shared/api` — eslint error (ARCH-FE-015), а `apiClient` типизирован по
// `schema.d.ts`, где пути версии нет (ARCH-FE-011).
//
// 🔴 ФУНКЦИИ БЕРУТ ЗНАЧЕНИЯ АРГУМЕНТАМИ, А НЕ ЧИТАЮТ КОНСТАНТЫ. Причина
// техническая, не стилистическая: `define` действует и в vitest (тест-конфиг
// живёт внутри vite.config.ts:26-32), поэтому в прогоне BUILD_SHA — реальный
// sha текущего коммита. Читай функции константы — их нельзя было бы
// протестировать детерминированно, а ассерт на литерал сгнил бы на следующем
// коммите. Ветка «пустой sha» при этом недостижима на машине с git.

// Host-перенос (PersonalRecordFront/Next): Vite define здесь не существует —
// значения задаёт страница-хост тем же глобалом, что и env; фолбэк честный.
const hostEnv = (globalThis as {
  __JOSPARLAU_ENV__?: { APP_VERSION?: unknown; BUILD_SHA?: unknown }
}).__JOSPARLAU_ENV__
export const APP_VERSION: string =
  typeof hostEnv?.APP_VERSION === 'string' ? hostEnv.APP_VERSION : '0.0.0-host'
export const BUILD_SHA: string = typeof hostEnv?.BUILD_SHA === 'string' ? hostEnv.BUILD_SHA : ''

/** Подпись версии — она же доступное имя ссылки на журнал (AC-4). */
export function versionLabel(version: string): string {
  return `Версия ${version}`
}

/**
 * Метка сборки. Пустой sha → ПУСТАЯ строка: «неизвестно» пользователю не
 * рендерится вовсе (отличие от `build-bundle.sh:12`, где фолбэк — 'unknown').
 * Вызывающий проверяет непустоту и не рисует узел.
 */
export function buildLabel(sha: string): string {
  return sha === '' ? '' : `сборка ${sha}`
}
