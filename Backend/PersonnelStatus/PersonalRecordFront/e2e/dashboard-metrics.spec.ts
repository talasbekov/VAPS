/**
 * «Обзор» БЕЗ двух снятых блоков (Plane №268).
 *
 * 🔴 ПИН ПЕРЕВЁРНУТ ОСОЗНАННО. Здесь стоял сторож ЧЕСТНОСТИ карточки
 * «Показатели эффективности»: до 21.08.2026 она печатала три постоянных числа
 * (87 % при цели 90 %, 92 при 85, 94 при 95), которые не менялись никогда и ни
 * из чего не выводились, — и проба следила, чтобы вместо них стояли причины, а
 * процент не вернулся.
 *
 * 28.08.2026 заказчик снял с «Обзора» оба блока целиком: «Последние действия» и
 * «Показатели эффективности». Сторож честности карточки, которой больше нет,
 * охранял бы пустоту, а удалить пробу совсем значило бы оставить решение
 * заказчика без единой проверки — вернуть блоки смог бы кто угодно и незаметно.
 *
 * Поэтому проба теперь стережёт САМО РЕШЕНИЕ: этих двух блоков на экране нет.
 * А заодно — что «Обзор» после снятия не опустел: плитки расхода и структура
 * организации на месте. Без второй половины проба зеленела бы и на белом
 * экране.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'обзор: снятые блоки' : 'обзор (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('«Последние действия» и «Показатели эффективности» сняты, остальное на месте', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard`)

    // Сначала ждём, что экран ВООБЩЕ отрисовался: ассерт «блока нет» на
    // недогруженной странице зелен всегда и не значит ничего.
    await expect(
      page.getByRole('heading', { name: 'Обзор', exact: true }),
      'экран «Обзор» не отрисовался — проверять отсутствие блоков не на чем',
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText('Всего сотрудников')).toBeVisible()
    await expect(page.getByText('Структура организации').first()).toBeVisible()

    for (const gone of ['Последние действия', 'Показатели эффективности']) {
      await expect(
        page.getByText(gone),
        `блок «${gone}» вернулся на «Обзор» — заказчик снял его 28.08.2026`,
      ).toHaveCount(0)
    }

    // Причины снятой карточки тоже не должны всплыть где-то ещё на экране.
    for (const metric of ['Эффективность обновления', 'Время ответа', 'Точность данных']) {
      await expect(page.getByText(metric, { exact: true })).toHaveCount(0)
    }
  })
})
