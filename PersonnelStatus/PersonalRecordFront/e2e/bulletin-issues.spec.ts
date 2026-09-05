/**
 * Бюллетень — выпуск с датой и временем среза (`[МД-01]`, `[БЛН-04]`, Plane №420).
 *
 * На экране «Отчёты по ОМ» у вида «Информационный бюллетень» появляется поле
 * среза (дата и время) и блок «Выпуски бюллетеня»: кнопка «Выпустить на этот
 * срез» замораживает строки и PDF, список показывает прошлые выпуски с
 * кнопкой «Скачать PDF». Проба ходит путём заказчика: выбирает вид, видит поле
 * среза, выпускает и видит выпуск в списке; файл выпуска забирает по API той
 * же учётки (сохранение в браузере проба не перехватывает).
 *
 * Выпуск НЕ убирается: это хранимый документ, и уборка стенда его не трогает —
 * проба помечает его срезом далёкого 2099 года, чтобы он не спутался с живыми.
 *
 * КРАСНОТА НА МУТАЦИИ: убери `needs_as_of` у бюллетеня в `documents_registry`
 * — поле среза не появится; сними `create` из карты прав ручки — выпуск 403.
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03')

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

async function token(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

test.describe(LIVE ? 'выпуски бюллетеня' : 'выпуски бюллетеня (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('срез выбирается, выпуск замораживается и попадает в список', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/service-reports`)
    const group = page.getByRole('group', { name: 'Выгрузка документов ОМ' })
    await expect(group).toBeVisible()

    // Пока бюллетень не выбран, ни поля среза, ни выпусков нет.
    await expect(group.getByLabel('Срез бюллетеня')).toHaveCount(0)
    await group.getByLabel('Вид документа').selectOption('bulletin')
    const slice = group.getByLabel('Срез бюллетеня')
    await expect(slice).toBeVisible()
    await expect(slice).toHaveValue(/T08:00$/)

    const issues = page.getByRole('group', { name: 'Выпуски бюллетеня' })
    await expect(issues).toBeVisible()
    // Считать только ПОСЛЕ загрузки списка: пока он грузится, элементов ноль,
    // и «before + 1» ждал одного выпуска при трёх на стенде (прогон 04.09.2026).
    await expect(issues.getByText(/Выпусков ещё не было|Скачать PDF/).first()).toBeVisible()
    const before = await issues.getByRole('listitem').count()

    await slice.fill('2099-01-01T08:00')
    await issues.getByRole('button', { name: 'Выпустить на этот срез' }).click()
    await expect(issues.getByText(/Выпущен «byulleten-20990101-0800\.pdf»/)).toBeVisible()
    await expect(issues.getByRole('listitem')).toHaveCount(before + 1)
    const row = issues.getByRole('listitem').first()
    await expect(row).toContainText('01.01.2099')
    await expect(row.getByRole('button', { name: 'Скачать PDF' })).toBeEnabled()
    await group.screenshot({ path: path.join(SHOTS, 'bulletin-issues.png') })

    // Файл выпуска — тем же конвертом, что и сборка на лету.
    const tok = await token()
    const list = await fetch(`${API}/api/ops/bulletin-issues/`, { headers: { Authorization: `Bearer ${tok}` } })
    const first = ((await list.json()) as { results: { id: string; fileName: string }[] }).results[0]
    expect(first.fileName).toBe('byulleten-20990101-0800.pdf')
    const file = await fetch(`${API}/api/ops/bulletin-issues/${first.id}/file/`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
    expect(file.status).toBe(200)
    const body = (await file.json()) as { contentType: string; contentBase64: string }
    expect(body.contentType).toBe('application/pdf')
    expect(Buffer.from(body.contentBase64, 'base64').subarray(0, 4).toString()).toBe('%PDF')
  })
})

/**
 * Отказы в блоке выпусков (Plane №626, №627).
 *
 * 🔴 СВОЁ ОПИСАНИЕ С `serviceWorkers: 'block'`: без него `page.route` не
 * перехватывает запросы, ушедшие через service worker MSW, и подделать отказ
 * нельзя — проба была бы зелёной на живых данных, ничего не проверив.
 */
test.describe(LIVE ? 'выпуски бюллетеня: отказы' : 'выпуски бюллетеня: отказы (скип)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.use({ serviceWorkers: 'block' })

  test('отказ списка выпусков назван отказом, а не «выпусков не было» (Plane №626)', async ({
    page,
  }) => {
    /**
     * Ветка ошибки не проверялась вовсе: при 500, истёкшей сессии или обрыве
     * сети `isPending` уже false, `data` пуст, и человеку говорили «Выпусков ещё
     * не было» — утверждение о МИРЕ вместо факта о ЗАПРОСЕ. Соседние блоки того
     * же экрана ошибку рисуют, то есть правило в файле есть и было пропущено.
     *
     * Мутация, на которой проба обязана краснеть: снять ветку
     * `bulletinIssues.error` — вернётся «Выпусков ещё не было».
     */
    await page.route('**/api/ops/bulletin-issues/', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' })
        : route.fallback()
    )
    await signIn(page)
    await page.goto(`${APP}/security-ops/service-reports`)
    const group = page.getByRole('group', { name: 'Выгрузка документов ОМ' })
    await group.getByLabel('Вид документа').selectOption('bulletin')

    const issues = page.getByRole('group', { name: 'Выпуски бюллетеня' })
    const alert = issues.getByRole('alert').filter({ hasText: 'Список выпусков не загрузился' })
    await expect(alert).toBeVisible({ timeout: 20_000 })
    await expect(alert.getByRole('button', { name: 'Повторить' })).toBeVisible()
    await expect(issues.getByText('Выпусков ещё не было')).toHaveCount(0)
  })

  test('отказ «Скачать PDF» назван, и гаснет только нажатая строка (Plane №627)', async ({
    page,
  }) => {
    /**
     * Отказ выдачи не рисовался нигде: при 403, 404 или порче хранилища мутация
     * завершалась, кнопка включалась обратно, и не появлялось НИЧЕГО — нажатие
     * читалось как пустое, и человек жал снова. Вторая половина: `disabled` был
     * привязан к общему `isPending`, поэтому гасли кнопки ВСЕХ строк, и какая
     * занята — не видно.
     *
     * Мутация, на которой проба обязана краснеть: снять ветку
     * `issueFile.error` — после нажатия не появится ничего.
     */
    await page.route('**/api/ops/bulletin-issues/*/file/', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error_code":"DOCUMENT_INTEGRITY_FAILED","detail":{}}',
      })
    )
    await signIn(page)
    await page.goto(`${APP}/security-ops/service-reports`)
    const group = page.getByRole('group', { name: 'Выгрузка документов ОМ' })
    await group.getByLabel('Вид документа').selectOption('bulletin')

    const issues = page.getByRole('group', { name: 'Выпуски бюллетеня' })
    const rows = issues.getByRole('listitem')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    const count = await rows.count()
    test.skip(count === 0, 'на стенде нет ни одного выпуска — нечего скачивать')

    await rows.first().getByRole('button', { name: 'Скачать PDF' }).click()

    await expect(
      issues.getByRole('alert').filter({ hasText: 'Выпуск не скачался' })
    ).toBeVisible({ timeout: 20_000 })
    // Соседние строки остаются рабочими: гаснет ТОЛЬКО нажатая, и то на время
    // запроса. К моменту проверки запрос уже завершился отказом.
    if (count > 1) {
      await expect(rows.nth(1).getByRole('button', { name: 'Скачать PDF' })).toBeEnabled()
    }
  })
})
