/**
 * Работа с модальными окнами в пробах (Plane №109).
 *
 * ЗАЧЕМ. Пробы раздела доступа подтверждали действия так:
 *
 *   await page.getByRole('button', { name: 'Снять', exact: true }).last().click()
 *
 * и это два разных дефекта в одной строке.
 *
 * 1. `.last()` НЕ значит «кнопка в окне». Пока окно открывается и закрывается,
 *    Radix прячет фон от дерева доступности, и порядок совпадений меняется:
 *    промах по фоновой кнопке выглядит как успешный клик, а проба зеленеет,
 *    ничего не подтвердив. Если окна не открылось ВОВСЕ, `.last()` спокойно
 *    нажмёт ту же кнопку на фоне — то есть повторит действие вместо
 *    подтверждения.
 * 2. Ассерт по фону сразу после клика в окне тоже вакуумный: пока окно на
 *    экране, `getByRole` по фону возвращает ноль независимо от содержимого,
 *    и `toHaveCount(0)` проходит всегда.
 *
 * Помощник закрывает оба: клик идёт ВНУТРИ `getByRole('dialog')`, а
 * возвращается управление только после того, как окно ушло с экрана — дальше
 * ассерты по фону снова о чём-то говорят.
 */
import { expect, type Page } from '@playwright/test'

export async function confirmInDialog(
  page: Page,
  options: { title: string | RegExp; button: string },
): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: options.title })
  await expect(dialog, `окно «${options.title}» не открылось`).toBeVisible()
  await dialog.getByRole('button', { name: options.button, exact: true }).click()
  // Ждём УХОДА окна: ассерт по фону при открытом окне проходит всегда.
  await expect(dialog, `окно «${options.title}» осталось на экране`).toHaveCount(0)
}
