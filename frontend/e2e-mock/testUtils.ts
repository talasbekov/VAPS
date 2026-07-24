// Общие хелперы e2e-mock спек (§33). Вынесены после дублирования во второй
// спеке — единственное разумное место, shared/ инфраструктуры под Playwright
// у проекта нет (playwright.config.ts — тоже плоский, без утил-модуля).
import type { Page } from '@playwright/test'

/** Сид credential ДО скриптов страницы (прецедент changelog.spec.ts, Ловушка 6
 * стори 8.8): addInitScript исполняется раньше init credential.ts. userId —
 * demo-admin (wildcard `*` в demo-personas.ts), чтобы спека не зависела от
 * разделения обязанностей между persona (см. FRONTEND_ROLE_MATRIX). */
export async function seedCredential(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'vaps.credential',
      JSON.stringify({ kind: 'dev', userId: 'demo-admin' }),
    )
  })
}

/** DemoToolbar (fixed bottom-4 right-4) — только dev-furniture: Rollup
 * статически исключает весь её chunk из production build (A8), реальный
 * пользователь её не увидит. На страницах с длинным контентом снизу (журнал
 * штаба, итоги закрытия) физически перекрывает кнопки действий — `force`/
 * `position` при клике не спасают (реальный клик по координатам всё равно
 * достаётся верхнему по z-index элементу), поэтому прячем целиком через
 * addInitScript (переживает page.reload() в отличие от addStyleTag). */
export async function hideDemoToolbar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    function inject(): void {
      const style = document.createElement('style')
      style.textContent = '.fixed.bottom-4.right-4 { display: none !important; }'
      document.head.appendChild(style)
    }
    // addInitScript исполняется ДО парсинга <head> (document-start) —
    // document.head ещё null на этот момент, appendChild упал бы молча.
    if (document.head) inject()
    else document.addEventListener('DOMContentLoaded', inject)
  })
}
