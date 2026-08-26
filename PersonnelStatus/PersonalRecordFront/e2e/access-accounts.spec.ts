/**
 * Заведение учётки, блокировка и сброс пароля на ЖИВОМ стенде
 * (Plane №36, шаг «П-9»).
 *
 * Проба отвечает на три вопроса: заведённая учётка ПОКАЗЫВАЕТ временный
 * пароль (и он непустой — окно без пароля бесполезно, потому что второго раза
 * не будет), блокировка меняет состояние строки в реестре, сброс пароля
 * выдаёт НОВЫЙ пароль, отличный от выданного при заведении.
 *
 * Проба меняет состояние стенда и убрать за собой не может: удаления учётной
 * записи в API нет вовсе (на учётке висят назначения ролей и авторство
 * записей журнала). Поэтому учётка ОДНА и постоянная: повторный прогон её не
 * заводит, а находит поиском и работает с ней. Так реестр не зарастает
 * пробными людьми — этой ямой уже стоил времени реестр ОМ.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const PROBE_LOGIN = 'e2e_probe_account'

/** «Закрыть» на экране два: кнопка подвала и крестик Radix — у обоих то же
 * доступное имя. Проба берёт кнопку подвала явно, иначе строгий режим падает
 * на неоднозначности, а не на дефекте. */
async function closeSecret(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Закрыть', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Временный пароль' })).toHaveCount(0)
}

/** Поиск отложенный (`useDebouncedCommit`) и серверный: между вводом и
 * ответом реестр показывает ПРЕЖНИЕ строки. Считать их сразу после `fill`
 * значит спросить «есть ли учётка» до того, как ответ пришёл, — первый прогон
 * на этом и соврал, заведя учётку второй раз. Ждём, пока отбор доедет до URL
 * и реестр объявит результат: строка или «ничего не найдено».
 */
