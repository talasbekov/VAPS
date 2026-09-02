/**
 * Заголовки таблиц объявлены как `columnheader` (Plane №357).
 *
 * Экраны рисуют таблицы одним примитивом `components/ui/table`, и до этой
 * правки его `th` шёл БЕЗ `scope`: Chromium оставлял такой заголовок обычной
 * ячейкой, роль `columnheader` не выдавалась, и скринридер, читая значение,
 * не называл колонку — нарушение 1.3.1 Info and Relationships. Замер по
 * стенду 31.08.2026: `/security-ops/dictionaries` — 8 `th` и НОЛЬ
 * `columnheader`; `/security-ops/vehicles` (нативная разметка со
 * `scope="col"`) — 7 из 7.
 *
 * Проба ходит по экранам-читателям примитива — по одному из каждой группы,
 * где таблица главная на экране, — и требует, чтобы КАЖДЫЙ `th` был
 * заголовком колонки. Считаются оба числа: экран без таблицы прошёл бы
 * проверку «ноль равен нулю», поэтому `th` обязан быть больше нуля.
 *
 * Мутация, которую стережёт: снять умолчание `scope="col"` в примитиве.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

/** По одному экрану на группу читателей примитива: справочники, раздел
 *  доступа, журнал раздела ОМ. Экраны без таблицы сюда не годятся — на
 *  `/security-ops/objects`, например, данные показаны карточками, и проба
 *  падала бы на «нет ни одного th», ничего не проверив. */
const SCREENS = [
  '/security-ops/dictionaries',
  '/settings/roles',
  '/settings/permissions',
  '/security-ops/audit',
]

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
}

test.describe(LIVE ? 'заголовки таблиц' : 'заголовки таблиц (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  for (const path of SCREENS) {
    test(`${path}: каждый заголовок объявлен колонкой`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${path}`)

      // Таблица приезжает запросом: считать сразу после перехода значит
      // считать пустой экран, и проба зеленела бы на нулях.
      await expect.poll(async () => page.locator('th').count()).toBeGreaterThan(0)

      // 🔴 ОБА ЧИСЛА ЧИТАЮТСЯ В ОДИН МОМЕНТ, а не по очереди (Plane №377).
      // На экране справочников таблиц ДВЕ, и приезжают они разными запросами:
      // счёт `th`, снятый до второй таблицы, сравнивался с числом ролей,
      // снятым после неё, — проба падала «8 против 3» на верной разметке.
      // Сравниваем снимок пары и ждём, пока он сойдётся.
      await expect
        .poll(
          async () => {
            const [headers, roles] = await Promise.all([
              page.locator('th').count(),
              page.getByRole('columnheader').count(),
            ])
            // Строка «сошлось/не сошлось» вместо пары чисел: `poll` сравнивает
            // ОДНО значение, а нам нужно равенство двух — и чтобы ноль не
            // считался «сошлось».
            return headers > 0 && headers === roles
              ? 'все заголовки объявлены колонками'
              : `заголовков ${headers}, объявлено колонками ${roles}`
          },
          {
            message: `на ${path} заголовки таблицы не объявлены как columnheader`,
            timeout: 20_000,
          },
        )
        .toBe('все заголовки объявлены колонками')
    })
  }
})