async function awaitSearch(page: Page, value: string): Promise<void> {
  await page.getByLabel('Поиск по учётным записям').fill(value)
  await page.waitForURL((url) => url.searchParams.get('search') === value)
  await expect(page.getByText('Загрузка учётных записей…')).toHaveCount(0)
  await expect
    .poll(async () =>
      (await page.getByRole('table').getByRole('button', { name: value, exact: true }).count()) +
      (await page.getByText(`По запросу «${value}» ничего не найдено.`).count())
    )
    .toBeGreaterThan(0)
}

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'учётные записи в настройках' : 'учётные записи в настройках (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('учётка заводится с показом временного пароля, блокируется и получает новый пароль', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)
    await page.goto(`${APP}/settings/users/`)
    await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible()

    const registry = page.getByRole('table')
    await awaitSearch(page, PROBE_LOGIN)
    const probeButton = registry.getByRole('button', { name: PROBE_LOGIN, exact: true })

    // Первый прогон заводит учётку и ПРОВЕРЯЕТ показ пароля; последующие
    // находят её поиском — заводить второй раз нечего и незачем.
    if ((await probeButton.count()) === 0) {
      await page.getByRole('button', { name: 'Завести учётку' }).click()
      await expect(page.getByRole('heading', { name: 'Завести учётную запись' })).toBeVisible()
      await page.getByLabel('Логин').fill(PROBE_LOGIN)
      await page.getByLabel('Фамилия').fill('Пробный')
      await page.getByLabel('Имя').fill('Пользователь')
      await page.getByRole('button', { name: 'Завести', exact: true }).click()

      // Пароль показан ОДИН раз и непустой: пустое окно означало бы, что
      // администратор остался без пароля и без возможности его узнать.
      await expect(page.getByRole('heading', { name: 'Временный пароль' })).toBeVisible()
      const shown = await page.locator('code.select-all').innerText()
      expect(shown.trim().length).toBeGreaterThan(7)
      await closeSecret(page)

      await awaitSearch(page, PROBE_LOGIN)
    }

    await expect(probeButton).toHaveCount(1)
    // Строка ищется по ТЕКСТУ, а не `filter({ has: probeButton })`: локатор в
    // `has` резолвится ОТНОСИТЕЛЬНО строки, а `probeButton` начинается с
    // `getByRole('table')` — внутри строки таблицы нет, и фильтр возвращал
    // пусто при верной разметке (проба соврала «блокировка не сработала»).
    const probeRow = registry.getByRole('row').filter({ hasText: PROBE_LOGIN })
    await probeButton.click()
    await expect(page.getByRole('heading', { name: 'Учётная запись' })).toBeVisible()

    // Прогон мог оставить учётку заблокированной — приводим к «Входит», это
    // же проверяет разблокировку без подтверждения.
    if ((await probeRow.getByText('Заблокирован').count()) > 0) {
      await page.getByRole('button', { name: 'Разблокировать' }).click()
      await expect(probeRow.getByText('Входит')).toBeVisible()
    }

    // Меню выезжает stagger-анимацией: снимок сразу после загрузки застаёт
    // категории БЕЗ пунктов (так и вышло на первом снимке), и по нему нельзя
    // судить о меню вообще. Ждём последний пункт, а не время.
    // Ждём ПРОЯВЛЕНИЯ, а не появления: у пунктов stagger-анимация, и
    // `toBeVisible` истинно уже при opacity 0 — первый снимок так и вышел с
    // пустым меню при 21 отрисованной ссылке.
    await expect
      .poll(async () =>
        page.locator('aside nav a').last().evaluate((el) => getComputedStyle(el).opacity),
      )
      .toBe('1')
    await page.screenshot({ path: 'smoke-results/access-accounts.png', fullPage: true })

    // БЛОКИРОВКА: с подтверждением, состояние строки меняется словами.
    await page.getByRole('button', { name: 'Заблокировать' }).click()
    await expect(page.getByRole('heading', { name: 'Заблокировать учётную запись?' })).toBeVisible()
    await page.getByRole('button', { name: 'Заблокировать', exact: true }).last().click()
    await expect(page.getByRole('heading', { name: 'Заблокировать учётную запись?' })).toHaveCount(0)
    await expect(probeRow.getByText('Заблокирован')).toBeVisible()

    // СБРОС ПАРОЛЯ: новый пароль отличается от любого прежнего — иначе окно
    // показывало бы старый и «сброс» был бы обманом.
    await page.getByRole('button', { name: 'Сбросить пароль' }).click()
    await expect(page.getByRole('heading', { name: 'Сбросить пароль?' })).toBeVisible()
    await page.getByRole('button', { name: 'Сбросить', exact: true }).last().click()
    await expect(page.getByRole('heading', { name: 'Временный пароль' })).toBeVisible()
    const first = (await page.locator('code.select-all').innerText()).trim()
    expect(first.length).toBeGreaterThan(7)
    // Снимок — только после того, как окно подтверждения ДОИГРАЛО уход:
    // иначе на картинке два диалога поверх друг друга, и по ней нельзя судить
    // ни о вёрстке, ни о читаемости пароля.
    await expect(page.getByRole('heading', { name: 'Сбросить пароль?' })).toHaveCount(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'smoke-results/access-accounts-secret.png' })
    await closeSecret(page)

    await page.getByRole('button', { name: 'Сбросить пароль' }).click()
    await page.getByRole('button', { name: 'Сбросить', exact: true }).last().click()
    await expect(page.getByRole('heading', { name: 'Временный пароль' })).toBeVisible()
    const second = (await page.locator('code.select-all').innerText()).trim()
    expect(second).not.toEqual(first)
    await closeSecret(page)

    // Уборка того, что убирается: учётка возвращается в рабочее состояние.
    await page.getByRole('button', { name: 'Разблокировать' }).click()
    await expect(probeRow.getByText('Входит')).toBeVisible()

    // СВЯЗНОСТЬ (шаг «П-10»): действия раздела доступа видны на экране аудита
    // ПОДПИСЯМИ, а не машинными кодами. Проба ищет подпись и требует, чтобы
    // кода `ACCESS_ACCOUNT_PASSWORD_RESET` в строке не было — иначе «подпись
    // есть» проходило бы и на экране, печатающем оба.
    await page.goto(`${APP}/security-ops/audit/`)
    await expect(page.getByRole('heading', { name: 'Аудит' }).first()).toBeVisible()
    await page.getByPlaceholder('Поиск по действию, сущности, пользователю…').fill('Пароль учётной записи сброшен')
    const auditRow = page.getByRole('row').filter({ hasText: 'Пароль учётной записи сброшен' }).first()
    await expect(auditRow).toBeVisible()
    await expect(auditRow).not.toContainText('ACCESS_ACCOUNT_PASSWORD_RESET')

    expect(errors).toEqual([])
  })
})
